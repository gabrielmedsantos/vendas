import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { withTenant } from '@gct/db';
import { cashFlow, createProductWithStock, getProduct, listAccounts, listPurchases, zCashFlow, zProductWithStock, zPurchaseList } from '@gct/app';
import { closeDeps, createTenant, reconcile, testDeps, todayIn, withPerms } from './helpers';

const deps = testDeps();
afterAll(closeDeps);

const product = (name: string, sku: string, extra: Record<string, unknown> = {}) => ({ name, variants: [{ sku, retailPriceCents: '6000', minStock: 2 }], ...extra });

describe('cadastro de produto com estoque inicial', () => {
  it('pago agora: cria produto, compra recebida, estoque com custo e saída no fluxo de caixa — numa transação', async () => {
    const T = await createTenant(deps, 'Loja Cadastro Rápido');
    const actor = T.owner;
    const conta = (await listAccounts(deps, actor))[0]!.id;
    const key = randomUUID();
    const input = zProductWithStock.parse({
      product: product('Poltrona Inflável', 'POL-1'),
      stock: { entries: [{ variantIndex: 0, quantity: 10, unitCostCents: '3000' }], source: { mode: 'purchase', supplierName: 'Distribuidora Nova', paymentTerms: { mode: 'pay_now', accountId: conta, method: 'pix' } } },
    });
    const r = await createProductWithStock(deps, actor, input, key);
    const again = await createProductWithStock(deps, actor, input, key);
    expect(again.id).toBe(r.id); // repetir não duplica
    expect(r.purchaseId).toBeTruthy();
    const p = await getProduct(deps, actor, r.id);
    expect((p.variants[0] as unknown as { on_hand: number }).on_hand).toBe(10);
    const compras = await listPurchases(deps, actor, zPurchaseList.parse({}));
    expect(compras.data).toHaveLength(1);
    const f = await cashFlow(deps, actor, zCashFlow.parse({ from: todayIn(actor), to: todayIn(actor) }));
    expect(f.summary.outCents).toBe(30000n);
    expect(f.data[0]).toMatchObject({ category: 'purchase', party_name: 'Distribuidora Nova' });
    // Fornecedor digitado de novo reaproveita a ficha.
    await createProductWithStock(deps, actor, zProductWithStock.parse({
      product: product('Pufe', 'PUF-1'),
      stock: { entries: [{ variantIndex: 0, quantity: 1, unitCostCents: '1000' }], source: { mode: 'purchase', supplierName: 'distribuidora nova', paymentTerms: { mode: 'due', dueDate: todayIn(actor) } } },
    }), randomUUID());
    const fornecedores = await withTenant(deps.dbs.app, actor, (trx) => trx.selectFrom('parties').select('id').where('is_supplier', '=', true).execute());
    expect(fornecedores).toHaveLength(1);
    expect(await reconcile(deps, actor)).toEqual([]);
  });

  it('estoque que a loja já tinha: entra com custo, sem compra e fora do fluxo de caixa', async () => {
    const T = await createTenant(deps, 'Loja Saldo Inicial');
    const actor = T.owner;
    const r = await createProductWithStock(deps, actor, zProductWithStock.parse({
      product: product('Capinha', 'CAP-1'),
      stock: { entries: [{ variantIndex: 0, quantity: 5, unitCostCents: '700' }], source: { mode: 'opening' } },
    }), randomUUID());
    expect(r.purchaseId).toBeNull();
    const lot = await withTenant(deps.dbs.app, actor, (trx) => trx.selectFrom('inventory_lots').select(['qty_remaining', 'cost_remaining_cents', 'source_type']).executeTakeFirstOrThrow());
    expect(lot).toEqual({ qty_remaining: 5, cost_remaining_cents: 3500n, source_type: 'opening' });
    const f = await cashFlow(deps, actor, zCashFlow.parse({ from: todayIn(actor), to: todayIn(actor) }));
    expect(f.summary.outCents).toBe(0n);
    expect(await reconcile(deps, actor)).toEqual([]);
  });

  it('por unidade (IMEI): exige um IMEI por unidade; falha não deixa produto pela metade', async () => {
    const T = await createTenant(deps, 'Loja IMEI');
    const actor = T.owner;
    const base = { product: product('iPhone 13', 'IP13', { tracking: 'serialized', identifierKinds: ['imei1'] }) };
    await expect(createProductWithStock(deps, actor, zProductWithStock.parse({ ...base, stock: { entries: [{ variantIndex: 0, quantity: 2, unitCostCents: '250000', units: [{ identifiers: [{ kind: 'imei1', value: '350000000000011' }] }] }], source: { mode: 'opening' } } }), randomUUID()))
      .rejects.toMatchObject({ code: 'validation_failed' });
    // Erro dentro da transação (SKU repetido na compra não existe; força IMEI duplicado) → nada fica gravado.
    const dup = [{ identifiers: [{ kind: 'imei1', value: '350000000000022' }] }, { identifiers: [{ kind: 'imei1', value: '350000000000022' }] }];
    await expect(createProductWithStock(deps, actor, zProductWithStock.parse({ ...base, stock: { entries: [{ variantIndex: 0, quantity: 2, unitCostCents: '250000', units: dup }], source: { mode: 'opening' } } }), randomUUID())).rejects.toBeTruthy();
    const count = await withTenant(deps.dbs.app, actor, (trx) => trx.selectFrom('products').select('id').execute());
    expect(count).toHaveLength(0);
    const ok = await createProductWithStock(deps, actor, zProductWithStock.parse({ ...base, stock: { entries: [{ variantIndex: 0, quantity: 1, unitCostCents: '250000', units: [{ identifiers: [{ kind: 'imei1', value: '350000000000033' }], condition: 'used', batteryHealthPct: 89 }] }], source: { mode: 'opening' } } }), randomUUID());
    expect((await getProduct(deps, actor, ok.id)).variants[0]).toMatchObject({ on_hand: 1 });
  });

  it('vendedor sem permissão de compra não lança estoque por aqui', async () => {
    const T = await createTenant(deps, 'Loja Perm Produto');
    const seller = withPerms(T.owner, 'seller', ['products.manage']);
    await expect(createProductWithStock(deps, seller, zProductWithStock.parse({
      product: product('Fone', 'F-1'),
      stock: { entries: [{ variantIndex: 0, quantity: 1, unitCostCents: '100' }], source: { mode: 'opening' } },
    }), randomUUID())).rejects.toMatchObject({ code: 'forbidden' });
  });
});
