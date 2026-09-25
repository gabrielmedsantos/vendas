import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql, withTenant } from '@gct/db';
import {
  addAcquisitionCost, confirmSale, confirmTrade, getMetrics, releaseInspection, reverseTrade, settleTitles, simulateTrade,
  zAcquisitionCost, zSale, zTrade, type Actor,
} from '@gct/app';
import { accountBalance, accounts, closeDeps, createTenant, makeParty, makeProduct, reconcile, stockUp, testDeps, todayIn, type TenantFixture } from './helpers';

const deps = testDeps();
let T: TenantFixture;
let actor: Actor;
let acc: { cash: string; bank: string };
let supplier: string;

beforeAll(async () => {
  T = await createTenant(deps, 'Loja de Trocas');
  actor = T.owner;
  acc = await accounts(deps, actor);
  supplier = await makeParty(deps, actor, 'Distribuidora Demo', { supplier: true, customer: false });
});
afterAll(closeDeps);

async function phoneInStock(name: string, costCents: bigint, priceCents: bigint, imei: string) {
  const p = await makeProduct(deps, actor, { name, tracking: 'serialized', priceCents });
  const r = await stockUp(deps, actor, supplier, [{ variantId: p.variantId, quantity: 1, unitCostCents: costCents, units: [{ identifiers: [{ kind: 'imei1', value: imei }], condition: 'new' }] }]);
  return { ...p, unitId: r.unitIds[0]! };
}

async function facts(from: string, to: string) {
  const m = await getMetrics(deps, actor, { from, to });
  return m;
}

async function lotOfUnit(unitId: string) {
  return withTenant(deps.dbs.app, actor, (trx) =>
    trx.selectFrom('inventory_units as u').innerJoin('inventory_lots as l', 'l.id', 'u.current_lot_id').select(['l.id', 'l.cost_remaining_cents', 'l.status', 'u.status as unit_status']).where('u.id', '=', unitId).executeTakeFirstOrThrow(),
  );
}

describe('troca: exemplos numéricos do doc 02 §4', () => {
  it('T-007 Exemplo A e T-008 revenda após preparo', async () => {
    const today = todayIn(actor);
    const before = await facts(today, today);
    const bankBefore = await accountBalance(deps, actor, acc.bank);
    const out = await phoneInStock('Aparelho Demo A', 300000n, 400000n, 'DEMO-IMEI-A-OUT');
    const customer = await makeParty(deps, actor, 'Cliente Demonstração A');
    const sim = await simulateTrade(deps, actor, zTrade.parse({
      partyId: customer,
      outgoing: [{ variantId: out.variantId, unitId: out.unitId, quantity: 1, unitPriceCents: '400000' }],
      incoming: [{ newProduct: { name: 'Usado Demo A' }, agreedCents: '150000', unit: { identifiers: [{ kind: 'imei1', value: 'DEMO-IMEI-001' }], condition: 'used' } }],
      differencePolicy: 'receive',
      differencePayments: [{ kind: 'pix', amountCents: '250000' }],
    }));
    expect(sim.computation.offsetCents).toBe(150000n);
    expect(sim.computation.differenceCents).toBe(250000n);
    expect(sim.projected?.grossProfitCents).toBe(100000n);

    const r = await confirmTrade(deps, actor, zTrade.parse({
      partyId: customer,
      outgoing: [{ variantId: out.variantId, unitId: out.unitId, quantity: 1, unitPriceCents: '400000' }],
      incoming: [{ newProduct: { name: 'Usado Demo A' }, agreedCents: '150000', unit: { identifiers: [{ kind: 'imei1', value: 'DEMO-IMEI-001' }], condition: 'used' } }],
      differencePolicy: 'receive',
      differencePayments: [{ kind: 'pix', amountCents: '250000' }],
    }), randomUUID());
    const after = await facts(today, today);
    // Receita 4.000; CMV 3.000; bruto 1.000 (Δ em relação ao início do teste).
    expect(after.revenue.grossSalesCents - before.revenue.grossSalesCents).toBe(400000n);
    expect(after.result!.cogsCents - before.result!.cogsCents).toBe(300000n);
    expect(after.result!.grossProfitCents - before.result!.grossProfitCents).toBe(100000n);
    // Caixa real +2.500 (Pix); estoque recebido a custo 1.500; compensação 1.500.
    expect((await accountBalance(deps, actor, acc.bank)) - bankBefore).toBe(-300000n + 250000n);
    expect(BigInt(r.offsetCents as unknown as string)).toBe(150000n);
    const used = await lotOfUnit(r.receivedUnitIds[0]!);
    expect(used.cost_remaining_cents).toBe(150000n);
    expect(used.status).toBe('inspection');
    // Nenhum título da troca fica em aberto.
    const open = await withTenant(deps.dbs.app, actor, (trx) =>
      trx.selectFrom('financial_titles').select('id').where('origin_id', 'in', [r.saleId, r.purchaseId]).where('balance_cents', '>', 0n).execute(),
    );
    expect(open).toHaveLength(0);

    // T-008: reparo real de 100 antes da revenda → custo 1.600; revenda por 2.000 → bruto 400.
    await releaseInspection(deps, actor, { lotId: used.id });
    const ac = await addAcquisitionCost(deps, actor, zAcquisitionCost.parse({ lotId: used.id, description: 'Troca de tela (reparo)', amountCents: '10000', payNow: { accountId: acc.cash, method: 'cash' } }), randomUUID()).catch(async (e) => {
      // caixa sem saldo: registrar como conta a pagar
      if (e.code === 'conflict') return addAcquisitionCost(deps, actor, zAcquisitionCost.parse({ lotId: used.id, description: 'Troca de tela (reparo)', amountCents: '10000' }), randomUUID());
      throw e;
    });
    expect(BigInt(ac.toInventoryCents as unknown as string)).toBe(10000n);
    expect((await lotOfUnit(r.receivedUnitIds[0]!)).cost_remaining_cents).toBe(160000n);
    const variant = await withTenant(deps.dbs.app, actor, (trx) => trx.selectFrom('inventory_units').select('variant_id').where('id', '=', r.receivedUnitIds[0]!).executeTakeFirstOrThrow());
    const beforeResale = await facts(today, today);
    await confirmSale(deps, actor, zSale.parse({
      customerId: customer,
      items: [{ variantId: variant.variant_id, unitId: r.receivedUnitIds[0]!, quantity: 1, unitPriceCents: '200000' }],
      payments: [{ kind: 'pix', amountCents: '200000' }],
    }), randomUUID());
    const afterResale = await facts(today, today);
    expect(afterResale.result!.grossProfitCents - beforeResale.result!.grossProfitCents).toBe(40000n);
    // Cadeia: 1.000 + 400 = 1.400 (sem descontar a aquisição do usado duas vezes).
    expect(afterResale.result!.grossProfitCents - before.result!.grossProfitCents).toBe(140000n);
    expect(await reconcile(deps, actor)).toEqual([]);
  });

  it('T-009 Exemplo B com pagamento da diferença', async () => {
    const today = todayIn(actor);
    const out = await phoneInStock('Aparelho Demo B', 130000n, 200000n, 'DEMO-IMEI-B-OUT');
    const customer = await makeParty(deps, actor, 'Cliente Demonstração B');
    const before = await facts(today, today);
    const bankBefore = await accountBalance(deps, actor, acc.bank);
    const r = await confirmTrade(deps, actor, zTrade.parse({
      partyId: customer,
      outgoing: [{ variantId: out.variantId, unitId: out.unitId, quantity: 1, unitPriceCents: '200000' }],
      incoming: [{ newProduct: { name: 'Usado Demo B' }, agreedCents: '250000', unit: { identifiers: [{ kind: 'imei1', value: 'DEMO-IMEI-002' }] } }],
      differencePolicy: 'pay',
      payNow: { accountId: acc.bank, method: 'pix' },
    }), randomUUID());
    expect(r.direction).toBe('company_pays');
    const after = await facts(today, today);
    expect(after.result!.grossProfitCents - before.result!.grossProfitCents).toBe(70000n);
    expect((await accountBalance(deps, actor, acc.bank)) - bankBefore).toBe(-50000n);
    expect((await lotOfUnit(r.receivedUnitIds[0]!)).cost_remaining_cents).toBe(250000n);
    expect(await reconcile(deps, actor)).toEqual([]);
  });

  it('T-009b Exemplo B sem pagar agora: fica conta a pagar de 500 (padrão)', async () => {
    const out = await phoneInStock('Aparelho Demo B2', 130000n, 200000n, 'DEMO-IMEI-B2-OUT');
    const customer = await makeParty(deps, actor, 'Cliente Demonstração B2');
    const bankBefore = await accountBalance(deps, actor, acc.bank);
    const r = await confirmTrade(deps, actor, zTrade.parse({
      partyId: customer,
      outgoing: [{ variantId: out.variantId, unitId: out.unitId, quantity: 1, unitPriceCents: '200000' }],
      incoming: [{ newProduct: { name: 'Usado Demo B2' }, agreedCents: '250000', unit: { identifiers: [{ kind: 'imei1', value: 'DEMO-IMEI-002B' }] } }],
      differencePolicy: 'pay',
    }), randomUUID());
    const t = await withTenant(deps.dbs.app, actor, (trx) => trx.selectFrom('financial_titles').select(['balance_cents', 'direction']).where('id', '=', r.differenceTitleId!).executeTakeFirstOrThrow());
    expect(t).toEqual({ balance_cents: 50000n, direction: 'payable' });
    expect(await accountBalance(deps, actor, acc.bank)).toBe(bankBefore);
    // Pagamento posterior: caixa −500.
    await settleTitles(deps, actor, { direction: 'out', method: 'pix', accountId: acc.bank, allocations: [{ titleId: r.differenceTitleId!, amountCents: 50000n }] }, randomUUID());
    expect((await accountBalance(deps, actor, acc.bank)) - bankBefore).toBe(-50000n);
  });

  it('T-010 Exemplo B com crédito da loja: caixa zero; uso posterior não gera nova receita', async () => {
    const today = todayIn(actor);
    const out = await phoneInStock('Aparelho Demo C', 130000n, 200000n, 'DEMO-IMEI-C-OUT');
    const customer = await makeParty(deps, actor, 'Cliente Demonstração C');
    const bankBefore = await accountBalance(deps, actor, acc.bank);
    const cashBefore = await accountBalance(deps, actor, acc.cash);
    await confirmTrade(deps, actor, zTrade.parse({
      partyId: customer,
      outgoing: [{ variantId: out.variantId, unitId: out.unitId, quantity: 1, unitPriceCents: '200000' }],
      incoming: [{ newProduct: { name: 'Usado Demo C' }, agreedCents: '250000', unit: { identifiers: [{ kind: 'imei1', value: 'DEMO-IMEI-003' }] } }],
      differencePolicy: 'store_credit',
    }), randomUUID());
    expect(await accountBalance(deps, actor, acc.bank)).toBe(bankBefore);
    expect(await accountBalance(deps, actor, acc.cash)).toBe(cashBefore);
    const credit = await withTenant(deps.dbs.app, actor, (trx) => trx.selectFrom('store_credit_balances').select('balance_cents').where('party_id', '=', customer).executeTakeFirstOrThrow());
    expect(credit.balance_cents).toBe(50000n);

    // Uso do crédito numa venda de 300 (acessório): receita = 300 da nova venda; caixa zero.
    const acc2 = await makeProduct(deps, actor, { name: 'Capa Demo', priceCents: 30000n });
    await stockUp(deps, actor, supplier, [{ variantId: acc2.variantId, quantity: 2, unitCostCents: 10000n }]);
    const before = await facts(today, today);
    const bank2 = await accountBalance(deps, actor, acc.bank);
    await confirmSale(deps, actor, zSale.parse({ customerId: customer, items: [{ variantId: acc2.variantId, quantity: 1, unitPriceCents: '30000' }], payments: [{ kind: 'store_credit', amountCents: '30000' }] }), randomUUID());
    const after = await facts(today, today);
    expect(after.revenue.grossSalesCents - before.revenue.grossSalesCents).toBe(30000n);
    expect(await accountBalance(deps, actor, acc.bank)).toBe(bank2);
    const credit2 = await withTenant(deps.dbs.app, actor, (trx) => trx.selectFrom('store_credit_balances').select('balance_cents').where('party_id', '=', customer).executeTakeFirstOrThrow());
    expect(credit2.balance_cents).toBe(20000n);
    // Não permite usar mais crédito do que o saldo.
    await expect(
      confirmSale(deps, actor, zSale.parse({ customerId: customer, items: [{ variantId: acc2.variantId, quantity: 1, unitPriceCents: '30000' }], payments: [{ kind: 'store_credit', amountCents: '30000' }] }), randomUUID()),
    ).rejects.toMatchObject({ code: 'conflict' });
    expect(await reconcile(deps, actor)).toEqual([]);
  });

  it('T-011 Exemplo C troca equivalente: caixa zero, estoque 1.800, CMV 1.200, bruto 600', async () => {
    const today = todayIn(actor);
    const out = await phoneInStock('Aparelho Demo D', 120000n, 180000n, 'DEMO-IMEI-D-OUT');
    const customer = await makeParty(deps, actor, 'Cliente Demonstração D');
    const before = await facts(today, today);
    const bankBefore = await accountBalance(deps, actor, acc.bank);
    const cashBefore = await accountBalance(deps, actor, acc.cash);
    const r = await confirmTrade(deps, actor, zTrade.parse({
      partyId: customer,
      outgoing: [{ variantId: out.variantId, unitId: out.unitId, quantity: 1, unitPriceCents: '180000' }],
      incoming: [{ newProduct: { name: 'Usado Demo D' }, agreedCents: '180000', unit: { identifiers: [{ kind: 'imei1', value: 'DEMO-IMEI-004' }] } }],
      differencePolicy: 'none',
    }), randomUUID());
    const after = await facts(today, today);
    expect(after.result!.cogsCents - before.result!.cogsCents).toBe(120000n);
    expect(after.result!.grossProfitCents - before.result!.grossProfitCents).toBe(60000n);
    expect(after.cash.netCents - before.cash.netCents).toBe(0n);
    expect(await accountBalance(deps, actor, acc.bank)).toBe(bankBefore);
    expect(await accountBalance(deps, actor, acc.cash)).toBe(cashBefore);
    expect((await lotOfUnit(r.receivedUnitIds[0]!)).cost_remaining_cents).toBe(180000n);
    expect(await reconcile(deps, actor)).toEqual([]);
  });

  it('políticas incoerentes com a diferença são recusadas', async () => {
    const out = await phoneInStock('Aparelho Demo E', 100000n, 150000n, 'DEMO-IMEI-E-OUT');
    const customer = await makeParty(deps, actor, 'Cliente Demonstração E');
    await expect(confirmTrade(deps, actor, zTrade.parse({
      partyId: customer,
      outgoing: [{ variantId: out.variantId, unitId: out.unitId, quantity: 1, unitPriceCents: '150000' }],
      incoming: [{ newProduct: { name: 'Usado E' }, agreedCents: '50000' }],
      differencePolicy: 'pay',
    }), randomUUID())).rejects.toMatchObject({ code: 'validation_failed' });
    // Pagamentos da diferença precisam somar exatamente D.
    await expect(confirmTrade(deps, actor, zTrade.parse({
      partyId: customer,
      outgoing: [{ variantId: out.variantId, unitId: out.unitId, quantity: 1, unitPriceCents: '150000' }],
      incoming: [{ newProduct: { name: 'Usado E' }, agreedCents: '50000' }],
      differencePolicy: 'receive',
      differencePayments: [{ kind: 'pix', amountCents: '99999' }],
    }), randomUUID())).rejects.toMatchObject({ code: 'validation_failed' });
    // Falha não deixou nada parcial: unidade continua disponível.
    const u = await withTenant(deps.dbs.app, actor, (trx) => trx.selectFrom('inventory_units').select('status').where('id', '=', out.unitId).executeTakeFirstOrThrow());
    expect(u.status).toBe('available');
    expect(await reconcile(deps, actor)).toEqual([]);
  });
});

describe('reversão de troca', () => {
  it('reverte troca sem dependências e gera reembolso do dinheiro que transitou', async () => {
    const out = await phoneInStock('Aparelho Demo F', 100000n, 150000n, 'DEMO-IMEI-F-OUT');
    const customer = await makeParty(deps, actor, 'Cliente Demonstração F');
    const r = await confirmTrade(deps, actor, zTrade.parse({
      partyId: customer,
      outgoing: [{ variantId: out.variantId, unitId: out.unitId, quantity: 1, unitPriceCents: '150000' }],
      incoming: [{ newProduct: { name: 'Usado F' }, agreedCents: '50000', unit: { identifiers: [{ kind: 'imei1', value: 'DEMO-IMEI-005' }] } }],
      differencePolicy: 'receive',
      differencePayments: [{ kind: 'pix', amountCents: '100000' }],
    }), randomUUID());
    const rev = await reverseTrade(deps, actor, r.tradeId, 'Cliente desistiu', randomUUID());
    expect(BigInt(rev.refundToCustomerCents as unknown as string)).toBe(100000n);
    const unitOut = await withTenant(deps.dbs.app, actor, (trx) => trx.selectFrom('inventory_units').select('status').where('id', '=', out.unitId).executeTakeFirstOrThrow());
    expect(unitOut.status).toBe('inspection');
    const unitIn = await withTenant(deps.dbs.app, actor, (trx) => trx.selectFrom('inventory_units').select('status').where('id', '=', r.receivedUnitIds[0]!).executeTakeFirstOrThrow());
    expect(unitIn.status).toBe('returned_to_supplier');
    // Originais intactos; estorno rastreável.
    const sale = await withTenant(deps.dbs.app, actor, (trx) => trx.selectFrom('sales').select(['status', 'total_cents', 'returned_revenue_cents']).where('id', '=', r.saleId).executeTakeFirstOrThrow());
    expect(sale).toEqual({ status: 'reversed', total_cents: 150000n, returned_revenue_cents: 150000n });
    await expect(reverseTrade(deps, actor, r.tradeId, 'de novo', randomUUID())).rejects.toMatchObject({ code: 'conflict' });
    expect(await reconcile(deps, actor)).toEqual([]);
  });

  it('T-016: troca com produto recebido já revendido não permite cancelamento simples', async () => {
    const out = await phoneInStock('Aparelho Demo G', 100000n, 150000n, 'DEMO-IMEI-G-OUT');
    const customer = await makeParty(deps, actor, 'Cliente Demonstração G');
    const r = await confirmTrade(deps, actor, zTrade.parse({
      partyId: customer,
      outgoing: [{ variantId: out.variantId, unitId: out.unitId, quantity: 1, unitPriceCents: '150000' }],
      incoming: [{ newProduct: { name: 'Usado G' }, agreedCents: '150000', destination: 'available', unit: { identifiers: [{ kind: 'imei1', value: 'DEMO-IMEI-006' }] } }],
      differencePolicy: 'none',
    }), randomUUID());
    const v = await withTenant(deps.dbs.app, actor, (trx) => trx.selectFrom('inventory_units').select('variant_id').where('id', '=', r.receivedUnitIds[0]!).executeTakeFirstOrThrow());
    await confirmSale(deps, actor, zSale.parse({ items: [{ variantId: v.variant_id, unitId: r.receivedUnitIds[0]!, quantity: 1, unitPriceCents: '170000' }], payments: [{ kind: 'cash', amountCents: '170000' }] }), randomUUID());
    const snapshot = await withTenant(deps.dbs.app, actor, (trx) => sql<{ n: number }>`select count(*)::int as n from stock_movements`.execute(trx));
    await expect(reverseTrade(deps, actor, r.tradeId, 'Tentativa', randomUUID())).rejects.toMatchObject({ code: 'conflict' });
    const after = await withTenant(deps.dbs.app, actor, (trx) => sql<{ n: number }>`select count(*)::int as n from stock_movements`.execute(trx));
    expect(after.rows[0]!.n).toBe(snapshot.rows[0]!.n);
    const trade = await withTenant(deps.dbs.app, actor, (trx) => trx.selectFrom('trades').select('status').where('id', '=', r.tradeId).executeTakeFirstOrThrow());
    expect(trade.status).toBe('confirmed');
  });
});
