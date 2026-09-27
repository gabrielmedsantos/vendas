import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql, withTenant } from '@gct/db';
import {
  approvePurchase, cancelPurchase, listPurchases, zPurchaseList, cancelSale, confirmSale, createPurchaseDraft, getMetrics, getSale, listSales, processOutboxBatch, receivePurchase,
  returnSale, reverseSettlementAction, settleTitles, adjustStock, createExpense, recordCashMovement, transferBetweenAccounts, checkLimit,
  zSale, zPurchase, zReceive, zAdjustment, zExpense, retryDocument, readDocumentPdf, zSaleList,
  type Actor,
} from '@gct/app';
import { accountBalance, accounts, addMember, closeDeps, createTenant, makeParty, makeProduct, reconcile, stockUp, testDeps, todayIn, type TenantFixture } from './helpers';

const deps = testDeps();
let T: TenantFixture;
let actor: Actor;
let acc: { cash: string; bank: string };
let supplier: string;
let customer: string;

beforeAll(async () => {
  T = await createTenant(deps, 'Loja Operações');
  actor = T.owner;
  acc = await accounts(deps, actor);
  supplier = await makeParty(deps, actor, 'Fornecedor Demo', { supplier: true, customer: false });
  customer = await makeParty(deps, actor, 'Cliente Demonstração');
});
afterAll(closeDeps);

const sale = (variantId: string, qty: number, price: bigint, payments: unknown[], extra: Record<string, unknown> = {}) =>
  zSale.parse({ items: [{ variantId, quantity: qty, unitPriceCents: String(price) }], payments, ...extra });

describe('compras e recebimento', () => {
  it('recebimento parcial mantém pendente; receber de novo com a mesma chave não duplica (T-005)', async () => {
    const p = await makeProduct(deps, actor, { name: 'Camiseta Demo' });
    const draft = await createPurchaseDraft(deps, actor, zPurchase.parse({
      supplierId: supplier, purchaseDate: todayIn(actor), items: [{ variantId: p.variantId, quantity: 5, unitCostCents: '2000' }],
      extraCostsCents: '1000', paymentTerms: { mode: 'installments', count: 2, firstDueDate: todayIn(actor), interval: 30 },
    }));
    await approvePurchase(deps, actor, draft.id, randomUUID());
    const items = await withTenant(deps.dbs.app, actor, (trx) => trx.selectFrom('purchase_items').select(['id']).where('purchase_id', '=', draft.id).execute());
    const key = randomUUID();
    const body = zReceive.parse({ items: [{ purchaseItemId: items[0]!.id, quantity: 2 }] });
    const r1 = await receivePurchase(deps, actor, draft.id, body, key);
    const r2 = await receivePurchase(deps, actor, draft.id, body, key);
    expect(r2).toEqual(r1);
    const state = await withTenant(deps.dbs.app, actor, async (trx) => ({
      item: await trx.selectFrom('purchase_items').select(['received_qty', 'received_cost_cents', 'landed_cost_cents']).where('id', '=', items[0]!.id).executeTakeFirstOrThrow(),
      bal: await trx.selectFrom('stock_balances').select('on_hand').where('variant_id', '=', p.variantId).executeTakeFirstOrThrow(),
      moves: await trx.selectFrom('stock_movements').select('id').where('variant_id', '=', p.variantId).execute(),
      titles: await trx.selectFrom('financial_titles').select(['original_cents']).where('origin_id', '=', draft.id).orderBy('due_date').execute(),
    }));
    expect(state.item.received_qty).toBe(2);
    expect(state.item.landed_cost_cents).toBe(11000n);
    expect(state.item.received_cost_cents).toBe(4400n);
    expect(state.bal.on_hand).toBe(2);
    expect(state.moves).toHaveLength(1);
    expect(state.titles.map((t) => t.original_cents)).toEqual([5500n, 5500n]);
    // Receber mais que o pendente é recusado.
    await expect(receivePurchase(deps, actor, draft.id, zReceive.parse({ items: [{ purchaseItemId: items[0]!.id, quantity: 4 }] }), randomUUID())).rejects.toMatchObject({ code: 'validation_failed' });
    const r3 = await receivePurchase(deps, actor, draft.id, zReceive.parse({ items: [{ purchaseItemId: items[0]!.id, quantity: 3 }] }), randomUUID());
    expect(r3.status).toBe('received');
    const final = await withTenant(deps.dbs.app, actor, (trx) => trx.selectFrom('purchase_items').select(['received_cost_cents']).where('id', '=', items[0]!.id).executeTakeFirstOrThrow());
    expect(final.received_cost_cents).toBe(11000n);
    expect(await reconcile(deps, actor)).toEqual([]);
  });

  it('lista de compras traz 1º item, quantidade de itens e foto do primeiro produto com foto', async () => {
    const semFoto = await makeProduct(deps, actor, { name: 'Capa Demo Sem Foto' });
    const comFoto = await makeProduct(deps, actor, { name: 'Fone Demo Com Foto' });
    const img = await withTenant(deps.dbs.app, actor, async (trx) => {
      const pid = (await sql<{ product_id: string }>`select product_id from product_variants where id = ${comFoto.variantId}`.execute(trx)).rows[0]!.product_id;
      const a = (await sql<{ id: string }>`insert into attachments (tenant_id, storage_key, mime, size_bytes, sha256, owner_type, owner_id)
        values (${actor.tenantId}, ${`teste/${randomUUID()}`}, 'image/png', 10, 'x', 'product', ${pid}) returning id`.execute(trx)).rows[0]!.id;
      await sql`insert into product_images (tenant_id, product_id, attachment_id) values (${actor.tenantId}, ${pid}, ${a})`.execute(trx);
      return a;
    });
    const d = await createPurchaseDraft(deps, actor, zPurchase.parse({ supplierId: supplier, purchaseDate: todayIn(actor), items: [
      { variantId: semFoto.variantId, quantity: 1, unitCostCents: '100' }, { variantId: comFoto.variantId, quantity: 2, unitCostCents: '200' },
    ], paymentTerms: { mode: 'due', dueDate: todayIn(actor) } }));
    const page = await listPurchases(deps, actor, zPurchaseList.parse({ status: 'draft' }));
    const row = page.data.find((r) => r.id === d.id)!;
    expect(row).toMatchObject({ item_count: 2, first_item: expect.stringContaining('Capa Demo Sem Foto'), image_id: img });
  });

  it('cancelar rascunho não cria movimentações', async () => {
    const p = await makeProduct(deps, actor, { name: 'Boné Demo' });
    const d = await createPurchaseDraft(deps, actor, zPurchase.parse({ supplierId: supplier, purchaseDate: todayIn(actor), items: [{ variantId: p.variantId, quantity: 3, unitCostCents: '500' }], paymentTerms: { mode: 'due', dueDate: todayIn(actor) } }));
    await cancelPurchase(deps, actor, d.id, 'Pedido errado');
    const n = await withTenant(deps.dbs.app, actor, (trx) => sql<{ m: number; t: number }>`select (select count(*) from stock_movements where variant_id = ${p.variantId})::int as m, (select count(*) from financial_titles where origin_id = ${d.id})::int as t`.execute(trx));
    expect(n.rows[0]).toEqual({ m: 0, t: 0 });
  });
});

describe('vendas', () => {
  it('T-004: duas vendas em paralelo pela última unidade — só uma confirma', async () => {
    const p = await makeProduct(deps, actor, { name: 'Último Item Demo' });
    await stockUp(deps, actor, supplier, [{ variantId: p.variantId, quantity: 1, unitCostCents: 1000n }]);
    const results = await Promise.allSettled([
      confirmSale(deps, actor, sale(p.variantId, 1, 3000n, [{ kind: 'cash', amountCents: '3000' }]), randomUUID()),
      confirmSale(deps, actor, sale(p.variantId, 1, 3000n, [{ kind: 'cash', amountCents: '3000' }]), randomUUID()),
      confirmSale(deps, actor, sale(p.variantId, 1, 3000n, [{ kind: 'cash', amountCents: '3000' }]), randomUUID()),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    for (const r of results.filter((r) => r.status === 'rejected')) expect((r as PromiseRejectedResult).reason.code).toBe('insufficient_stock');
    const bal = await withTenant(deps.dbs.app, actor, (trx) => trx.selectFrom('stock_balances').select(['on_hand', 'reserved']).where('variant_id', '=', p.variantId).executeTakeFirstOrThrow());
    expect(bal).toEqual({ on_hand: 0, reserved: 0 });
    expect(await reconcile(deps, actor)).toEqual([]);
  });

  it('T-004b: unidade serializada disputada por duas vendas', async () => {
    const p = await makeProduct(deps, actor, { name: 'Celular Único Demo', tracking: 'serialized' });
    const r = await stockUp(deps, actor, supplier, [{ variantId: p.variantId, quantity: 1, unitCostCents: 50000n, units: [{ identifiers: [{ kind: 'imei1', value: 'DEMO-IMEI-RACE' }] }] }]);
    const unitId = r.unitIds[0]!;
    const mk = () => confirmSale(deps, actor, zSale.parse({ items: [{ variantId: p.variantId, unitId, quantity: 1, unitPriceCents: '80000' }], payments: [{ kind: 'pix', amountCents: '80000' }] }), randomUUID());
    const results = await Promise.allSettled([mk(), mk()]);
    expect(results.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    const u = await withTenant(deps.dbs.app, actor, (trx) => trx.selectFrom('inventory_units').select('status').where('id', '=', unitId).executeTakeFirstOrThrow());
    expect(u.status).toBe('sold');
  });

  it('T-005/T-006: mesma chave devolve a mesma resposta; corpo diferente → 409', async () => {
    const p = await makeProduct(deps, actor, { name: 'Meia Demo' });
    await stockUp(deps, actor, supplier, [{ variantId: p.variantId, quantity: 10, unitCostCents: 300n }]);
    const key = randomUUID();
    const body = sale(p.variantId, 2, 1000n, [{ kind: 'cash', amountCents: '2000' }]);
    const a = await confirmSale(deps, actor, body, key);
    const b = await confirmSale(deps, actor, body, key);
    expect(b.saleId).toBe(a.saleId);
    expect(b.replayed).toBe(true);
    await expect(confirmSale(deps, actor, sale(p.variantId, 3, 1000n, [{ kind: 'cash', amountCents: '3000' }]), key)).rejects.toMatchObject({ code: 'idempotency_conflict' });
    const count = await withTenant(deps.dbs.app, actor, (trx) => sql<{ n: number }>`select count(*)::int as n from sale_items where variant_id = ${p.variantId}`.execute(trx));
    expect(count.rows[0]!.n).toBe(1);
    const bal = await withTenant(deps.dbs.app, actor, (trx) => trx.selectFrom('stock_balances').select('on_hand').where('variant_id', '=', p.variantId).executeTakeFirstOrThrow());
    expect(bal.on_hand).toBe(8);
  });

  it('pagamentos precisam compor exatamente o total; entrada + parcelas somam o total', async () => {
    const p = await makeProduct(deps, actor, { name: 'Tênis Demo' });
    await stockUp(deps, actor, supplier, [{ variantId: p.variantId, quantity: 5, unitCostCents: 10000n }]);
    await expect(confirmSale(deps, actor, sale(p.variantId, 1, 30000n, [{ kind: 'cash', amountCents: '29999' }]), randomUUID())).rejects.toMatchObject({ code: 'validation_failed' });
    // Crediário exige cliente.
    await expect(confirmSale(deps, actor, sale(p.variantId, 1, 30000n, [{ kind: 'installment', amountCents: '30000', installments: 3 }]), randomUUID())).rejects.toMatchObject({ code: 'validation_failed' });
    const r = await confirmSale(deps, actor, sale(p.variantId, 1, 30000n, [{ kind: 'pix', amountCents: '10000' }, { kind: 'installment', amountCents: '20000', installments: 3 }], { customerId: customer }), randomUUID());
    const titles = await withTenant(deps.dbs.app, actor, (trx) => trx.selectFrom('financial_titles').select(['original_cents', 'balance_cents']).where('origin_id', '=', r.saleId).orderBy('due_date').orderBy('original_cents', 'desc').execute());
    expect(titles.reduce((a, t) => a + t.original_cents, 0n)).toBe(30000n);
    expect(titles.filter((t) => t.balance_cents > 0n).map((t) => t.balance_cents).sort()).toEqual([6666n, 6667n, 6667n].sort());
    // Parcelamento não duplica receita.
    const today = todayIn(actor);
    const m1 = await getMetrics(deps, actor, { from: today, to: today });
    const inst = titles.filter((t) => t.balance_cents > 0n);
    expect(inst).toHaveLength(3);
    const ids = await withTenant(deps.dbs.app, actor, (trx) => trx.selectFrom('financial_titles').select(['id', 'balance_cents']).where('origin_id', '=', r.saleId).where('balance_cents', '>', 0n).execute());
    await settleTitles(deps, actor, { direction: 'in', method: 'pix', accountId: acc.bank, allocations: ids.map((t) => ({ titleId: t.id, amountCents: t.balance_cents })) }, randomUUID());
    const m2 = await getMetrics(deps, actor, { from: today, to: today });
    expect(m2.revenue.grossSalesCents).toBe(m1.revenue.grossSalesCents);
    expect(m2.cash.inCents - m1.cash.inCents).toBe(20000n);
  });

  it('editar preço do produto depois não altera a venda (snapshot)', async () => {
    const p = await makeProduct(deps, actor, { name: 'Snapshot Demo', priceCents: 5000n });
    await stockUp(deps, actor, supplier, [{ variantId: p.variantId, quantity: 2, unitCostCents: 1000n }]);
    const r = await confirmSale(deps, actor, sale(p.variantId, 1, 5000n, [{ kind: 'cash', amountCents: '5000' }]), randomUUID());
    await withTenant(deps.dbs.app, actor, (trx) => trx.updateTable('product_variants').set({ retail_price_cents: 9999n }).where('id', '=', p.variantId).execute());
    const s = await getSale(deps, actor, r.saleId);
    expect((s.sale as { total_cents: bigint }).total_cents).toBe(5000n);
    expect((s.items[0] as { unit_price_cents: bigint }).unit_price_cents).toBe(5000n);
  });

  it('T-021: vendedor não recebe custo pela API; T-023: desconto acima do limite é recusado', async () => {
    const seller = await addMember(deps, T.tenantId, 'seller');
    const p = await makeProduct(deps, actor, { name: 'Limite Demo' });
    await stockUp(deps, actor, supplier, [{ variantId: p.variantId, quantity: 5, unitCostCents: 1000n }]);
    const r = await confirmSale(deps, seller, sale(p.variantId, 1, 5000n, [{ kind: 'cash', amountCents: '5000' }]), randomUUID());
    expect(r.costCents).toBeUndefined();
    const detail = await getSale(deps, seller, r.saleId);
    expect(detail.sale).not.toHaveProperty('cost_total_cents');
    expect(detail.items[0]).not.toHaveProperty('cost_cents');
    const list = await listSales(deps, seller, zSaleList.parse({}));
    expect(list.data[0]).not.toHaveProperty('cost_total_cents');
    // Limite padrão do vendedor: 10%. Desconto de 20% → recusado.
    await expect(
      confirmSale(deps, seller, zSale.parse({ items: [{ variantId: p.variantId, quantity: 1, unitPriceCents: '5000' }], discountCents: '1000', payments: [{ kind: 'cash', amountCents: '4000' }] }), randomUUID()),
    ).rejects.toMatchObject({ code: 'forbidden' });
    // Vendedor com permissão explícita de desconto acima do limite: aprovação registrada.
    const approver = await addMember(deps, T.tenantId, 'seller', ['sales.discount_over_limit']);
    const ok = await confirmSale(deps, approver, zSale.parse({ items: [{ variantId: p.variantId, quantity: 1, unitPriceCents: '5000' }], discountCents: '1000', payments: [{ kind: 'cash', amountCents: '4000' }] }), randomUUID());
    const s = await withTenant(deps.dbs.app, actor, (trx) => trx.selectFrom('sales').select('discount_approved_by').where('id', '=', ok.saleId).executeTakeFirstOrThrow());
    expect(s.discount_approved_by).toBe(approver.userId);
  });
});

describe('financeiro', () => {
  it('T-012: receber R$ 100 de título de R$ 250 deixa saldo de R$ 150 e caixa +100', async () => {
    const p = await makeProduct(deps, actor, { name: 'Fiado Demo' });
    await stockUp(deps, actor, supplier, [{ variantId: p.variantId, quantity: 1, unitCostCents: 10000n }]);
    const r = await confirmSale(deps, actor, sale(p.variantId, 1, 25000n, [{ kind: 'installment', amountCents: '25000' }], { customerId: customer }), randomUUID());
    const title = r.receivableTitleIds[0]!;
    const before = await accountBalance(deps, actor, acc.cash);
    await settleTitles(deps, actor, { direction: 'in', method: 'cash', accountId: acc.cash, allocations: [{ titleId: title, amountCents: 10000n }] }, randomUUID());
    const t = await withTenant(deps.dbs.app, actor, (trx) => trx.selectFrom('financial_titles').select(['balance_cents', 'status']).where('id', '=', title).executeTakeFirstOrThrow());
    expect(t).toEqual({ balance_cents: 15000n, status: 'partially_settled' });
    expect((await accountBalance(deps, actor, acc.cash)) - before).toBe(10000n);
  });

  it('T-017: duas baixas simultâneas não deixam saldo negativo', async () => {
    const p = await makeProduct(deps, actor, { name: 'Baixa Demo' });
    await stockUp(deps, actor, supplier, [{ variantId: p.variantId, quantity: 1, unitCostCents: 1000n }]);
    const r = await confirmSale(deps, actor, sale(p.variantId, 1, 10000n, [{ kind: 'installment', amountCents: '10000' }], { customerId: customer }), randomUUID());
    const title = r.receivableTitleIds[0]!;
    const results = await Promise.allSettled([
      settleTitles(deps, actor, { direction: 'in', method: 'pix', accountId: acc.bank, allocations: [{ titleId: title, amountCents: 8000n }] }, randomUUID()),
      settleTitles(deps, actor, { direction: 'in', method: 'pix', accountId: acc.bank, allocations: [{ titleId: title, amountCents: 8000n }] }, randomUUID()),
    ]);
    expect(results.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    const t = await withTenant(deps.dbs.app, actor, (trx) => trx.selectFrom('financial_titles').select('balance_cents').where('id', '=', title).executeTakeFirstOrThrow());
    expect(t.balance_cents).toBe(2000n);
    expect(await reconcile(deps, actor)).toEqual([]);
  });

  it('T-013: cartão 1.000 com taxa 30 → receita 1.000 uma vez, tarifa 30, caixa +970', async () => {
    const p = await makeProduct(deps, actor, { name: 'Cartão Demo' });
    await stockUp(deps, actor, supplier, [{ variantId: p.variantId, quantity: 1, unitCostCents: 50000n }]);
    const today = todayIn(actor);
    const m0 = await getMetrics(deps, actor, { from: today, to: today });
    const r = await confirmSale(deps, actor, sale(p.variantId, 1, 100000n, [{ kind: 'credit', amountCents: '100000' }]), randomUUID());
    const bank0 = await accountBalance(deps, actor, acc.bank);
    const m1 = await getMetrics(deps, actor, { from: today, to: today });
    expect(m1.revenue.grossSalesCents - m0.revenue.grossSalesCents).toBe(100000n);
    expect(m1.cash.inCents).toBe(m0.cash.inCents);
    await settleTitles(deps, actor, { direction: 'in', method: 'credit', accountId: acc.bank, feeCents: 3000n, allocations: [{ titleId: r.receivableTitleIds[0]!, amountCents: 100000n }] }, randomUUID());
    const m2 = await getMetrics(deps, actor, { from: today, to: today });
    expect(m2.revenue.grossSalesCents).toBe(m1.revenue.grossSalesCents);
    expect((await accountBalance(deps, actor, acc.bank)) - bank0).toBe(97000n);
    expect(m2.result!.variableCostsCents - m1.result!.variableCostsCents).toBe(3000n);
    const t = await withTenant(deps.dbs.app, actor, (trx) => trx.selectFrom('financial_titles').select('status').where('id', '=', r.receivableTitleIds[0]!).executeTakeFirstOrThrow());
    expect(t.status).toBe('settled');
  });

  it('estorno de liquidação: original intacto, título reaberto, caixa reverte; uma vez só', async () => {
    const p = await makeProduct(deps, actor, { name: 'Estorno Demo' });
    await stockUp(deps, actor, supplier, [{ variantId: p.variantId, quantity: 1, unitCostCents: 1000n }]);
    const r = await confirmSale(deps, actor, sale(p.variantId, 1, 7000n, [{ kind: 'installment', amountCents: '7000' }], { customerId: customer }), randomUUID());
    const s = await settleTitles(deps, actor, { direction: 'in', method: 'pix', accountId: acc.bank, allocations: [{ titleId: r.receivableTitleIds[0]!, amountCents: 7000n }] }, randomUUID());
    const bank = await accountBalance(deps, actor, acc.bank);
    await reverseSettlementAction(deps, actor, s.settlementId, 'Pix não compensou');
    expect(await accountBalance(deps, actor, acc.bank)).toBe(bank - 7000n);
    const t = await withTenant(deps.dbs.app, actor, (trx) => trx.selectFrom('financial_titles').select(['balance_cents', 'status']).where('id', '=', r.receivableTitleIds[0]!).executeTakeFirstOrThrow());
    expect(t).toEqual({ balance_cents: 7000n, status: 'open' });
    await expect(reverseSettlementAction(deps, actor, s.settlementId, 'de novo')).rejects.toMatchObject({ code: 'conflict' });
    expect(await reconcile(deps, actor)).toEqual([]);
  });

  it('transferência interna não é receita; aporte não é venda; despesa entra no resultado operacional', async () => {
    const today = todayIn(actor);
    const m0 = await getMetrics(deps, actor, { from: today, to: today });
    await recordCashMovement(deps, actor, { accountId: acc.cash, kind: 'capital_in', amountCents: 100000n, description: 'Aporte do sócio' }, randomUUID());
    await transferBetweenAccounts(deps, actor, { fromAccountId: acc.cash, toAccountId: acc.bank, amountCents: 50000n }, randomUUID());
    await createExpense(deps, actor, zExpense.parse({ description: 'Energia', competenceDate: today, amountCents: '12000', payNow: { accountId: acc.bank, method: 'pix' } }), randomUUID());
    const m1 = await getMetrics(deps, actor, { from: today, to: today });
    expect(m1.revenue.grossSalesCents).toBe(m0.revenue.grossSalesCents);
    expect(m1.result!.operatingExpensesCents - m0.result!.operatingExpensesCents).toBe(12000n);
    expect(m1.cash.inCents - m0.cash.inCents).toBe(100000n);
    expect(m1.cash.outCents - m0.cash.outCents).toBe(12000n);
    expect(await reconcile(deps, actor)).toEqual([]);
  });
});

describe('devolução e cancelamento', () => {
  it('T-014: devolução parcial reverte preço e custo históricos; estoque volta em inspeção', async () => {
    const p = await makeProduct(deps, actor, { name: 'Lote Antigo Demo' });
    await stockUp(deps, actor, supplier, [{ variantId: p.variantId, quantity: 2, unitCostCents: 1000n }]);
    await stockUp(deps, actor, supplier, [{ variantId: p.variantId, quantity: 2, unitCostCents: 1600n }]);
    const r = await confirmSale(deps, actor, zSale.parse({ customerId: customer, items: [{ variantId: p.variantId, quantity: 3, unitPriceCents: '3000' }], discountCents: '900', payments: [{ kind: 'installment', amountCents: '8100' }] }), randomUUID());
    // Custo FIFO: 1000 + 1000 + 1600 = 3600.
    const s = await withTenant(deps.dbs.app, actor, (trx) => trx.selectFrom('sales').select(['cost_total_cents']).where('id', '=', r.saleId).executeTakeFirstOrThrow());
    expect(s.cost_total_cents).toBe(3600n);
    const item = await withTenant(deps.dbs.app, actor, (trx) => trx.selectFrom('sale_items').select('id').where('sale_id', '=', r.saleId).executeTakeFirstOrThrow());
    // Mudar custo "atual" não influencia a devolução.
    await stockUp(deps, actor, supplier, [{ variantId: p.variantId, quantity: 1, unitCostCents: 9999n }]);
    const ret = await returnSale(deps, actor, r.saleId, { items: [{ saleItemId: item.id, quantity: 1 }], reason: 'Tamanho errado' }, randomUUID());
    expect(BigInt(ret.revenueCents as unknown as string)).toBe(2700n); // 8100/3
    expect(BigInt(ret.costCents as unknown as string)).toBe(1600n); // última alocação (lote de 1600)
    expect(BigInt(ret.reducedBalanceCents as unknown as string)).toBe(2700n); // saldo em aberto abatido
    const insp = await withTenant(deps.dbs.app, actor, (trx) => trx.selectFrom('stock_balances').select(['inspection']).where('variant_id', '=', p.variantId).executeTakeFirstOrThrow());
    expect(insp.inspection).toBe(1);
    await expect(returnSale(deps, actor, r.saleId, { items: [{ saleItemId: item.id, quantity: 3 }], reason: 'demais' }, randomUUID())).rejects.toMatchObject({ code: 'validation_failed' });
    expect(await reconcile(deps, actor)).toEqual([]);
  });

  it('T-015: cancelar venda paga não apaga recebimento; gera estorno e reembolso rastreável', async () => {
    const p = await makeProduct(deps, actor, { name: 'Cancelamento Demo' });
    await stockUp(deps, actor, supplier, [{ variantId: p.variantId, quantity: 1, unitCostCents: 2000n }]);
    const r = await confirmSale(deps, actor, sale(p.variantId, 1, 5000n, [{ kind: 'pix', amountCents: '5000' }], { customerId: customer }), randomUUID());
    await expect(cancelSale(deps, actor, r.saleId, { reason: 'Desistência' }, randomUUID())).rejects.toMatchObject({ code: 'validation_failed' });
    const bank = await accountBalance(deps, actor, acc.bank);
    const c = await cancelSale(deps, actor, r.saleId, { reason: 'Desistência', refund: { mode: 'refund', payNow: { accountId: acc.bank, method: 'pix' } } }, randomUUID());
    expect(BigInt(c.refundCents as unknown as string)).toBe(5000n);
    expect(await accountBalance(deps, actor, acc.bank)).toBe(bank - 5000n);
    const orig = await withTenant(deps.dbs.app, actor, async (trx) => ({
      settlement: await trx.selectFrom('settlement_allocations as a').innerJoin('financial_titles as t', 't.id', 'a.title_id').select('a.amount_cents').where('t.origin_id', '=', r.saleId).execute(),
      sale: await trx.selectFrom('sales').select(['status', 'total_cents']).where('id', '=', r.saleId).executeTakeFirstOrThrow(),
    }));
    expect(orig.settlement).toEqual([{ amount_cents: 5000n }]);
    expect(orig.sale).toEqual({ status: 'returned', total_cents: 5000n });
    expect(await reconcile(deps, actor)).toEqual([]);
  });

  it('perda de estoque gera despesa de perda ao custo histórico', async () => {
    const p = await makeProduct(deps, actor, { name: 'Perda Demo' });
    await stockUp(deps, actor, supplier, [{ variantId: p.variantId, quantity: 3, unitCostCents: 700n }]);
    const r = await adjustStock(deps, actor, zAdjustment.parse({ variantId: p.variantId, direction: 'out', kind: 'loss', quantity: 2, reason: 'Avaria no transporte' }));
    expect(r.costCents).toBe(1400n);
    await expect(adjustStock(deps, actor, zAdjustment.parse({ variantId: p.variantId, direction: 'out', kind: 'loss', quantity: 5, reason: 'demais' }))).rejects.toMatchObject({ code: 'insufficient_stock' });
    const seller = await addMember(deps, T.tenantId, 'seller');
    await expect(adjustStock(deps, seller, zAdjustment.parse({ variantId: p.variantId, direction: 'out', kind: 'loss', quantity: 1, reason: 'sem permissão' }))).rejects.toMatchObject({ code: 'forbidden' });
  });
});

describe('documentos e fila', () => {
  it('T-018: falha no PDF não desfaz a venda; reprocessamento gera sem repetir efeito', async () => {
    const p = await makeProduct(deps, actor, { name: 'PDF Demo' });
    await stockUp(deps, actor, supplier, [{ variantId: p.variantId, quantity: 1, unitCostCents: 100n }]);
    const r = await confirmSale(deps, actor, sale(p.variantId, 1, 500n, [{ kind: 'cash', amountCents: '500' }]), randomUUID());
    const broken = { ...deps, storage: { ...deps.storage, put: async () => { throw new Error('disco indisponível'); }, get: deps.storage.get.bind(deps.storage), delete: deps.storage.delete.bind(deps.storage), exists: deps.storage.exists.bind(deps.storage) } };
    for (let i = 0; i < 5; i++) await processOutboxBatch(broken, 50, actor.tenantId);
    const doc = await withTenant(deps.dbs.app, actor, (trx) => trx.selectFrom('documents').select(['id', 'status']).where('source_id', '=', r.saleId).executeTakeFirstOrThrow());
    expect(doc.status).toBe('failed');
    const s = await withTenant(deps.dbs.app, actor, (trx) => trx.selectFrom('sales').select('status').where('id', '=', r.saleId).executeTakeFirstOrThrow());
    expect(s.status).toBe('confirmed');
    await retryDocument(deps, actor, doc.id);
    await processOutboxBatch(deps, 200, actor.tenantId);
    const pdf = await readDocumentPdf(deps, actor, doc.id);
    expect(pdf.data.subarray(0, 5).toString()).toBe('%PDF-');
    const moves = await withTenant(deps.dbs.app, actor, (trx) => sql<{ n: number }>`select count(*)::int as n from stock_movements where source_id = ${r.saleId}`.execute(trx));
    expect(moves.rows[0]!.n).toBe(1);
    // Outra empresa não baixa o documento.
    const other = await createTenant(deps, 'Outra Empresa Docs');
    await expect(readDocumentPdf(deps, other.owner, doc.id)).rejects.toMatchObject({ code: 'not_found' });
  });

  it('T-024: limite do plano é aplicado no servidor', async () => {
    await withTenant(deps.dbs.app, actor, async (trx) => {
      await expect(checkLimit(trx, actor.tenantId, 'users', 100)).rejects.toMatchObject({ code: 'plan_limit' });
    });
  });
});
