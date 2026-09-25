import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { jsonb, sql, type Db } from '@gct/db';
import { AppError, conflict, forbidden, invalid, notFound } from '@gct/shared';
import { transitionSubscription } from './billing';
import type { AppDeps } from './core';
import { zCentsNonNeg, zLocalDate, zText, zUuid } from './validation';

/**
 * Painel do operador da plataforma (control plane). Acesso separado dos
 * tenants: usuário em platform_admins + 2FA ativo. Toda ação exige motivo e
 * fica em platform_audit. Não expõe vendas/clientes das empresas.
 */
export interface PlatformAdmin {
  userId: string;
  role: 'admin' | 'support';
}

export async function resolvePlatformAdmin(deps: AppDeps, user: { id: string; twoFactorEnabled?: boolean | null }): Promise<PlatformAdmin> {
  const a = await deps.dbs.platform.selectFrom('platform_admins').select(['user_id', 'role']).where('user_id', '=', user.id).executeTakeFirst();
  if (!a) throw new AppError('not_found', 'Página não encontrada.');
  if (!user.twoFactorEnabled && process.env.PLATFORM_REQUIRE_2FA !== 'false')
    throw forbidden('Ative a verificação em duas etapas para acessar a administração da plataforma.');
  return { userId: a.user_id, role: a.role as PlatformAdmin['role'] };
}

async function platformAudit(db: Db, admin: PlatformAdmin, action: string, tenantId: string | null, reason: string, data: Record<string, unknown> = {}) {
  if (!reason || reason.trim().length < 3) throw invalid('Informe o motivo da ação administrativa.');
  await db.insertInto('platform_audit').values({ admin_user_id: admin.userId, action, tenant_id: tenantId, reason, data: jsonb(data) }).execute();
}

export async function platformOverview(deps: AppDeps) {
  const r = await sql<{ tenants: number; active: number; suspended: number; trialing: number; past_due: number; mrr: bigint; dead: number; pending: number; webhook_failed: number }>`
    select (select count(*) from tenants)::int as tenants,
           (select count(*) from subscriptions where status = 'active')::int as active,
           (select count(*) from subscriptions where status = 'suspended')::int as suspended,
           (select count(*) from subscriptions where status = 'trialing')::int as trialing,
           (select count(*) from subscriptions where status = 'past_due')::int as past_due,
           (select coalesce(sum(case when s.billing_interval = 'yearly' then coalesce(pv.price_yearly_cents, 0) / 12 else pv.price_monthly_cents end), 0)
              from subscriptions s join plan_versions pv on pv.id = s.plan_version_id where s.status = 'active')::bigint as mrr,
           (select count(*) from outbox_events where status = 'dead')::int as dead,
           (select count(*) from outbox_events where status in ('pending','processing'))::int as pending,
           (select count(*) from webhook_events where result like 'erro%')::int as webhook_failed`.execute(deps.dbs.platform);
  return {
    ...r.rows[0]!,
    note: 'Receita recorrente mensal (MRR) considera apenas assinaturas ativas pelo preço da versão do plano; não inclui trials nem inadimplentes.',
  };
}

export async function platformTenants(deps: AppDeps, q?: string) {
  let query = deps.dbs.platform
    .selectFrom('tenants as t')
    .leftJoin('subscriptions as s', 's.tenant_id', 't.id')
    .leftJoin('plan_versions as pv', 'pv.id', 's.plan_version_id')
    .leftJoin('plans as p', 'p.id', 'pv.plan_id')
    .select([
      't.id', 't.name', 't.slug', 't.status', 't.status_reason', 't.created_at', 's.status as subscription_status', 's.current_period_end', 's.trial_ends_at',
      'p.name as plan_name', 'p.code as plan_code',
      sql<number>`(select count(*) from memberships m where m.tenant_id = t.id and m.status = 'active')::int`.as('members'),
    ]);
  if (q) query = query.where((eb) => eb.or([eb('t.name', 'ilike', `%${q.replace(/[%_]/g, '')}%`), eb('t.slug', 'ilike', `%${q.replace(/[%_]/g, '')}%`)]));
  return query.orderBy('t.created_at', 'desc').limit(200).execute();
}

export async function platformSetTenantStatus(deps: AppDeps, admin: PlatformAdmin, tenantId: string, action: 'suspend' | 'reactivate', reason: string) {
  if (admin.role !== 'admin') throw forbidden();
  await platformAudit(deps.dbs.platform, admin, `tenant.${action}`, tenantId, reason);
  return transitionSubscription(deps.dbs.platform, tenantId, action === 'suspend' ? 'suspended' : 'active', reason, `admin:${admin.userId}`);
}

export const zPlanVersion = z.object({
  planCode: z.string().regex(/^[a-z0-9_-]{2,32}$/),
  planName: zText(60).min(2),
  description: zText(300).optional().nullable(),
  public: z.boolean().default(true),
  priceMonthlyCents: zCentsNonNeg,
  priceYearlyCents: zCentsNonNeg.optional().nullable(),
  trialDays: z.number().int().min(0).max(90).default(0),
  limits: z.object({ users: z.number().int().positive().nullable(), products: z.number().int().positive().nullable(), storage_mb: z.number().int().positive().nullable(), monthly_sales: z.number().int().positive().nullable() }),
  features: z.array(z.enum(['catalog', 'catalog_analytics', 'reports_export'])).default([]),
  reason: zText(300).min(3),
});

/** Nova versão de plano: preço novo vale para novas contratações/renovações; versões antigas ficam intactas. */
export async function platformSavePlanVersion(deps: AppDeps, admin: PlatformAdmin, input: z.infer<typeof zPlanVersion>) {
  if (admin.role !== 'admin') throw forbidden();
  return deps.dbs.platform.transaction().execute(async (trx) => {
    let plan = await trx.selectFrom('plans').select('id').where('code', '=', input.planCode).executeTakeFirst();
    if (!plan) plan = await trx.insertInto('plans').values({ code: input.planCode, name: input.planName, description: input.description ?? null, public: input.public }).returning('id').executeTakeFirstOrThrow();
    else await trx.updateTable('plans').set({ name: input.planName, description: input.description ?? null, public: input.public }).where('id', '=', plan.id).execute();
    const last = await trx.selectFrom('plan_versions').select(['id', 'version']).where('plan_id', '=', plan.id).orderBy('version', 'desc').executeTakeFirst();
    const now = new Date();
    if (last) await trx.updateTable('plan_versions').set({ valid_to: now }).where('id', '=', last.id).where('valid_to', 'is', null).execute();
    const v = await trx
      .insertInto('plan_versions')
      .values({
        plan_id: plan.id, version: (last?.version ?? 0) + 1, price_monthly_cents: input.priceMonthlyCents, price_yearly_cents: input.priceYearlyCents ?? null,
        trial_days: input.trialDays, limits: jsonb(input.limits), features: input.features, valid_from: now,
      })
      .returning(['id', 'version'])
      .executeTakeFirstOrThrow();
    await trx.insertInto('platform_audit').values({ admin_user_id: admin.userId, action: 'plan.version_created', tenant_id: null, reason: input.reason, data: jsonb({ planCode: input.planCode, version: v.version }) }).execute();
    return v;
  });
}

export async function platformPlans(deps: AppDeps) {
  return deps.dbs.platform
    .selectFrom('plan_versions as pv')
    .innerJoin('plans as p', 'p.id', 'pv.plan_id')
    .select(['p.code', 'p.name', 'p.public', 'pv.id', 'pv.version', 'pv.price_monthly_cents', 'pv.price_yearly_cents', 'pv.trial_days', 'pv.limits', 'pv.features', 'pv.valid_from', 'pv.valid_to'])
    .orderBy('p.sort_order')
    .orderBy('pv.version', 'desc')
    .execute();
}

/** Troca de plano administrativa (auditada). Downgrade não apaga dados. */
export async function platformChangePlan(deps: AppDeps, admin: PlatformAdmin, tenantId: string, planVersionId: string, reason: string) {
  if (admin.role !== 'admin') throw forbidden();
  await platformAudit(deps.dbs.platform, admin, 'subscription.plan_changed', tenantId, reason, { planVersionId });
  const r = await deps.dbs.platform.updateTable('subscriptions').set({ plan_version_id: planVersionId }).where('tenant_id', '=', tenantId).executeTakeFirst();
  if (!r.numUpdatedRows) throw notFound('Assinatura');
}

export const zInvoice = z.object({ tenantId: zUuid, periodStart: zLocalDate, periodEnd: zLocalDate, amountCents: zCentsNonNeg, dueDate: zLocalDate, reason: zText(300).min(3) });

/** Fatura manual (piloto). Idempotente por empresa + início do período. */
export async function platformCreateInvoice(deps: AppDeps, admin: PlatformAdmin, input: z.infer<typeof zInvoice>) {
  if (admin.role !== 'admin') throw forbidden();
  const sub = await deps.dbs.platform.selectFrom('subscriptions').select('id').where('tenant_id', '=', input.tenantId).executeTakeFirst();
  if (!sub) throw notFound('Assinatura');
  const r = await deps.dbs.platform
    .insertInto('billing_invoices')
    .values({ tenant_id: input.tenantId, subscription_id: sub.id, period_start: input.periodStart, period_end: input.periodEnd, amount_cents: input.amountCents, due_date: input.dueDate })
    .onConflict((oc) => oc.columns(['tenant_id', 'period_start']).doNothing())
    .returning('id')
    .executeTakeFirst();
  if (!r) throw conflict('Já existe fatura para este período.');
  await platformAudit(deps.dbs.platform, admin, 'invoice.created', input.tenantId, input.reason, { invoiceId: r.id });
  return r;
}

/** Registro manual de pagamento (sem gateway). Aplica o mesmo efeito do webhook "invoice.paid". */
export async function platformMarkInvoicePaid(deps: AppDeps, admin: PlatformAdmin, invoiceId: string, reason: string) {
  if (admin.role !== 'admin') throw forbidden();
  const inv = await deps.dbs.platform.selectFrom('billing_invoices').selectAll().where('id', '=', invoiceId).executeTakeFirst();
  if (!inv) throw notFound('Fatura');
  await platformAudit(deps.dbs.platform, admin, 'invoice.marked_paid', inv.tenant_id, reason, { invoiceId });
  await applyBillingEvent(deps, { type: 'invoice.paid', tenantId: inv.tenant_id, periodStart: inv.period_start, periodEnd: inv.period_end, amountCents: inv.amount_cents.toString() }, `manual:${invoiceId}`);
}

export async function platformInvoices(deps: AppDeps, tenantId?: string) {
  let q = deps.dbs.platform.selectFrom('billing_invoices as i').innerJoin('tenants as t', 't.id', 'i.tenant_id').select(['i.id', 'i.tenant_id', 't.name as tenant_name', 'i.period_start', 'i.period_end', 'i.amount_cents', 'i.status', 'i.due_date', 'i.paid_at', 'i.provider']);
  if (tenantId) q = q.where('i.tenant_id', '=', tenantId);
  return q.orderBy('i.created_at', 'desc').limit(200).execute();
}

export async function platformAuditLog(deps: AppDeps) {
  return deps.dbs.platform.selectFrom('platform_audit').selectAll().orderBy('created_at', 'desc').limit(100).execute();
}

export async function platformWebhooks(deps: AppDeps) {
  return deps.dbs.platform.selectFrom('webhook_events').select(['id', 'provider', 'external_id', 'event_type', 'signature_valid', 'received_at', 'processed_at', 'result']).orderBy('received_at', 'desc').limit(100).execute();
}

// ---------------------------------------------------------------------------
// Webhooks de cobrança (adaptador genérico HMAC até o gateway ser escolhido)

export interface BillingEvent {
  type: 'invoice.paid' | 'invoice.payment_failed' | 'subscription.canceled';
  tenantId: string;
  periodStart?: string;
  periodEnd?: string;
  amountCents?: string;
}

const zBillingEvent = z.object({
  id: z.string().min(1).max(200),
  type: z.enum(['invoice.paid', 'invoice.payment_failed', 'subscription.canceled']),
  environment: z.enum(['sandbox', 'production']),
  data: z.object({ tenantId: zUuid, periodStart: zLocalDate.optional(), periodEnd: zLocalDate.optional(), amountCents: z.string().regex(/^\d+$/).optional() }),
});

/**
 * Verifica assinatura sobre o corpo bruto: HMAC-SHA256(secret, `${timestamp}.${body}`),
 * janela de 5 minutos contra replay, ambiente esperado. Só depois persiste.
 */
export function verifyWebhookSignature(rawBody: string, timestamp: string | null, signature: string | null, secret: string, now = Date.now()): boolean {
  if (!timestamp || !signature || !/^\d{10}$/.test(timestamp) || !/^[0-9a-f]{64}$/.test(signature)) return false;
  if (Math.abs(now / 1000 - Number(timestamp)) > 300) return false;
  const expected = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest();
  return timingSafeEqual(expected, Buffer.from(signature, 'hex'));
}

/** Recebe webhook: rejeita assinatura inválida; evento repetido é aceito sem novo efeito. */
export async function receiveBillingWebhook(deps: AppDeps, provider: string, rawBody: string, headers: { timestamp: string | null; signature: string | null }, secret: string | undefined, expectedEnv: string) {
  if (!secret) throw new AppError('forbidden', 'Webhook de cobrança não configurado.');
  if (!verifyWebhookSignature(rawBody, headers.timestamp, headers.signature, secret)) throw new AppError('forbidden', 'Assinatura inválida.');
  let parsed: z.infer<typeof zBillingEvent>;
  try {
    parsed = zBillingEvent.parse(JSON.parse(rawBody));
  } catch {
    throw invalid('Evento malformado.');
  }
  if (parsed.environment !== expectedEnv) throw new AppError('forbidden', 'Ambiente do evento não corresponde.');
  const inserted = await deps.dbs.platform
    .insertInto('webhook_events')
    .values({ provider, external_id: parsed.id, event_type: parsed.type, payload: jsonb(JSON.parse(rawBody)), signature_valid: true })
    .onConflict((oc) => oc.columns(['provider', 'external_id']).doNothing())
    .returning('id')
    .executeTakeFirst();
  return { stored: !!inserted, duplicate: !inserted };
}

/** Processa eventos pendentes (worker). Tolerante a repetição e ordem diferente. */
export async function processWebhookEvents(deps: AppDeps, limit = 50): Promise<number> {
  let n = 0;
  for (; n < limit; n++) {
    // Um evento por vez, travado com SKIP LOCKED: vários workers não aplicam o mesmo evento.
    const done = await deps.dbs.platform.transaction().execute(async (trx) => {
      const e = await trx.selectFrom('webhook_events').selectAll().where('processed_at', 'is', null).orderBy('received_at').limit(1).forUpdate().skipLocked().executeTakeFirst();
      if (!e) return false;
      let result = 'ok';
      try {
        const p = e.payload as { id: string; type: BillingEvent['type']; data: Omit<BillingEvent, 'type'> };
        await applyBillingEvent(deps, { type: p.type, ...p.data }, `${e.provider}:${e.external_id}`);
      } catch (err) {
        result = `erro: ${(err as Error).message}`.slice(0, 300);
      }
      await trx.updateTable('webhook_events').set({ processed_at: new Date(), result }).where('id', '=', e.id).execute();
      return true;
    });
    if (!done) break;
  }
  return n;
}

/**
 * Efeito de cobrança sobre assinatura/fatura. Ordem: "pago" do período vence
 * "falhou" do mesmo período, mesmo que "falhou" chegue depois.
 */
export async function applyBillingEvent(deps: AppDeps, ev: BillingEvent, key: string) {
  const db = deps.dbs.platform;
  if (ev.type === 'subscription.canceled') {
    await transitionSubscription(db, ev.tenantId, 'canceled', 'Cancelada no provedor de cobrança', 'billing', `${key}:canceled`);
    return;
  }
  if (!ev.periodStart || !ev.periodEnd) throw invalid('Evento sem período.');
  const sub = await db.selectFrom('subscriptions').selectAll().where('tenant_id', '=', ev.tenantId).executeTakeFirst();
  if (!sub) throw notFound('Assinatura');
  const inv = await db
    .insertInto('billing_invoices')
    .values({ tenant_id: ev.tenantId, subscription_id: sub.id, period_start: ev.periodStart, period_end: ev.periodEnd, amount_cents: BigInt(ev.amountCents ?? '0'), due_date: ev.periodStart })
    .onConflict((oc) => oc.columns(['tenant_id', 'period_start']).doUpdateSet({ updated_at: new Date() }))
    .returning(['id', 'status'])
    .executeTakeFirstOrThrow();
  if (ev.type === 'invoice.paid') {
    if (inv.status !== 'paid') await db.updateTable('billing_invoices').set({ status: 'paid', paid_at: new Date() }).where('id', '=', inv.id).execute();
    const end = new Date(`${ev.periodEnd}T23:59:59Z`);
    if (end > sub.current_period_end) {
      await db.updateTable('subscriptions').set({ current_period_start: new Date(`${ev.periodStart}T00:00:00Z`), current_period_end: end, trial_ends_at: null }).where('id', '=', sub.id).execute();
    }
    if (sub.status !== 'active') await transitionSubscription(db, ev.tenantId, 'active', 'Pagamento confirmado', 'billing', `${key}:active`);
  } else if (ev.type === 'invoice.payment_failed') {
    if (inv.status === 'paid') return; // fora de ordem: falha antiga não desfaz pagamento
    if (sub.status === 'active' || sub.status === 'trialing') await transitionSubscription(db, ev.tenantId, 'past_due', 'Falha no pagamento', 'billing', `${key}:past_due`);
  }
}
