import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { withTenant } from '@gct/db';
import { listAccounts, openCashSession, closeCashSession, recordCashMovement, unifyAccounts, zCashMovement } from '@gct/app';
import { accounts, closeDeps, createTenant, reconcile, testDeps } from './helpers';

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
});
