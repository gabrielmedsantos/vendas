import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { withTenant } from '@gct/db';
import { adjustAccountBalance, balanceBreakdown, confirmSale, createExpense, quickPurchase, zExpense, zPurchase, zSale, getMetrics, listAccounts, openCashSession, closeCashSession, recordCashMovement, unifyAccounts, zCashMovement } from '@gct/app';
import { accounts, closeDeps, createTenant, makeParty, makeProduct, reconcile, testDeps, todayIn } from './helpers';

const deps = testDeps();
afterAll(closeDeps);

const total = (rows: { balance_cents: bigint }[]) => rows.reduce((a, r) => a + BigInt(r.balance_cents), 0n);

describe('conta única', () => {
  it('empresa nova nasce com uma conta só, usada por todas as formas de pagamento com dinheiro', async () => {
    const T = await createTenant(deps, 'Loja Conta Única');
    const rows = await listAccounts(deps, T.owner);
    expect(rows.map((r) => r.name)).toEqual(['Conta da loja']);
    const pm = await withTenant(deps.dbs.app, T.owner, (trx) => trx.selectFrom('payment_methods').select(['kind', 'account_id']).execute());
    for (const m of pm.filter((x) => ['cash', 'pix', 'debit', 'credit', 'bank_transfer'].includes(x.kind))) expect(m.account_id).toBe(rows[0]!.id);
  });

  it('unificar: saldo vai por transferência, formas de pagamento mudam, outra conta arquivada, nada apagado', async () => {
    const T = await createTenant(deps, 'Loja Duas Contas');
    const actor = T.owner;
    const acc = await accounts(deps, actor); // cria o caixa separado (configuração antiga)
    await recordCashMovement(deps, actor, zCashMovement.parse({ accountId: acc.cash, kind: 'capital_in', amountCents: '30000', description: 'Aporte no caixa' }), randomUUID());
    await recordCashMovement(deps, actor, zCashMovement.parse({ accountId: acc.bank, kind: 'capital_in', amountCents: '50000', description: 'Aporte no banco' }), randomUUID());
    const before = await listAccounts(deps, actor);
    const movesBefore = await withTenant(deps.dbs.app, actor, (trx) => trx.selectFrom('cash_movements').select('id').execute());

    // Caixa aberto impede.
    const s = await openCashSession(deps, actor, acc.cash, 30000n);
    await expect(unifyAccounts(deps, actor, { targetId: acc.bank })).rejects.toMatchObject({ code: 'conflict' });
    await closeCashSession(deps, actor, s.id, 30000n);

    const r = await unifyAccounts(deps, actor, { targetId: acc.bank, name: 'Conta da loja 2' });
    expect(r.archived).toBe(1);
    const after = await listAccounts(deps, actor);
    expect(total(after)).toBe(total(before));
    const bank = after.find((a) => a.id === acc.bank)!;
    const cash = after.find((a) => a.id === acc.cash)!;
    expect(bank).toMatchObject({ name: 'Conta da loja 2', status: 'active', balance_cents: 80000n });
    expect(cash).toMatchObject({ status: 'archived', balance_cents: 0n });
    const pm = await withTenant(deps.dbs.app, actor, (trx) => trx.selectFrom('payment_methods').select(['account_id']).where('kind', '=', 'cash').executeTakeFirstOrThrow());
    expect(pm.account_id).toBe(acc.bank);
    const movesAfter = await withTenant(deps.dbs.app, actor, (trx) => trx.selectFrom('cash_movements').select(['id', 'kind']).execute());
    expect(movesAfter.length).toBe(movesBefore.length + 2);
    for (const m of movesBefore) expect(movesAfter.some((x) => x.id === m.id)).toBe(true);
    expect(movesAfter.filter((m) => !movesBefore.some((b) => b.id === m.id)).map((m) => m.kind).sort()).toEqual(['transfer_in', 'transfer_out']);
    expect(await reconcile(deps, actor)).toEqual([]);

    // Repetir não faz nada de novo; conta arquivada não pode ser a escolhida.
    await expect(unifyAccounts(deps, actor, { targetId: acc.bank })).resolves.toMatchObject({ archived: 0 });
    await expect(unifyAccounts(deps, actor, { targetId: acc.cash })).rejects.toMatchObject({ code: 'not_found' });
  });

  it('ajustar saldo ao valor real: lança só a diferença, fora da receita; repetir com a mesma chave não duplica', async () => {
    const T = await createTenant(deps, 'Loja Ajuste Saldo');
    const actor = T.owner;
    const conta = (await listAccounts(deps, actor))[0]!;
    const key = randomUUID();
    const up = await adjustAccountBalance(deps, actor, conta.id, { targetCents: 264300n, reason: 'Conferência com o extrato' }, key);
    expect(up.diffCents).toBe('264300');
    const again = await adjustAccountBalance(deps, actor, conta.id, { targetCents: 264300n, reason: 'Conferência com o extrato' }, key);
    expect(again.id).toBe(up.id);
    const down = await adjustAccountBalance(deps, actor, conta.id, { targetCents: 116100n, reason: 'Gastos não lançados' }, randomUUID());
    expect(down.diffCents).toBe('-148200');
    expect((await listAccounts(deps, actor))[0]!.balance_cents).toBe(116100n);
    await expect(adjustAccountBalance(deps, actor, conta.id, { targetCents: 116100n, reason: 'Nada muda' }, randomUUID())).rejects.toMatchObject({ code: 'conflict' });
    const m = await getMetrics(deps, actor, {});
    expect(JSON.stringify(m, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))).not.toMatch(/264300|148200/);
    expect(await reconcile(deps, actor)).toEqual([]);
  });

  it('de onde vem o saldo: vendas recebidas − compras e despesas pagas = saldo; compra a prazo fica em aberto', async () => {
    const T = await createTenant(deps, 'Loja Saldo Explicado');
    const actor = T.owner;
    const conta = (await listAccounts(deps, actor))[0]!;
    const sup = await makeParty(deps, actor, 'Fornecedor Saldo', { supplier: true, customer: false });
    const p = await makeProduct(deps, actor, { name: 'Fone Saldo', priceCents: 10000n });
    await quickPurchase(deps, actor, zPurchase.parse({ supplierId: sup, purchaseDate: todayIn(actor), items: [{ variantId: p.variantId, quantity: 5, unitCostCents: '4000' }], paymentTerms: { mode: 'pay_now', accountId: conta.id, method: 'pix' } }), randomUUID());
    await quickPurchase(deps, actor, zPurchase.parse({ supplierId: sup, purchaseDate: todayIn(actor), items: [{ variantId: p.variantId, quantity: 2, unitCostCents: '4000' }], paymentTerms: { mode: 'due', dueDate: todayIn(actor) } }), randomUUID());
    await confirmSale(deps, actor, zSale.parse({ items: [{ variantId: p.variantId, quantity: 3, unitPriceCents: '10000' }], payments: [{ kind: 'pix', amountCents: '30000' }] }), randomUUID());
    await createExpense(deps, actor, zExpense.parse({ description: 'Anúncios', competenceDate: todayIn(actor), amountCents: '5000', payNow: { accountId: conta.id, method: 'pix' } }), randomUUID());
    const b = await balanceBreakdown(deps, actor);
    const by = Object.fromEntries(b.items.map((i) => [i.label, i.cents]));
    expect(by['Vendas recebidas']).toBe(30000n);
    expect(by['Compras de mercadoria pagas']).toBe(-20000n);
    expect(by['Despesas pagas']).toBe(-5000n);
    expect(b.balanceCents).toBe(5000n);
    expect(b.balanceCents).toBe(total(await listAccounts(deps, actor)));
    expect(b.openPayableCents).toBe(8000n);
    expect(b.stockCostCents).toBe(16000n); // 4 unidades a R$ 40
  });
});
