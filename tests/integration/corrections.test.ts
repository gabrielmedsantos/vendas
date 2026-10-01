import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '@gct/db';
import {
  balanceBreakdown, cancelExpense, cancelPurchase, cancelSale, confirmSale, listSales, zSaleList, createExpense, deleteProduct, getProduct, listAccounts, listCashMovements, quickPurchase, recordCashMovement, reverseCashMovement,
  zCashMovement, zExpense, zPurchase, zSale, zStatement, type Actor,
} from '@gct/app';
import { closeDeps, createTenant, makeParty, makeProduct, reconcile, testDeps, todayIn, type TenantFixture } from './helpers';

const deps = testDeps();
let T: TenantFixture;
let actor: Actor;
let conta: string;
let sup: string;

const saldo = async () => (await listAccounts(deps, actor)).reduce((a, r) => a + BigInt(r.balance_cents), 0n);
const onHand = (productId: string) => getProduct(deps, actor, productId).then((p) => (p.variants[0] as unknown as { on_hand: number }).on_hand);

beforeAll(async () => {
  T = await createTenant(deps, 'Loja Correções');
  actor = T.owner;
  conta = (await listAccounts(deps, actor))[0]!.id;
  sup = await makeParty(deps, actor, 'Fornecedor Correções', { supplier: true, customer: false });
  await recordCashMovement(deps, actor, zCashMovement.parse({ accountId: conta, kind: 'capital_in', amountCents: '100000', description: 'Aporte inicial' }), randomUUID());
});
afterAll(closeDeps);

describe('corrigir lançamentos sem apagar histórico', () => {
  it('excluir despesa paga: pagamento estornado, valor volta para a conta, some do resultado', async () => {
    const before = await saldo();
    const e = await createExpense(deps, actor, zExpense.parse({ description: 'Pistola lançada errado', competenceDate: todayIn(actor), amountCents: '17100', payNow: { accountId: conta, method: 'pix' } }), randomUUID());
    expect(await saldo()).toBe(before - 17100n);
    await cancelExpense(deps, actor, e.id, 'Lançada em duplicidade');
    expect(await saldo()).toBe(before);
    const b = await balanceBreakdown(deps, actor);
    expect(b.items.find((i) => i.label === 'Despesas pagas')).toBeUndefined();
    await expect(cancelExpense(deps, actor, e.id, 'de novo')).rejects.toMatchObject({ code: 'not_found' });
    expect(await reconcile(deps, actor)).toEqual([]);
  });

  it('estornar compra recebida e paga: itens saem do estoque, dinheiro volta; IMEI pode ser lançado de novo', async () => {
    const before = await saldo();
    const p = await makeProduct(deps, actor, { name: 'Celular Correção', tracking: 'serialized', priceCents: 150000n });
    const unit = { identifiers: [{ kind: 'imei1' as const, value: 'DEMO-IMEI-CORRECAO-1' }], condition: 'new' as const };
    const c = await quickPurchase(deps, actor, zPurchase.parse({ supplierId: sup, purchaseDate: todayIn(actor), items: [{ variantId: p.variantId, quantity: 1, unitCostCents: '90000', unitSpecs: [unit] }], paymentTerms: { mode: 'pay_now', accountId: conta, method: 'pix' } }), randomUUID());
    expect(await onHand(p.productId)).toBe(1);
    expect(await saldo()).toBe(before - 90000n);
    const r = await cancelPurchase(deps, actor, c.id, 'Lançada com custo errado');
    expect(r.reversed).toBe(true);
    expect(await onHand(p.productId)).toBe(0);
    expect(await saldo()).toBe(before);
    const st = await withTenant(deps.dbs.app, actor, (trx) => trx.selectFrom('purchases').select('status').where('id', '=', c.id).executeTakeFirstOrThrow());
    expect(st.status).toBe('canceled');
    // Lança de novo, corrigida, com o mesmo IMEI.
    await quickPurchase(deps, actor, zPurchase.parse({ supplierId: sup, purchaseDate: todayIn(actor), items: [{ variantId: p.variantId, quantity: 1, unitCostCents: '85000', unitSpecs: [unit] }], paymentTerms: { mode: 'pay_now', accountId: conta, method: 'pix' } }), randomUUID());
    expect(await onHand(p.productId)).toBe(1);
    expect(await reconcile(deps, actor)).toEqual([]);
  });

  it('compra com item já vendido não é estornada', async () => {
    const p = await makeProduct(deps, actor, { name: 'Capa Correção', priceCents: 5000n });
    const c = await quickPurchase(deps, actor, zPurchase.parse({ supplierId: sup, purchaseDate: todayIn(actor), items: [{ variantId: p.variantId, quantity: 2, unitCostCents: '2000' }], paymentTerms: { mode: 'pay_now', accountId: conta, method: 'pix' } }), randomUUID());
    await confirmSale(deps, actor, zSale.parse({ items: [{ variantId: p.variantId, quantity: 1, unitPriceCents: '5000' }], payments: [{ kind: 'pix', amountCents: '5000' }] }), randomUUID());
    await expect(cancelPurchase(deps, actor, c.id, 'Tentativa')).rejects.toMatchObject({ code: 'conflict' });
    expect(await onHand(p.productId)).toBe(1);
  });

  it('estornar lançamento manual; movimento de venda só pela venda; não estorna duas vezes', async () => {
    const before = await saldo();
    const m = await recordCashMovement(deps, actor, zCashMovement.parse({ accountId: conta, kind: 'withdrawal', amountCents: '3000', description: 'Retirada errada' }), randomUUID());
    expect(await saldo()).toBe(before - 3000n);
    await reverseCashMovement(deps, actor, m.id, 'Valor errado');
    expect(await saldo()).toBe(before);
    await expect(reverseCashMovement(deps, actor, m.id, 'De novo')).rejects.toMatchObject({ code: 'conflict' });
    const list = await listCashMovements(deps, actor, zStatement.parse({ limit: 100 }));
    expect(list.data.find((x) => x.id === m.id)).toMatchObject({ reversed: true });
    const settlement = list.data.find((x) => x.kind === 'settlement')!;
    await expect(reverseCashMovement(deps, actor, settlement.id, 'Não pode')).rejects.toMatchObject({ code: 'conflict' });
  });

  it('excluir produto: só o que nunca foi usado', async () => {
    const novo = await makeProduct(deps, actor, { name: 'Cadastro por engano' });
    await deleteProduct(deps, actor, novo.productId);
    await expect(getProduct(deps, actor, novo.productId)).rejects.toMatchObject({ code: 'not_found' });
    const usado = await makeProduct(deps, actor, { name: 'Produto com compra' });
    await quickPurchase(deps, actor, zPurchase.parse({ supplierId: sup, purchaseDate: todayIn(actor), items: [{ variantId: usado.variantId, quantity: 1, unitCostCents: '1000' }], paymentTerms: { mode: 'due', dueDate: todayIn(actor) } }), randomUUID());
    await expect(deleteProduct(deps, actor, usado.productId)).rejects.toMatchObject({ code: 'conflict' });
  });

  it('cancelar venda de teste: valor volta para a conta, item volta direto ao estoque, sai das ativas e fica marcada como cancelada', async () => {
    const p = await makeProduct(deps, actor, { name: 'Poltrona Teste', priceCents: 13000n });
    await quickPurchase(deps, actor, zPurchase.parse({ supplierId: sup, purchaseDate: todayIn(actor), items: [{ variantId: p.variantId, quantity: 1, unitCostCents: '7400' }], paymentTerms: { mode: 'pay_now', accountId: conta, method: 'pix' } }), randomUUID());
    const before = await saldo();
    const r = await confirmSale(deps, actor, zSale.parse({ items: [{ variantId: p.variantId, quantity: 1, unitPriceCents: '13000' }], payments: [{ kind: 'pix', amountCents: '13000' }] }), randomUUID());
    expect(await saldo()).toBe(before + 13000n);
    expect(await onHand(p.productId)).toBe(0);
    const key = randomUUID();
    const c = await cancelSale(deps, actor, r.saleId, { reason: 'Venda de teste', restock: true, refund: { mode: 'refund', payNow: { accountId: conta, method: 'pix' } } }, key);
    await cancelSale(deps, actor, r.saleId, { reason: 'Venda de teste', restock: true, refund: { mode: 'refund', payNow: { accountId: conta, method: 'pix' } } }, key); // repetir não duplica
    expect(BigInt(c.refundCents as unknown as string)).toBe(13000n);
    expect(await saldo()).toBe(before);
    expect(await onHand(p.productId)).toBe(1); // disponível de novo, sem passar por inspeção
    const insp = await withTenant(deps.dbs.app, actor, (trx) => trx.selectFrom('stock_balances').select(['inspection']).where('variant_id', '=', p.variantId).executeTakeFirstOrThrow());
    expect(insp.inspection).toBe(0);
    const ativas = await listSales(deps, actor, zSaleList.parse({ status: 'all_confirmed' }));
    expect(ativas.data.some((x) => x.id === r.saleId)).toBe(false);
    const canceladas = await listSales(deps, actor, zSaleList.parse({ status: 'returned' }));
    expect(canceladas.data.find((x) => x.id === r.saleId)).toMatchObject({ was_canceled: true });
    // Registro original preservado; resultado do período volta a zero para essa venda.
    const sale = await withTenant(deps.dbs.app, actor, (trx) => trx.selectFrom('sales').select(['status', 'total_cents']).where('id', '=', r.saleId).executeTakeFirstOrThrow());
    expect(sale).toEqual({ status: 'returned', total_cents: 13000n });
    expect(await reconcile(deps, actor)).toEqual([]);
  });
});
