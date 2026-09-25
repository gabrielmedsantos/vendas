import { z } from 'zod';
import { sql, withTenant } from '@gct/db';
import { conflict, invalid, notFound } from '@gct/shared';
import { audit, emit, requirePermission, todayLocal, tx, type Actor, type AppDeps } from './core';
import { generateDocument } from './documents';
import { releaseReservations } from './inventory';
import { buildReport, REPORT_KINDS, reportToCsv, resolvePeriod, type ReportKind } from './metrics';
import { effectivePermissions, type Role } from '@gct/shared';
import { runSubscriptionLifecycle } from './billing';

export interface OutboxEvent {
  id: string;
  tenant_id: string;
  type: string;
  payload: Record<string, unknown>;
  attempts: number;
}

const MAX_ATTEMPTS = 8;

/** Reivindica eventos com lease (SKIP LOCKED): vários workers não pegam o mesmo evento. */
/** `tenantId` restringe a uma empresa (reprocessamento dirigido e testes paralelos). */
export async function claimEvents(deps: AppDeps, limit = 10, tenantId?: string): Promise<OutboxEvent[]> {
  const r = await sql<OutboxEvent>`
    update outbox_events set status = 'processing', locked_until = now() + interval '2 minutes', attempts = attempts + 1
    where id in (
      select id from outbox_events
      where ((status = 'pending' and available_at <= now()) or (status = 'processing' and locked_until < now()))
        and (${tenantId ?? null}::uuid is null or tenant_id = ${tenantId ?? null}::uuid)
      order by available_at limit ${limit} for update skip locked)
    returning id, tenant_id, type, payload, attempts`.execute(deps.dbs.platform);
  return r.rows;
}

async function finish(deps: AppDeps, ev: OutboxEvent, error?: Error) {
  if (!error) {
    await deps.dbs.platform.updateTable('outbox_events').set({ status: 'done', processed_at: new Date(), last_error: null }).where('id', '=', ev.id).execute();
    return;
  }
  const dead = ev.attempts >= MAX_ATTEMPTS;
  // Backoff exponencial com jitter; após o limite vai para dead letter monitorada.
  const delayMs = Math.min(3600_000, 2 ** ev.attempts * 1000) + Math.floor(Math.random() * 1000);
  await deps.dbs.platform
    .updateTable('outbox_events')
    .set({ status: dead ? 'dead' : 'pending', available_at: new Date(Date.now() + delayMs), locked_until: null, last_error: error.message.slice(0, 500) })
    .where('id', '=', ev.id)
    .execute();
}

/** Consumidores idempotentes: repetir o evento não repete efeito financeiro. */
export async function handleEvent(deps: AppDeps, ev: OutboxEvent): Promise<void> {
  switch (ev.type) {
    case 'DocumentRequested':
      await generateDocument(deps, ev.tenant_id, String(ev.payload.documentId));
      return;
    case 'ReportRequested':
      await runReportJob(deps, ev.tenant_id, String(ev.payload.jobId));
      return;
    case 'SaleConfirmed':
      await lowStockNotifications(deps, ev.tenant_id, String(ev.payload.saleId));
      return;
    default:
      return; // eventos sem consumidor ainda (auditoria/integrações futuras)
  }
}

export async function processOutboxBatch(deps: AppDeps, limit = 10, tenantId?: string): Promise<{ processed: number; failed: number }> {
  const events = await claimEvents(deps, limit, tenantId);
  let failed = 0;
  for (const ev of events) {
    try {
      await handleEvent(deps, ev);
      await finish(deps, ev);
    } catch (e) {
      failed++;
      await finish(deps, ev, e as Error);
    }
  }
  return { processed: events.length, failed };
}

async function lowStockNotifications(deps: AppDeps, tenantId: string, saleId: string) {
  await withTenant(deps.dbs.app, { tenantId }, async (trx) => {
    const tz = await trx.selectFrom('tenants').select('timezone').executeTakeFirstOrThrow();
    const today = todayLocal(tz.timezone);
    const low = await sql<{ variant_id: string; name: string; on_hand: number; min_stock: number }>`
      select v.id as variant_id, p.name, coalesce(b.on_hand, 0)::int as on_hand, v.min_stock
      from sale_items si join product_variants v on v.id = si.variant_id join products p on p.id = v.product_id
      left join stock_balances b on b.variant_id = v.id
      where si.sale_id = ${saleId} and v.min_stock > 0 and coalesce(b.on_hand, 0) <= v.min_stock`.execute(trx);
    for (const l of low.rows) {
      await trx
        .insertInto('notifications')
        .values({
          tenant_id: tenantId, kind: 'low_stock', severity: 'warning', title: `Estoque baixo: ${l.name}`,
          body: `Restam ${l.on_hand} unidade(s); mínimo configurado ${l.min_stock}.`, link: '/app/estoque', dedupe_key: `low_stock:${l.variant_id}:${today}`,
        })
        .onConflict((oc) => oc.doNothing())
        .execute();
    }
  });
}

// ---------------------------------------------------------------------------
// Exportações em fila (link expira)

export const zExportRequest = z.object({
  kind: z.enum(REPORT_KINDS),
  format: z.enum(['csv']).default('csv'),
  from: z.string().optional(),
  to: z.string().optional(),
  preset: z.enum(['today', '7d', '30d', 'month', 'last_month', 'year']).optional(),
});

export async function requestExport(deps: AppDeps, actor: Actor, input: z.infer<typeof zExportRequest>) {
  requirePermission(actor, 'data.export');
  const period = resolvePeriod(actor, input);
  return tx(deps, actor, async (trx) => {
    const job = await trx
      .insertInto('report_jobs')
      .values({ tenant_id: actor.tenantId, kind: input.kind, format: input.format, filters: JSON.stringify(period), requested_by: actor.userId })
      .returning('id')
      .executeTakeFirstOrThrow();
    await emit(trx, actor.tenantId, 'ReportRequested', { jobId: job.id });
    await audit(trx, actor, 'data.export_requested', 'report_job', job.id, { kind: input.kind, period });
    return { jobId: job.id };
  });
}

async function runReportJob(deps: AppDeps, tenantId: string, jobId: string) {
  const job = await withTenant(deps.dbs.app, { tenantId }, (trx) => trx.selectFrom('report_jobs').selectAll().where('id', '=', jobId).executeTakeFirst());
  if (!job || job.status === 'done') return;
  // Revalida permissão do solicitante no momento da execução.
  const m = await withTenant(deps.dbs.app, { tenantId }, (trx) =>
    trx.selectFrom('memberships').select(['role', 'grants', 'revokes', 'status']).where('user_id', '=', job.requested_by ?? '').executeTakeFirst(),
  );
  const tz = await withTenant(deps.dbs.app, { tenantId }, (trx) => trx.selectFrom('tenants').select(['timezone', 'status']).executeTakeFirstOrThrow());
  if (!m || m.status !== 'active') {
    await withTenant(deps.dbs.app, { tenantId }, (trx) => trx.updateTable('report_jobs').set({ status: 'failed', error: 'Solicitante sem acesso.' }).where('id', '=', jobId).execute());
    return;
  }
  const actor: Actor = {
    userId: job.requested_by!, tenantId, membershipId: '', role: m.role as Role, permissions: effectivePermissions(m.role as Role, m.grants, m.revokes),
    discountLimitBps: 0, timezone: tz.timezone, tenantStatus: tz.status as Actor['tenantStatus'],
  };
  if (!actor.permissions.has('data.export')) {
    await withTenant(deps.dbs.app, { tenantId }, (trx) => trx.updateTable('report_jobs').set({ status: 'failed', error: 'Permissão revogada.' }).where('id', '=', jobId).execute());
    return;
  }
  const period = job.filters as { from: string; to: string };
  const report = await withTenant(deps.dbs.app, { tenantId, userId: actor.userId }, (trx) => buildReport(trx, actor, job.kind as ReportKind, period));
  const csv = Buffer.from(reportToCsv(report), 'utf8');
  const key = `${tenantId}/exports/${job.id}.csv`;
  await deps.storage.put(key, csv, 'text/csv');
  await withTenant(deps.dbs.app, { tenantId }, (trx) =>
    trx
      .updateTable('report_jobs')
      .set({ status: 'done', storage_key: key, row_count: report.rows.length, finished_at: new Date(), expires_at: new Date(Date.now() + 24 * 3600_000) })
      .where('id', '=', jobId)
      .execute(),
  );
}

export async function listExports(deps: AppDeps, actor: Actor) {
  requirePermission(actor, 'data.export');
  return tx(deps, actor, (trx) =>
    trx.selectFrom('report_jobs').select(['id', 'kind', 'format', 'filters', 'status', 'row_count', 'expires_at', 'error', 'created_at']).orderBy('created_at', 'desc').limit(50).execute(),
  );
}

export async function downloadExport(deps: AppDeps, actor: Actor, jobId: string): Promise<{ filename: string; data: Buffer }> {
  requirePermission(actor, 'data.export');
  const job = await tx(deps, actor, (trx) => trx.selectFrom('report_jobs').selectAll().where('id', '=', jobId).executeTakeFirst());
  if (!job) throw notFound('Exportação');
  if (job.status !== 'done' || !job.storage_key) throw conflict('Exportação ainda em processamento.');
  if (!job.expires_at || job.expires_at < new Date()) throw invalid('Link de exportação expirado. Solicite novamente.');
  await tx(deps, actor, (trx) => audit(trx, actor, 'data.export_downloaded', 'report_job', jobId));
  return { filename: `${job.kind}-${(job.filters as { from: string }).from}.csv`, data: await deps.storage.get(job.storage_key) };
}

// ---------------------------------------------------------------------------
// Rotinas periódicas globais (papel platform lista; efeitos no contexto do tenant)

export async function expireReservations(deps: AppDeps): Promise<number> {
  const expired = await deps.dbs.platform
    .selectFrom('reservations')
    .select(['tenant_id', 'source_type', 'source_id'])
    .where('status', '=', 'active')
    .where('expires_at', '<', new Date())
    .groupBy(['tenant_id', 'source_type', 'source_id'])
    .limit(500)
    .execute();
  let n = 0;
  for (const r of expired) {
    n += await withTenant(deps.dbs.app, { tenantId: r.tenant_id }, (trx) => releaseReservations(trx, { tenantId: r.tenant_id, userId: 'system' }, r.source_type, r.source_id, 'expired'));
    if (r.source_type === 'public_order') {
      await withTenant(deps.dbs.app, { tenantId: r.tenant_id }, (trx) =>
        trx.updateTable('public_orders').set({ status: 'expired' }).where('id', '=', r.source_id).where('status', '=', 'reserved').execute(),
      );
    }
  }
  return n;
}

export async function snapshotDailyStock(deps: AppDeps): Promise<number> {
  const tenants = await deps.dbs.platform.selectFrom('tenants').select(['id', 'timezone']).where('status', '<>', 'archived').execute();
  for (const t of tenants) {
    const day = todayLocal(t.timezone);
    await withTenant(deps.dbs.app, { tenantId: t.id }, (trx) =>
      sql`insert into daily_stock_snapshots (tenant_id, snapshot_date, variant_id, physical_qty, cost_cents)
          select ${t.id}, ${day}::date, l.variant_id, sum(l.qty_remaining)::int, sum(l.cost_remaining_cents)
          from inventory_lots l where l.qty_remaining > 0 group by l.variant_id
          on conflict (tenant_id, snapshot_date, variant_id) do update set physical_qty = excluded.physical_qty, cost_cents = excluded.cost_cents`.execute(trx),
    );
  }
  return tenants.length;
}

export async function runPeriodicJobs(deps: AppDeps) {
  const reservations = await expireReservations(deps);
  const subs = await runSubscriptionLifecycle(deps.dbs.platform);
  return { reservations, subscriptionTransitions: subs.transitions };
}

export async function queueHealth(deps: AppDeps) {
  const r = await sql<{ pending: number; dead: number; oldest: Date | null }>`
    select count(*) filter (where status in ('pending','processing'))::int as pending,
           count(*) filter (where status = 'dead')::int as dead,
           min(available_at) filter (where status = 'pending') as oldest
    from outbox_events`.execute(deps.dbs.platform);
  return r.rows[0]!;
}
