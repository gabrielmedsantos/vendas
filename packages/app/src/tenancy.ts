import { createHash, randomBytes } from 'node:crypto';
import { sql, withTenant, withUser, type Tx } from '@gct/db';
import { AppError, effectivePermissions, invalid, notFound, slugify, type Permission, type Role, ROLES } from '@gct/shared';
import { audit, requirePermission, type Actor, type AppDeps } from './core';
import { checkLimit } from './billing';

export interface TenantSummary {
  id: string;
  name: string;
  slug: string;
  role: Role;
  status: string;
}

export async function listTenantsForUser(deps: AppDeps, userId: string): Promise<TenantSummary[]> {
  return withUser(deps.dbs.app, userId, async (trx) => {
    const rows = await trx
      .selectFrom('memberships as m')
      .innerJoin('tenants as t', 't.id', 'm.tenant_id')
      .select(['t.id', 't.name', 't.slug', 'm.role', 't.status'])
      .where('m.user_id', '=', userId)
      .where('m.status', '=', 'active')
      .orderBy('t.name')
      .execute();
    return rows.map((r) => ({ ...r, role: r.role as Role }));
  });
}

/**
 * Valida sessão → membership ativa → empresa → permissões. Empresa inexistente
 * ou sem vínculo retorna o mesmo 404 (não revela existência).
 */
export async function resolveActor(deps: AppDeps, userId: string, tenantId: string, requestId?: string): Promise<Actor> {
  if (!/^[0-9a-f-]{36}$/i.test(tenantId)) throw notFound('Empresa');
  return withTenant(deps.dbs.app, { tenantId, userId }, async (trx) => {
    const row = await trx
      .selectFrom('memberships as m')
      .innerJoin('tenants as t', 't.id', 'm.tenant_id')
      .select(['m.id', 'm.role', 'm.grants', 'm.revokes', 'm.discount_limit_bps', 't.timezone', 't.status'])
      .where('m.tenant_id', '=', tenantId)
      .where('m.user_id', '=', userId)
      .where('m.status', '=', 'active')
      .executeTakeFirst();
    if (!row) throw notFound('Empresa');
    const role = row.role as Role;
    return {
      userId,
      tenantId,
      membershipId: row.id,
      role,
      permissions: effectivePermissions(role, row.grants, row.revokes),
      discountLimitBps: role === 'owner' || role === 'manager' ? 10000 : row.discount_limit_bps,
      timezone: row.timezone,
      tenantStatus: row.status as Actor['tenantStatus'],
      requestId,
    };
  });
}

export interface ProvisionInput {
  name: string;
  slug?: string;
  timezone?: string;
  document?: string;
  /** Código de indicação (opcional). Inválido ou autoindicação é ignorado sem bloquear o cadastro. */
  referralCode?: string;
}

/**
 * Cria empresa + proprietário + assinatura inicial (control plane, papel
 * gct_platform) e depois os cadastros padrão dentro do contexto do tenant.
 */
export async function provisionTenant(deps: AppDeps, userId: string, input: ProvisionInput): Promise<{ tenantId: string }> {
  const name = input.name.trim();
  if (name.length < 2 || name.length > 120) throw invalid('Nome da empresa deve ter entre 2 e 120 caracteres.', { name: 'inválido' });
  const tz = input.timezone ?? 'America/Sao_Paulo';
  try {
    new Intl.DateTimeFormat('pt-BR', { timeZone: tz });
  } catch {
    throw invalid('Fuso horário inválido.', { timezone: 'inválido' });
  }
  const baseSlug = slugify(input.slug || name) || 'empresa';
  const tenantId = await deps.dbs.platform.transaction().execute(async (trx) => {
    let slug = baseSlug.length >= 2 ? baseSlug : `${baseSlug}-empresa`;
    for (let i = 0; i < 20; i++) {
      const exists = await trx.selectFrom('tenants').select('id').where('slug', '=', slug).executeTakeFirst();
      if (!exists) break;
      slug = `${baseSlug.slice(0, 40)}-${randomBytes(2).toString('hex')}`;
    }
    const tenant = await trx
      .insertInto('tenants')
      .values({ name, slug, timezone: tz, document: input.document ?? null, created_by: userId })
      .returning('id')
      .executeTakeFirstOrThrow();
    await trx.insertInto('memberships').values({ tenant_id: tenant.id, user_id: userId, role: 'owner' }).execute();

    // Trial apenas uma vez por usuário; depois, plano gratuito.
    const claimed = await trx.selectFrom('trial_claims').select('user_id').where('user_id', '=', userId).executeTakeFirst();
    const planCode = claimed ? 'gratuito' : 'piloto';
    const pv = await trx
      .selectFrom('plan_versions as pv')
      .innerJoin('plans as p', 'p.id', 'pv.plan_id')
      .select(['pv.id', 'pv.trial_days'])
      .where('p.code', '=', planCode)
      .where('pv.valid_to', 'is', null)
      .orderBy('pv.version', 'desc')
      .executeTakeFirst();
    if (!pv) throw new AppError('internal', 'Plano padrão não configurado.');
    const now = new Date();
    const trial = !claimed && pv.trial_days > 0;
    const periodEnd = new Date(now.getTime() + (trial ? pv.trial_days : 30) * 86400000);
    const sub = await trx
      .insertInto('subscriptions')
      .values({
        tenant_id: tenant.id,
        plan_version_id: pv.id,
        status: trial ? 'trialing' : 'active',
        trial_ends_at: trial ? periodEnd : null,
        current_period_start: now,
        current_period_end: periodEnd,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await trx
      .insertInto('subscription_events')
      .values({ tenant_id: tenant.id, subscription_id: sub.id, to_status: trial ? 'trialing' : 'active', reason: 'Criação da empresa', actor: userId })
      .execute();
    if (!claimed) await trx.insertInto('trial_claims').values({ user_id: userId, tenant_id: tenant.id }).execute();
    if (input.referralCode) {
      const ref = await trx.selectFrom('referral_codes').select('tenant_id').where('code', '=', input.referralCode.trim().toUpperCase()).executeTakeFirst();
      const own = ref && (await trx.selectFrom('memberships').select('user_id').where('tenant_id', '=', ref.tenant_id).where('user_id', '=', userId).executeTakeFirst());
      if (ref && !own) await trx.insertInto('referrals').values({ referrer_tenant_id: ref.tenant_id, referred_tenant_id: tenant.id }).execute();
    }
    return tenant.id;
  });

  await withTenant(deps.dbs.app, { tenantId, userId }, async (trx) => {
    await seedTenantDefaults(trx, tenantId);
    await audit(trx, { tenantId, userId }, 'tenant.created', 'tenant', tenantId, { name });
  });
  return { tenantId };
}

/** Cadastros padrão de uma empresa nova (local, contas, formas de pagamento, canal). */
export async function seedTenantDefaults(trx: Tx, tenantId: string): Promise<void> {
  await trx.insertInto('locations').values({ tenant_id: tenantId, name: 'Loja principal', is_default: true }).execute();
  const accounts = await trx
    .insertInto('financial_accounts')
    .values([
      { tenant_id: tenantId, name: 'Caixa da loja', kind: 'cash' },
      { tenant_id: tenantId, name: 'Conta bancária', kind: 'bank' },
    ])
    .returning(['id', 'kind'])
    .execute();
  const cash = accounts.find((a) => a.kind === 'cash')!.id;
  const bank = accounts.find((a) => a.kind === 'bank')!.id;
  await trx
    .insertInto('payment_methods')
    .values([
      { tenant_id: tenantId, name: 'Dinheiro', kind: 'cash', account_id: cash },
      { tenant_id: tenantId, name: 'Pix', kind: 'pix', account_id: bank },
      { tenant_id: tenantId, name: 'Cartão de débito', kind: 'debit', account_id: bank, settlement_days: 1 },
      { tenant_id: tenantId, name: 'Cartão de crédito', kind: 'credit', account_id: bank, settlement_days: 30 },
      { tenant_id: tenantId, name: 'Transferência', kind: 'bank_transfer', account_id: bank },
      { tenant_id: tenantId, name: 'Crediário / fiado', kind: 'installment' },
      { tenant_id: tenantId, name: 'Crédito da loja', kind: 'store_credit' },
    ])
    .execute();
  await trx.insertInto('sales_channels').values({ tenant_id: tenantId, name: 'Loja física' }).execute();
  await trx
    .insertInto('expense_categories')
    .values(['Aluguel', 'Energia e internet', 'Salários', 'Marketing', 'Frete de venda', 'Outras'].map((name) => ({ tenant_id: tenantId, name })))
    .execute();
}

// ---------------------------------------------------------------------------
// Membros e convites

export async function listMembers(deps: AppDeps, actor: Actor) {
  requirePermission(actor, 'members.manage');
  return withTenant(deps.dbs.app, actor, async (trx) => {
    const members = await trx.selectFrom('member_directory').selectAll().where('status', '=', 'active').orderBy('name').execute();
    const invites = await trx
      .selectFrom('invites')
      .select(['id', 'email', 'label', 'role', 'expires_at', 'created_at'])
      .where('accepted_at', 'is', null)
      .where('revoked_at', 'is', null)
      .where('expires_at', '>', new Date())
      .orderBy('created_at', 'desc')
      .execute();
    return { members, invites };
  });
}

export const ROLES_FOR_INVITE = ['owner', 'manager', 'seller', 'stock', 'finance', 'viewer'] as const;

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function createInvite(
  deps: AppDeps,
  actor: Actor,
  input: { email?: string | null; role: Role; label?: string | null },
  appUrl: string,
): Promise<{ inviteId: string; link: string; emailSent: boolean }> {
  requirePermission(actor, 'members.manage');
  // Sem e-mail = convite por link: vale uma vez, para quem abrir primeiro, por 7 dias.
  const email = input.email?.trim().toLowerCase() || null;
  const label = input.label?.trim().slice(0, 80) || null;
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw invalid('E-mail inválido.', { email: 'inválido' });
  if (!ROLES.includes(input.role)) throw invalid('Papel inválido.', { role: 'inválido' });
  if (input.role === 'owner' && actor.role !== 'owner') throw new AppError('forbidden', 'Somente proprietários convidam proprietários.');
  if (input.role === 'owner' && !email) throw invalid('Convite de proprietário precisa do e-mail da pessoa.', { email: 'obrigatório' });
  const token = randomBytes(32).toString('base64url');
  const inviteId = await withTenant(deps.dbs.app, actor, async (trx) => {
    await checkLimit(trx, actor.tenantId, 'users', 1);
    const row = await trx
      .insertInto('invites')
      .values({
        tenant_id: actor.tenantId,
        email,
        label,
        role: input.role,
        token_hash: hashToken(token),
        expires_at: new Date(Date.now() + 7 * 86400000),
        created_by: actor.userId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await audit(trx, actor, 'member.invited', 'invite', row.id, { role: input.role, byLink: !email });
    return row.id;
  });
  const link = `${appUrl}/convite/${token}`;
  let emailSent = false;
  if (deps.mailer.enabled && email) {
    await deps.mailer.send({
      to: email,
      subject: 'Convite para Gestão Compra e Troca',
      text: `Você foi convidado para participar de uma empresa. Acesse: ${link}\nO convite expira em 7 dias e só pode ser usado uma vez.`,
    });
    emailSent = true;
  }
  return { inviteId, link, emailSent };
}

/** Aceite: token de uso único, não expirado, e-mail igual ao da conta logada. */
export async function acceptInvite(deps: AppDeps, user: { id: string; email: string }, token: string): Promise<{ tenantId: string }> {
  const hash = hashToken(token);
  return deps.dbs.platform.transaction().execute(async (trx) => {
    const inv = await trx
      .selectFrom('invites')
      .selectAll()
      .where('token_hash', '=', hash)
      .forUpdate()
      .executeTakeFirst();
    if (!inv || inv.accepted_at || inv.revoked_at || inv.expires_at < new Date()) throw invalid('Convite inválido ou expirado.');
    if (inv.email && inv.email.toLowerCase() !== user.email.toLowerCase())
      throw new AppError('forbidden', 'Este convite foi enviado para outro e-mail.');
    await trx
      .insertInto('memberships')
      .values({ tenant_id: inv.tenant_id, user_id: user.id, role: inv.role })
      .onConflict((oc) => oc.columns(['tenant_id', 'user_id']).doUpdateSet({ role: inv.role, status: 'active' }))
      .execute();
    await trx.updateTable('invites').set({ accepted_at: new Date(), accepted_by: user.id }).where('id', '=', inv.id).execute();
    return { tenantId: inv.tenant_id };
  });
}

export async function revokeInvite(deps: AppDeps, actor: Actor, inviteId: string): Promise<void> {
  requirePermission(actor, 'members.manage');
  await withTenant(deps.dbs.app, actor, async (trx) => {
    const r = await trx.updateTable('invites').set({ revoked_at: new Date() }).where('id', '=', inviteId).where('accepted_at', 'is', null).executeTakeFirst();
    if (!r.numUpdatedRows) throw notFound('Convite');
    await audit(trx, actor, 'member.invite_revoked', 'invite', inviteId);
  });
}

export async function updateMember(
  deps: AppDeps,
  actor: Actor,
  membershipId: string,
  input: { role?: Role; grants?: Permission[]; revokes?: Permission[]; discountLimitBps?: number; remove?: boolean },
): Promise<void> {
  requirePermission(actor, 'members.manage');
  await withTenant(deps.dbs.app, actor, async (trx) => {
    // Lock de todos os proprietários: impede remoção concorrente do último.
    const owners = await sql<{ id: string }>`
      select id from memberships where tenant_id = ${actor.tenantId} and role = 'owner' and status = 'active' for update`.execute(trx);
    const m = await trx.selectFrom('memberships').selectAll().where('id', '=', membershipId).forUpdate().executeTakeFirst();
    if (!m || m.status !== 'active') throw notFound('Membro');
    const losingOwner = m.role === 'owner' && (input.remove || (input.role && input.role !== 'owner'));
    if (losingOwner && owners.rows.length <= 1) throw new AppError('conflict', 'A empresa precisa de ao menos um proprietário.');
    if ((m.role === 'owner' || input.role === 'owner') && actor.role !== 'owner')
      throw new AppError('forbidden', 'Somente proprietários alteram proprietários.');
    if (input.role && !ROLES.includes(input.role)) throw invalid('Papel inválido.');
    if (input.discountLimitBps !== undefined && (input.discountLimitBps < 0 || input.discountLimitBps > 10000))
      throw invalid('Limite de desconto inválido.');
    await trx
      .updateTable('memberships')
      .set({
        role: input.role ?? m.role,
        grants: input.grants ?? m.grants,
        revokes: input.revokes ?? m.revokes,
        discount_limit_bps: input.discountLimitBps ?? m.discount_limit_bps,
        status: input.remove ? 'removed' : m.status,
      })
      .where('id', '=', membershipId)
      .execute();
    await audit(trx, actor, input.remove ? 'member.removed' : 'member.updated', 'membership', membershipId, {
      role: input.role,
      grants: input.grants,
      revokes: input.revokes,
    });
  });
}

// ---------------------------------------------------------------------------
// Empresa

export async function getTenantProfile(deps: AppDeps, actor: Actor) {
  return withTenant(deps.dbs.app, actor, (trx) =>
    trx
      .selectFrom('tenants')
      .select(['id', 'name', 'legal_name', 'document', 'slug', 'timezone', 'currency', 'status', 'email', 'phone', 'address', 'settings', 'onboarding'])
      .where('id', '=', actor.tenantId)
      .executeTakeFirstOrThrow(),
  );
}

export async function updateTenantProfile(
  deps: AppDeps,
  actor: Actor,
  input: { name?: string; legalName?: string | null; document?: string | null; timezone?: string; email?: string | null; phone?: string | null; address?: Record<string, string>; settings?: Record<string, unknown> },
): Promise<void> {
  requirePermission(actor, 'settings.manage');
  if (input.timezone) {
    try {
      new Intl.DateTimeFormat('pt-BR', { timeZone: input.timezone });
    } catch {
      throw invalid('Fuso horário inválido.', { timezone: 'inválido' });
    }
  }
  await withTenant(deps.dbs.app, actor, async (trx) => {
    const cur = await trx.selectFrom('tenants').select(['settings']).where('id', '=', actor.tenantId).executeTakeFirstOrThrow();
    await trx
      .updateTable('tenants')
      .set({
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.legalName !== undefined ? { legal_name: input.legalName } : {}),
        ...(input.document !== undefined ? { document: input.document } : {}),
        ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
        ...(input.email !== undefined ? { email: input.email } : {}),
        ...(input.phone !== undefined ? { phone: input.phone } : {}),
        ...(input.address !== undefined ? { address: JSON.stringify(input.address) } : {}),
        ...(input.settings !== undefined
          ? { settings: JSON.stringify({ ...(cur.settings as object), ...input.settings }) }
          : {}),
      })
      .where('id', '=', actor.tenantId)
      .execute();
    await audit(trx, actor, 'tenant.updated', 'tenant', actor.tenantId, { fields: Object.keys(input) });
  });
}
