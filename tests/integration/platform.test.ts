import { createHmac, randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  applyBillingEvent, createProduct, getReferralInfo, platformReferrals, platformSetReferralStatus, provisionTenant, platformCreateInvoice, platformMarkInvoicePaid, platformOverview, platformSetTenantStatus, processWebhookEvents,
  receiveBillingWebhook, resolveActor, resolvePlatformAdmin, verifyWebhookSignature, zProduct, type PlatformAdmin,
} from '@gct/app';
import { closeDeps, createTenant, createUser, testDeps, type TenantFixture } from './helpers';
import { URLS } from './env';

const deps = testDeps();
const SECRET = 'segredo-de-teste-nao-usado-em-producao';
let T: TenantFixture;
let admin: PlatformAdmin;

function sign(body: string, ts = Math.floor(Date.now() / 1000)) {
  return { timestamp: String(ts), signature: createHmac('sha256', SECRET).update(`${ts}.${body}`).digest('hex') };
}
const ev = (id: string, type: string, tenantId: string, periodStart = '2026-10-01', periodEnd = '2026-10-31') =>
  JSON.stringify({ id, type, environment: 'sandbox', data: { tenantId, periodStart, periodEnd, amountCents: '4900' } });

async function sub(tenantId: string) {
  return deps.dbs.platform.selectFrom('subscriptions').selectAll().where('tenant_id', '=', tenantId).executeTakeFirstOrThrow();
}

beforeAll(async () => {
  T = await createTenant(deps, 'Empresa Demo Plataforma');
  const u = await createUser(deps, 'Operador Plataforma');
  const owner = new pg.Client({ connectionString: URLS.owner });
  await owner.connect();
  await owner.query(`insert into platform_admins (user_id, role) values ($1, 'admin')`, [u.id]);
  await owner.end();
  admin = await resolvePlatformAdmin(deps, { id: u.id, twoFactorEnabled: true });
});
afterAll(closeDeps);

describe('administração da plataforma', () => {
  it('exige cadastro em platform_admins e 2FA', async () => {
    const outsider = await createUser(deps);
    await expect(resolvePlatformAdmin(deps, { id: outsider.id, twoFactorEnabled: true })).rejects.toMatchObject({ code: 'not_found' });
    await expect(resolvePlatformAdmin(deps, { id: admin.userId, twoFactorEnabled: false })).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('suspensão exige motivo, bloqueia escrita, preserva dados e é auditada', async () => {
    await expect(platformSetTenantStatus(deps, admin, T.tenantId, 'suspend', '')).rejects.toMatchObject({ code: 'validation_failed' });
    await platformSetTenantStatus(deps, admin, T.tenantId, 'suspend', 'Teste de suspensão');
    const actor = await resolveActor(deps, T.ownerUser.id, T.tenantId);
    const input = zProduct.parse({ name: 'Bloqueado', variants: [{ sku: 'BLQ-1', retailPriceCents: '100' }] });
    await expect(createProduct(deps, actor, input)).rejects.toMatchObject({ status: 403 });
    await platformSetTenantStatus(deps, admin, T.tenantId, 'reactivate', 'Teste de reativação');
    const again = await resolveActor(deps, T.ownerUser.id, T.tenantId);
    await expect(createProduct(deps, again, input)).resolves.toBeTruthy();
    const log = await deps.dbs.platform.selectFrom('platform_audit').select('action').where('tenant_id', '=', T.tenantId).execute();
    expect(log.map((l) => l.action)).toEqual(expect.arrayContaining(['tenant.suspend', 'tenant.reactivate']));
    const o = await platformOverview(deps);
    expect(o.tenants).toBeGreaterThan(0);
  });

  it('fatura manual: pagamento manual ativa assinatura e estende período', async () => {
    const t = await createTenant(deps, 'Empresa Demo Fatura');
    const inv = await platformCreateInvoice(deps, admin, { tenantId: t.tenantId, periodStart: '2026-11-01', periodEnd: '2026-11-30', amountCents: 9900n, dueDate: '2026-11-05', reason: 'Piloto' });
    await expect(platformCreateInvoice(deps, admin, { tenantId: t.tenantId, periodStart: '2026-11-01', periodEnd: '2026-11-30', amountCents: 9900n, dueDate: '2026-11-05', reason: 'Piloto' })).rejects.toMatchObject({ code: 'conflict' });
    await platformMarkInvoicePaid(deps, admin, inv.id, 'Pix recebido e conferido');
    const s = await sub(t.tenantId);
    expect(s.status).toBe('active');
    expect(s.current_period_end.toISOString().slice(0, 10)).toBe('2026-11-30');
  });
});

describe('T-022: webhook de cobrança duplicado ou fora de ordem', () => {
  it('rejeita assinatura inválida, expirada ou de outro ambiente sem gravar nada', async () => {
    const body = ev(`evt-${randomUUID()}`, 'invoice.paid', T.tenantId);
    await expect(receiveBillingWebhook(deps, 'generic', body, { timestamp: String(Math.floor(Date.now() / 1000)), signature: 'a'.repeat(64) }, SECRET, 'sandbox')).rejects.toMatchObject({ code: 'forbidden' });
    const old = sign(body, Math.floor(Date.now() / 1000) - 3600);
    expect(verifyWebhookSignature(body, old.timestamp, old.signature, SECRET)).toBe(false);
    await expect(receiveBillingWebhook(deps, 'generic', body, sign(body), SECRET, 'production')).rejects.toMatchObject({ code: 'forbidden' });
    await expect(receiveBillingWebhook(deps, 'generic', body, sign(body), undefined, 'sandbox')).rejects.toMatchObject({ code: 'forbidden' });
    const tampered = body.replace('4900', '1');
    await expect(receiveBillingWebhook(deps, 'generic', tampered, sign(body), SECRET, 'sandbox')).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('duplicado aplica uma vez; falha antiga que chega depois não desfaz pagamento', async () => {
    const t = await createTenant(deps, 'Empresa Demo Webhook');
    const paidId = `evt-${randomUUID()}`;
    const paid = ev(paidId, 'invoice.paid', t.tenantId);
    const r1 = await receiveBillingWebhook(deps, 'generic', paid, sign(paid), SECRET, 'sandbox');
    const r2 = await receiveBillingWebhook(deps, 'generic', paid, sign(paid), SECRET, 'sandbox');
    expect(r1.duplicate).toBe(false);
    expect(r2.duplicate).toBe(true);
    const failed = ev(`evt-${randomUUID()}`, 'invoice.payment_failed', t.tenantId);
    await receiveBillingWebhook(deps, 'generic', failed, sign(failed), SECRET, 'sandbox');

    // Dois processadores concorrentes: cada evento é aplicado uma vez.
    await Promise.all([processWebhookEvents(deps), processWebhookEvents(deps)]);

    const s = await sub(t.tenantId);
    expect(s.status).toBe('active');
    const events = await deps.dbs.platform.selectFrom('subscription_events').select(['to_status']).where('tenant_id', '=', t.tenantId).where('to_status', '=', 'active').execute();
    expect(events).toHaveLength(1);
    const invoices = await deps.dbs.platform.selectFrom('billing_invoices').select(['status']).where('tenant_id', '=', t.tenantId).execute();
    expect(invoices).toEqual([{ status: 'paid' }]);
    const stored = await deps.dbs.platform.selectFrom('webhook_events').select(['result', 'processed_at']).where('external_id', '=', paidId).execute();
    expect(stored).toHaveLength(1);
    expect(stored[0]!.result).toBe('ok');
  });

  it('falha de pagamento em assinatura ativa sem pagamento do período → inadimplente', async () => {
    const t = await createTenant(deps, 'Empresa Demo Falha');
    const failed = ev(`evt-${randomUUID()}`, 'invoice.payment_failed', t.tenantId, '2026-12-01', '2026-12-31');
    await receiveBillingWebhook(deps, 'generic', failed, sign(failed), SECRET, 'sandbox');
    await processWebhookEvents(deps);
    expect((await sub(t.tenantId)).status).toBe('past_due');
  });
});

describe('indicações na plataforma', () => {
  it('só recompensa indicação qualificada; recompensa é auditada e encerra', async () => {
    const referrer = await createTenant(deps, 'Loja Indicadora Plataforma');
    const { code } = await getReferralInfo(deps, referrer.owner);
    const u = await createUser(deps);
    const { tenantId } = await provisionTenant(deps, u.id, { name: 'Loja Indicada Plataforma', referralCode: code });
    const find = async () => (await platformReferrals(deps)).find((r) => r.referred_name === 'Loja Indicada Plataforma')!;
    await expect(platformSetReferralStatus(deps, admin, (await find()).id, 'rewarded', 'Desconto')).rejects.toMatchObject({ code: 'validation_failed' });
    await applyBillingEvent(deps, { type: 'invoice.paid', tenantId, periodStart: '2026-10-01', periodEnd: '2026-10-31', amountCents: '4900' }, `t:${randomUUID()}`);
    expect((await find()).status).toBe('qualified');
    await platformSetReferralStatus(deps, admin, (await find()).id, 'rewarded', '1 mês de desconto na próxima fatura');
    expect((await find()).status).toBe('rewarded');
    await expect(platformSetReferralStatus(deps, admin, (await find()).id, 'rejected', 'x x x')).rejects.toMatchObject({ code: 'conflict' });
    const log = await deps.dbs.platform.selectFrom('platform_audit').select('action').where('tenant_id', '=', referrer.tenantId).execute();
    expect(log.map((l) => l.action)).toContain('referral.rewarded');
  });
});
