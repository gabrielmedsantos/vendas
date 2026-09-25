import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '@gct/db';
import {
  confirmSale, createProduct, createServiceOrder, getHelpArticle, getReferralInfo, getServiceOrder, listHelpArticles, listServiceOrders,
  listWarrantyCases, openWarrantyCase, processOutboxBatch, provisionTenant, readDocumentPdf, requestWarrantyDocument, resolveActor,
  setServiceOrderStatus, setWarrantyStatus, applyBillingEvent, updateTenantProfile, zProduct, zSale, zServiceOrderList, zWarrantyList, type Actor,
} from '@gct/app';
import { addMember, closeDeps, createTenant, createUser, makeParty, stockUp, testDeps, type TenantFixture } from './helpers';

const deps = testDeps();
let T: TenantFixture;
let actor: Actor;
let customer: string;
let saleId: string;
let saleItemId: string;

beforeAll(async () => {
  T = await createTenant(deps, 'Loja Pós-venda');
  actor = T.owner;
  customer = await makeParty(deps, actor, 'Cliente Garantia Demo');
  const supplier = await makeParty(deps, actor, 'Fornecedor Garantia Demo', { supplier: true, customer: false });
  const { id } = await createProduct(deps, actor, zProduct.parse({ name: 'Fone Demo', warrantyDays: 90, variants: [{ sku: 'FONE-1', retailPriceCents: '15000' }] }));
  const v = await withTenant(deps.dbs.app, actor, (trx) => trx.selectFrom('product_variants').select('id').where('product_id', '=', id).executeTakeFirstOrThrow());
  await stockUp(deps, actor, supplier, [{ variantId: v.id, quantity: 2, unitCostCents: 8000n }]);
  const r = await confirmSale(deps, actor, zSale.parse({ customerId: customer, items: [{ variantId: v.id, quantity: 1, unitPriceCents: '15000' }], payments: [{ kind: 'pix', amountCents: '15000' }] }), randomUUID());
  saleId = r.saleId;
  saleItemId = (await withTenant(deps.dbs.app, actor, (trx) => trx.selectFrom('sale_items').select('id').where('sale_id', '=', saleId).executeTakeFirstOrThrow())).id;
});
afterAll(closeDeps);

describe('ordens de serviço', () => {
  it('fluxo de status válido, cancelamento exige motivo, entregue não edita, histórico auditado', async () => {
    const o = await createServiceOrder(deps, actor, { title: 'Troca de tela', partyId: customer, priceCents: 25000n });
    await expect(setServiceOrderStatus(deps, actor, o.id, 'delivered')).rejects.toMatchObject({ code: 'validation_failed' });
    await setServiceOrderStatus(deps, actor, o.id, 'in_progress');
    await setServiceOrderStatus(deps, actor, o.id, 'done');
    await setServiceOrderStatus(deps, actor, o.id, 'delivered');
    await expect(setServiceOrderStatus(deps, actor, o.id, 'canceled', 'x')).rejects.toMatchObject({ code: 'validation_failed' });
    const got = await getServiceOrder(deps, actor, o.id);
    expect(got.status).toBe('delivered');
    expect(got.history.map((h) => h.action)).toEqual(['service_order.created', 'service_order.status', 'service_order.status', 'service_order.status']);
    const o2 = await createServiceOrder(deps, actor, { title: 'Limpeza', priceCents: 0n });
    await expect(setServiceOrderStatus(deps, actor, o2.id, 'canceled')).rejects.toMatchObject({ code: 'validation_failed' });
    await setServiceOrderStatus(deps, actor, o2.id, 'canceled', 'Cliente desistiu');
    const list = await listServiceOrders(deps, actor, zServiceOrderList.parse({ status: 'delivered' }));
    expect(list.data.map((d) => d.id)).toEqual([o.id]);
  });

  it('outra empresa não vê a ordem; papel consulta não cria', async () => {
    const o = await createServiceOrder(deps, actor, { title: 'Diagnóstico', priceCents: 0n });
    const other = await createTenant(deps, 'Outra Loja Pós-venda');
    await expect(getServiceOrder(deps, other.owner, o.id)).rejects.toMatchObject({ code: 'not_found' });
    const viewer = await addMember(deps, T.tenantId, 'viewer');
    await expect(createServiceOrder(deps, viewer, { title: 'x x', priceCents: 0n })).rejects.toMatchObject({ code: 'forbidden' });
  });
});

describe('garantia', () => {
  it('abre no prazo com termos da época; alterar termos depois não muda o caso; PDF gerado', async () => {
    await updateTenantProfile(deps, actor, { settings: { warrantyTerms: 'Termos versão 1.' } });
    const w = await openWarrantyCase(deps, actor, { saleId, saleItemId, description: 'Lado esquerdo sem som' });
    await updateTenantProfile(deps, actor, { settings: { warrantyTerms: 'Termos versão 2.' } });
    const row = await withTenant(deps.dbs.app, actor, (trx) => trx.selectFrom('warranty_cases').select(['warranty_terms_snapshot', 'party_id']).where('id', '=', w.id).executeTakeFirstOrThrow());
    expect(row.warranty_terms_snapshot).toContain('90 dias');
    expect(row.warranty_terms_snapshot).toContain('Termos versão 1.');
    expect(row.party_id).toBe(customer);
    await expect(setWarrantyStatus(deps, actor, w.id, 'resolved')).rejects.toMatchObject({ code: 'validation_failed' });
    await setWarrantyStatus(deps, actor, w.id, 'resolved', 'Fone substituído por unidade nova');
    const doc = await requestWarrantyDocument(deps, actor, w.id);
    await processOutboxBatch(deps, 50, actor.tenantId);
    const pdf = await readDocumentPdf(deps, actor, doc.id);
    expect(pdf.data.subarray(0, 5).toString()).toBe('%PDF-');
    const list = await listWarrantyCases(deps, actor, zWarrantyList.parse({ saleId }));
    expect(list.data).toHaveLength(1);
  });

  it('fora do prazo é recusado; produto sem garantia também', async () => {
    const v = await withTenant(deps.dbs.app, actor, (trx) => trx.selectFrom('sale_items').select('variant_id').where('id', '=', saleItemId).executeTakeFirstOrThrow());
    const old = new Date(Date.now() - 120 * 86400000).toISOString().slice(0, 10);
    const r = await confirmSale(deps, actor, zSale.parse({ saleDate: old, customerId: customer, items: [{ variantId: v.variant_id, quantity: 1, unitPriceCents: '15000' }], payments: [{ kind: 'pix', amountCents: '15000' }] }), randomUUID());
    const item = await withTenant(deps.dbs.app, actor, (trx) => trx.selectFrom('sale_items').select('id').where('sale_id', '=', r.saleId).executeTakeFirstOrThrow());
    await expect(openWarrantyCase(deps, actor, { saleId: r.saleId, saleItemId: item.id, description: 'Parou de ligar' })).rejects.toMatchObject({ message: expect.stringContaining('Garantia encerrada') });
  });
});

describe('ajuda e indicação', () => {
  it('artigos publicados, busca e 404 para inexistente', async () => {
    const all = await listHelpArticles(deps, actor, {});
    expect(all.length).toBeGreaterThanOrEqual(8);
    const troca = await listHelpArticles(deps, actor, { q: 'compensação' });
    expect(troca.map((a) => a.slug)).toContain('entendendo-a-troca');
    const art = await getHelpArticle(deps, actor, 'entendendo-a-troca');
    expect(art.body).toContain('R$ 500');
    await expect(getHelpArticle(deps, actor, 'nao-existe')).rejects.toMatchObject({ code: 'not_found' });
  });

  it('indicação: código estável, autoindicação ignorada, qualifica no primeiro pagamento', async () => {
    const info = await getReferralInfo(deps, actor);
    expect(info.code).toMatch(/^[A-Z0-9]{6}$/);
    expect((await getReferralInfo(deps, actor)).code).toBe(info.code);
    // Dono da empresa indicadora criando outra empresa com o próprio código: ignorado.
    await provisionTenant(deps, T.ownerUser.id, { name: 'Filial Própria', referralCode: info.code });
    expect((await getReferralInfo(deps, actor)).pending).toBe(0);
    const u = await createUser(deps, 'Indicado Demo');
    const { tenantId } = await provisionTenant(deps, u.id, { name: 'Loja Indicada', referralCode: info.code.toLowerCase() });
    expect((await getReferralInfo(deps, actor)).pending).toBe(1);
    await applyBillingEvent(deps, { type: 'invoice.paid', tenantId, periodStart: '2026-10-01', periodEnd: '2026-10-31', amountCents: '4900' }, `test:${randomUUID()}`);
    const after = await getReferralInfo(deps, actor);
    expect(after.pending).toBe(0);
    expect(after.qualified).toBe(1);
    // Código inválido não bloqueia cadastro.
    const u2 = await createUser(deps);
    await expect(provisionTenant(deps, u2.id, { name: 'Loja Sem Indicação', referralCode: 'ZZZZZZ' })).resolves.toBeTruthy();
    // A empresa indicada não enxerga as indicações da indicadora.
    const referred = await resolveActor(deps, u.id, tenantId);
    expect((await getReferralInfo(deps, referred)).pending).toBe(0);
  });
});
