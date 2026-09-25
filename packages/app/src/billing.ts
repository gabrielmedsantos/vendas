import { sql, type Db, type Tx } from '@gct/db';
import { SUBSCRIPTION_TRANSITIONS } from '@gct/domain';
import { AppError, invalid, notFound } from '@gct/shared';
import { requirePermission, tx, type Actor, type AppDeps } from './core';

export type LimitKey = 'users' | 'products' | 'storage_mb' | 'monthly_sales';

export interface Entitlements {
  planCode: string;
  planName: string;
  status: string;
  limits: Partial<Record<LimitKey, number | null>>;
  features: string[];
  trialEndsAt: Date | null;
  currentPeriodEnd: Date;
  cancelAtPeriodEnd: boolean;
  priceMonthlyCents: bigint;
}

export async function getEntitlements(trx: Tx, tenantId: string): Promise<Entitlements> {
  const row = await trx
    .selectFrom('subscriptions as s')
    .innerJoin('plan_versions as pv', 'pv.id', 's.plan_version_id')
    .innerJoin('plans as p', 'p.id', 'pv.plan_id')
    .select([
      'p.code',
      'p.name',
      's.status',
      'pv.limits',
      'pv.features',
      's.trial_ends_at',
      's.current_period_end',
      's.cancel_at_period_end',
      'pv.price_monthly_cents',
    ])
    .where('s.tenant_id', '=', tenantId)
    .executeTakeFirst();
  if (!row) throw new AppError('internal', 'Assinatura não encontrada para a empresa.');
  return {
    planCode: row.code,
    planName: row.name,
    status: row.status,
    limits: row.limits as Entitlements['limits'],
    features: row.features,
    trialEndsAt: row.trial_ends_at,
    currentPeriodEnd: row.current_period_end,
    cancelAtPeriodEnd: row.cancel_at_period_end,
    priceMonthlyCents: row.price_monthly_cents,
  };
}

async function currentUsage(trx: Tx, tenantId: string, key: LimitKey): Promise<number> {
  switch (key) {
    case 'users': {
      const r = await sql<{ n: bigint }>`
        select (select count(*) from memberships where tenant_id = ${tenantId} and status = 'active')
             + (select count(*) from invites where tenant_id = ${tenantId} and accepted_at is null and revoked_at is null and expires_at > now()) as n`.execute(trx);
      return Number(r.rows[0]!.n);
    }
    case 'products': {
      const r = await sql<{ n: bigint }>`select count(*) as n from products where tenant_id = ${tenantId} and status <> 'archived'`.execute(trx);
      return Number(r.rows[0]!.n);
    }
    case 'storage_mb': {
      const r = await sql<{ n: bigint }>`select (coalesce(sum(size_bytes), 0) / 1048576)::bigint as n from attachments where tenant_id = ${tenantId}`.execute(trx);
      return Number(r.rows[0]!.n);
    }
    case 'monthly_sales': {
      const r = await sql<{ n: bigint }>`
        select count(*) as n from sales s join tenants t on t.id = s.tenant_id
        where s.tenant_id = ${tenantId} and s.status <> 'draft' and s.status <> 'canceled'
          and s.sale_date >= date_trunc('month', (now() at time zone t.timezone))::date`.execute(trx);
      return Number(r.rows[0]!.n);
    }
  }
}

/** Limite do plano aplicado no servidor. Exceder não apaga dados: bloqueia expansão. */
export async function checkLimit(trx: Tx, tenantId: string, key: LimitKey, adding = 1): Promise<void> {
  const ent = await getEntitlements(trx, tenantId);
  const limit = ent.limits[key];
  if (limit === undefined || limit === null) return;
  const used = await currentUsage(trx, tenantId, key);
  if (used + adding > limit) {
    const labels: Record<LimitKey, string> = {
      users: 'usuários',
      products: 'produtos',
      storage_mb: 'armazenamento (MB)',
      monthly_sales: 'vendas no mês',
    };
    throw new AppError('plan_limit', `Limite do plano atingido: ${labels[key]} (${limit}). Altere o plano para continuar.`);
  }
}

export async function requireFeature(trx: Tx, tenantId: string, feature: string): Promise<void> {
  const ent = await getEntitlements(trx, tenantId);
  if (!ent.features.includes(feature)) throw new AppError('plan_limit', 'Recurso não incluído no plano atual.');
}

export async function getBillingOverview(deps: AppDeps, actor: Actor) {
  return tx(deps, actor, async (trx) => {
    const ent = await getEntitlements(trx, actor.tenantId);
    const usage: Record<string, number> = {};
    for (const k of ['users', 'products', 'storage_mb', 'monthly_sales'] as LimitKey[]) usage[k] = await currentUsage(trx, actor.tenantId, k);
    const invoices = await trx
      .selectFrom('billing_invoices')
      .select(['id', 'period_start', 'period_end', 'amount_cents', 'status', 'due_date', 'paid_at'])
      .orderBy('period_start', 'desc')
      .limit(24)
      .execute();
    const events = await trx
      .selectFrom('subscription_events')
      .select(['from_status', 'to_status', 'reason', 'created_at'])
      .orderBy('created_at', 'desc')
      .limit(20)
      .execute();
    return { entitlements: ent, usage, invoices, events };
  });
}

/** Cancelamento ao fim do período (política padrão); não apaga dados. */
export async function setCancelAtPeriodEnd(deps: AppDeps, actor: Actor, cancel: boolean): Promise<void> {
  requirePermission(actor, 'billing.manage');
  await tx(deps, actor, async (trx) => {
    const r = await trx.updateTable('subscriptions').set({ cancel_at_period_end: cancel }).where('tenant_id', '=', actor.tenantId).executeTakeFirst();
    if (!r.numUpdatedRows) throw notFound('Assinatura');
    await trx
      .insertInto('audit_events')
      .values({ tenant_id: actor.tenantId, user_id: actor.userId, action: cancel ? 'billing.cancel_requested' : 'billing.cancel_reverted', entity: 'subscription', entity_id: actor.tenantId })
      .execute();
  });
}

// ---------------------------------------------------------------------------
// Control plane (papel gct_platform)

export async function transitionSubscription(
  platform: Db,
  tenantId: string,
  to: 'trialing' | 'active' | 'past_due' | 'suspended' | 'canceled',
  reason: string,
  actorId: string,
  idempotencyKey?: string,
): Promise<{ changed: boolean }> {
  return platform.transaction().execute(async (trx) => {
    if (idempotencyKey) {
      const seen = await trx.selectFrom('subscription_events').select('id').where('idempotency_key', '=', idempotencyKey).executeTakeFirst();
      if (seen) return { changed: false };
    }
    const sub = await trx.selectFrom('subscriptions').selectAll().where('tenant_id', '=', tenantId).forUpdate().executeTakeFirst();
    if (!sub) throw notFound('Assinatura');
    const from = sub.status as keyof typeof SUBSCRIPTION_TRANSITIONS;
    if (from === to) return { changed: false };
    if (!SUBSCRIPTION_TRANSITIONS[from].includes(to)) throw invalid(`Transição de assinatura inválida: ${from} → ${to}.`);
    await trx
      .updateTable('subscriptions')
      .set({ status: to, canceled_at: to === 'canceled' ? new Date() : null })
      .where('id', '=', sub.id)
      .execute();
    await trx
      .insertInto('subscription_events')
      .values({ tenant_id: tenantId, subscription_id: sub.id, from_status: from, to_status: to, reason, actor: actorId, idempotency_key: idempotencyKey ?? null })
      .execute();
    // Suspensão bloqueia novas operações; reativação libera. Nunca apaga dados.
    const tenantStatus = to === 'suspended' ? 'suspended' : to === 'active' || to === 'trialing' ? 'active' : undefined;
    if (tenantStatus) await trx.updateTable('tenants').set({ status: tenantStatus, status_reason: reason }).where('id', '=', tenantId).execute();
    return { changed: true };
  });
}

/**
 * Rotina periódica: trial vencido → past_due; past_due além da tolerância → suspended;
 * cancel_at_period_end no fim do período → canceled.
 */
export async function runSubscriptionLifecycle(platform: Db, now = new Date()): Promise<{ transitions: number }> {
  const subs = await platform.selectFrom('subscriptions').selectAll().where('status', 'in', ['trialing', 'active', 'past_due']).execute();
  let transitions = 0;
  for (const s of subs) {
    const periodEnded = s.current_period_end <= now;
    let target: 'past_due' | 'suspended' | 'canceled' | null = null;
    let reason = '';
    if (s.cancel_at_period_end && periodEnded) {
      target = 'canceled';
      reason = 'Cancelamento ao fim do período';
    } else if (s.status === 'trialing' && s.trial_ends_at && s.trial_ends_at <= now) {
      target = 'past_due';
      reason = 'Período de teste encerrado';
    } else if (s.status === 'past_due' && s.current_period_end.getTime() + s.grace_days * 86400000 <= now.getTime()) {
      target = 'suspended';
      reason = 'Tolerância de pagamento excedida';
    }
    if (target) {
      const key = `lifecycle:${s.id}:${target}:${s.current_period_end.toISOString()}`;
      const r = await transitionSubscription(platform, s.tenant_id, target, reason, 'system', key);
      if (r.changed) transitions++;
    }
  }
  return { transitions };
}
