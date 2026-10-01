import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { cashFlow, confirmSale, createExpense, listAccounts, quickPurchase, recordCashMovement, reverseCashMovement, zCashFlow, zCashMovement, zExpense, zPurchase, zSale } from '@gct/app';
import { addDays } from '@gct/shared';
import { closeDeps, createTenant, makeParty, makeProduct, reconcile, testDeps, todayIn, withPerms } from './helpers';

const deps = testDeps();
afterAll(closeDeps);

describe('fluxo de caixa', () => {
  it('entradas e saídas do período com origem; saldo inicial + entradas − saídas = saldo final; filtros só na lista', async () => {
    const T = await createTenant(deps, 'Loja Fluxo');
    const actor = T.owner;
    const conta = (await listAccounts(deps, actor))[0]!.id;
    const hoje = todayIn(actor);
    const ontem = addDays(hoje, -1);
    // Antes do período: saldo inicial (aporte de ontem).
    await recordCashMovement(deps, actor, zCashMovement.parse({ accountId: conta, kind: 'capital_in', amountCents: '50000', occurredOn: ontem, description: 'Aporte inicial' }), randomUUID());
    const sup = await makeParty(deps, actor, 'Fornecedor Fluxo', { supplier: true, customer: false });
    const cli = await makeParty(deps, actor, 'Maria Cliente', { customer: true, supplier: false });
    const p = await makeProduct(deps, actor, { name: 'Fone Fluxo', priceCents: 10000n });
    await quickPurchase(deps, actor, zPurchase.parse({ supplierId: sup, purchaseDate: hoje, items: [{ variantId: p.variantId, quantity: 3, unitCostCents: '4000' }], paymentTerms: { mode: 'pay_now', accountId: conta, method: 'pix' } }), randomUUID());
    await confirmSale(deps, actor, zSale.parse({ customerId: cli, items: [{ variantId: p.variantId, quantity: 2, unitPriceCents: '10000' }], payments: [{ kind: 'pix', amountCents: '20000' }] }), randomUUID());
    await createExpense(deps, actor, zExpense.parse({ description: 'Anúncio Instagram', competenceDate: hoje, amountCents: '3000', payNow: { accountId: conta, method: 'pix' } }), randomUUID());
    const errado = await recordCashMovement(deps, actor, zCashMovement.parse({ accountId: conta, kind: 'withdrawal', amountCents: '1000', description: 'Retirada lançada errado' }), randomUUID());
    await reverseCashMovement(deps, actor, (errado as { id: string }).id, 'Lançada errado');

    const f = await cashFlow(deps, actor, zCashFlow.parse({ from: hoje, to: hoje }));
    expect(f.summary.openingCents).toBe(50000n);
    expect(f.summary.inCents).toBe(20000n + 1000n); // venda + estorno da retirada
    expect(f.summary.outCents).toBe(12000n + 3000n + 1000n); // compra + despesa + retirada
    expect(f.summary.closingCents).toBe(50000n + f.summary.inCents - f.summary.outCents);
    expect(f.summary.balanceNowCents).toBe(f.summary.closingCents);
    expect(f.summary.closingCents).toBe((await listAccounts(deps, actor)).reduce((a, r) => a + BigInt(r.balance_cents), 0n));
    const cat = Object.fromEntries(f.byCategory.map((c) => [c.category, c]));
    expect(cat.sale).toMatchObject({ inCents: 20000n, outCents: 0n });
    expect(cat.purchase).toMatchObject({ outCents: 12000n });
    expect(cat.expense).toMatchObject({ outCents: 3000n });
    expect(cat.capital).toMatchObject({ outCents: 1000n });
    expect(cat.adjustment).toMatchObject({ inCents: 1000n });
    expect(f.series).toHaveLength(1);
    expect(f.series[0]).toMatchObject({ day: hoje, inCents: 21000n, outCents: 16000n, balanceCents: f.summary.closingCents });
    // Lista: venda mostra cliente e descrição do título; despesa idem.
    const venda = f.data.find((r) => r.category === 'sale')!;
    expect(venda).toMatchObject({ party_name: 'Maria Cliente', title_origin: 'sale', direction: 'in' });
    expect(venda.title_origin_id).toBeTruthy();

    // Filtros afetam só a lista; resumo continua o do período.
    const saidas = await cashFlow(deps, actor, zCashFlow.parse({ from: hoje, to: hoje, direction: 'out' }));
    expect(saidas.data.every((r) => r.direction === 'out')).toBe(true);
    expect(saidas.summary).toEqual(f.summary);
    const busca = await cashFlow(deps, actor, zCashFlow.parse({ from: hoje, to: hoje, q: 'instagram' }));
    expect(busca.data.map((r) => r.category)).toEqual(['expense']);
    const porValor = await cashFlow(deps, actor, zCashFlow.parse({ from: hoje, to: hoje, q: '200' }));
    expect(porValor.data.map((r) => r.category)).toEqual(['sale']);
    const compras = await cashFlow(deps, actor, zCashFlow.parse({ from: hoje, to: hoje, category: 'purchase' }));
    expect(compras.data).toHaveLength(1);

    // Período com ontem: saldo inicial zero, aporte entra como capital.
    const dois = await cashFlow(deps, actor, zCashFlow.parse({ from: ontem, to: hoje }));
    expect(dois.summary.openingCents).toBe(0n);
    expect(dois.series.map((s) => s.balanceCents)).toEqual([50000n, f.summary.closingCents]);
    await expect(cashFlow(deps, actor, zCashFlow.parse({ from: hoje, to: ontem }))).rejects.toMatchObject({ code: 'validation_failed' });
    expect(await reconcile(deps, actor)).toEqual([]);
  });

  it('sem permissão financeira não vê o fluxo', async () => {
    const T = await createTenant(deps, 'Loja Fluxo Perm');
    const seller = withPerms(T.owner, 'seller');
    await expect(cashFlow(deps, seller, zCashFlow.parse({}))).rejects.toMatchObject({ code: 'forbidden' });
  });
});
