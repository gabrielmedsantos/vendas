import { z } from 'zod';
import { invalid, notFound } from '@gct/shared';
import type { Tx } from '@gct/db';
import { createProductInTx, zProduct } from './catalog';
import { audit, idempotent, requirePermission, requireWritable, todayLocal, tx, type Actor, type AppDeps } from './core';
import { defaultLocation, stockEntryInTx, zUnitSpec } from './inventory';
import { quickPurchaseInTx, zPaymentTerms } from './purchases';
import { zCentsNonNeg, zLocalDate, zQty, zText, zUuid } from './validation';

/**
 * Cadastro completo em um passo: produto + estoque inicial com custo.
 * A entrada vira uma compra de verdade (aparece em Compras, a pagar/fluxo de caixa conforme o pagamento)
 * ou, para mercadoria que a loja já tinha, um saldo inicial de estoque (sem dinheiro envolvido).
 * Tudo numa transação: ou entra tudo, ou nada.
 */
/** De onde veio a mercadoria: compra (paga ou a pagar) ou estoque que a loja já tinha. */
export const zStockSource = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('purchase'),
    supplierId: zUuid.optional().nullable(),
    supplierName: zText(160).optional().nullable(),
    purchaseDate: zLocalDate.optional(),
    paymentTerms: zPaymentTerms,
  }),
  z.object({ mode: z.literal('opening') }),
]);
type StockSource = z.infer<typeof zStockSource>;
interface Entry { variantId: string; quantity: number; unitCostCents: bigint; units?: z.infer<typeof zUnitSpec>[] }

/** Lança a entrada dentro da transação: compra recebida ou saldo inicial (sem caixa). */
async function applyStockEntry(trx: Tx, actor: Actor, a: { entries: Entry[]; tracking: string; source: StockSource; notes?: string | null; label: string }) {
  if (a.source.mode === 'opening') {
    const loc = await defaultLocation(trx);
    const reason = a.notes?.trim() || `Estoque que a loja já tinha: ${a.label}`;
    for (const e of a.entries) {
      const v = { id: e.variantId, tracking: a.tracking };
      if (a.tracking === 'serialized') {
        for (const unit of e.units!) await stockEntryInTx(trx, actor, { variantId: v.id, direction: 'in', kind: 'opening', quantity: 1, unitCostCents: e.unitCostCents, unit, reason }, v, loc);
      } else {
        await stockEntryInTx(trx, actor, { variantId: v.id, direction: 'in', kind: 'opening', quantity: e.quantity, unitCostCents: e.unitCostCents, reason }, v, loc);
      }
    }
    return { purchaseId: null as string | null };
  }
  const src = a.source;
  let supplierId = src.supplierId ?? null;
  if (!supplierId) {
    // Fornecedor digitado: reaproveita a ficha com o mesmo nome ou cria uma ficha de fornecedor.
    const name = src.supplierName!.trim();
    const found = await trx.selectFrom('parties').select(['id', 'is_supplier']).where('name', 'ilike', name.replace(/[%_\\]/g, '\\$&')).executeTakeFirst();
    if (found) {
      if (!found.is_supplier) await trx.updateTable('parties').set({ is_supplier: true }).where('id', '=', found.id).execute();
      supplierId = found.id;
    } else {
      const row = await trx.insertInto('parties').values({ tenant_id: actor.tenantId, person_type: 'PF', name, is_customer: false, is_supplier: true, created_by: actor.userId }).returning('id').executeTakeFirstOrThrow();
      await audit(trx, actor, 'party.created', 'party', row.id, { roles: { supplier: true }, via: 'product' });
      supplierId = row.id;
    }
  }
  const p = await quickPurchaseInTx(trx, actor, {
    supplierId,
    purchaseDate: src.purchaseDate ?? todayLocal(actor.timezone),
    items: a.entries.map((e) => ({ variantId: e.variantId, quantity: e.quantity, unitCostCents: e.unitCostCents, unitSpecs: e.units })),
    discountCents: 0n,
    extraCostsCents: 0n,
    paymentTerms: src.paymentTerms,
    notes: a.notes ?? `Entrada de estoque: ${a.label}`,
  });
  return { purchaseId: p.id as string | null };
}

function checkEntries(actor: Actor, tracking: string, entries: { quantity: number; units?: unknown[] }[], source: StockSource) {
  requirePermission(actor, source.mode === 'purchase' ? 'purchases.manage' : 'inventory.adjust');
  for (const e of entries) {
    if (tracking === 'serialized' && (e.units?.length ?? 0) !== e.quantity) throw invalid('Produto por unidade: informe o IMEI/série de cada unidade.', { units: 'obrigatório' });
  }
  if (source.mode === 'purchase' && !source.supplierId && !source.supplierName?.trim()) throw invalid('Escolha ou digite o fornecedor.', { supplierId: 'obrigatório' });
}

export const zProductWithStock = z.object({
  product: zProduct,
  stock: z
    .object({
      entries: z
        .array(
          z.object({
            /** Posição da variação em product.variants. */
            variantIndex: z.number().int().min(0).max(99),
            quantity: zQty,
            unitCostCents: zCentsNonNeg,
            /** Produto por unidade (IMEI/série): uma ficha por unidade. */
            units: z.array(zUnitSpec).max(200).optional(),
          }),
        )
        .min(1)
        .max(100),
      source: zStockSource,
      notes: zText(2000).optional().nullable(),
    })
    .optional()
    .nullable(),
});
export type ProductWithStockInput = z.infer<typeof zProductWithStock>;

export async function createProductWithStock(deps: AppDeps, actor: Actor, input: ProductWithStockInput, idempotencyKey?: string) {
  requirePermission(actor, 'products.manage');
  requireWritable(actor);
  const stock = input.stock;
  if (stock) {
    if (input.product.kind === 'service') throw invalid('Serviço não tem estoque.', { stock: 'inválido' });
    for (const e of stock.entries) if (e.variantIndex >= input.product.variants.length) throw invalid('Variação inexistente no estoque inicial.', { stock: 'variação' });
    checkEntries(actor, input.product.tracking, stock.entries, stock.source);
  }
  return tx(deps, actor, async (trx) => {
    const { result } = await idempotent(trx, actor.tenantId, 'product.create_with_stock', idempotencyKey, input, async () => {
      const { id } = await createProductInTx(trx, actor, input.product);
      if (!stock) return { id, purchaseId: null as string | null };
      const variants = await trx.selectFrom('product_variants').select(['id', 'sku']).where('product_id', '=', id).execute();
      const bySku = new Map(variants.map((v) => [v.sku.toLowerCase(), v.id]));
      const variantId = (i: number) => bySku.get(input.product.variants[i]!.sku.toLowerCase())!;

      const r = await applyStockEntry(trx, actor, {
        entries: stock.entries.map((e) => ({ variantId: variantId(e.variantIndex), quantity: e.quantity, unitCostCents: e.unitCostCents, units: e.units })),
        tracking: input.product.tracking, source: stock.source, notes: stock.notes ?? `Estoque inicial do produto ${input.product.name}`, label: input.product.name,
      });
      await audit(trx, actor, 'product.created_with_stock', 'product', id, { mode: stock.source.mode, purchaseId: r.purchaseId });
      return { id, purchaseId: r.purchaseId };
    });
    return result;
  });
}

/** Entrada de estoque de um produto já cadastrado (reposição), pelo mesmo caminho do cadastro. */
export const zStockEntry = z.object({
  entries: z.array(z.object({ variantId: zUuid, quantity: zQty, unitCostCents: zCentsNonNeg, units: z.array(zUnitSpec).max(200).optional() })).min(1).max(100),
  source: zStockSource,
  notes: zText(2000).optional().nullable(),
});

export async function stockEntry(deps: AppDeps, actor: Actor, productId: string, input: z.infer<typeof zStockEntry>, idempotencyKey?: string) {
  requireWritable(actor);
  return tx(deps, actor, async (trx) => {
    const p = await trx.selectFrom('products').select(['id', 'name', 'kind', 'tracking', 'status']).where('id', '=', productId).executeTakeFirst();
    if (!p) throw notFound('Produto');
    if (p.kind === 'service') throw invalid('Serviço não tem estoque.');
    if (p.status === 'archived') throw invalid('Produto arquivado não recebe estoque.');
    checkEntries(actor, p.tracking, input.entries, input.source);
    const own = await trx.selectFrom('product_variants').select('id').where('product_id', '=', productId).execute();
    if (input.entries.some((e) => !own.some((v) => v.id === e.variantId))) throw invalid('Variação não pertence a este produto.', { variantId: 'inválida' });
    const { result } = await idempotent(trx, actor.tenantId, 'product.stock_entry', idempotencyKey, { productId, input }, async () => {
      const r = await applyStockEntry(trx, actor, { entries: input.entries, tracking: p.tracking, source: input.source, notes: input.notes, label: p.name });
      await audit(trx, actor, 'product.stock_entry', 'product', productId, { mode: input.source.mode, purchaseId: r.purchaseId, qty: input.entries.reduce((a, e) => a + e.quantity, 0) });
      return r;
    });
    return result;
  });
}
