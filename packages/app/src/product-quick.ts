import { z } from 'zod';
import { invalid } from '@gct/shared';
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
      source: z.discriminatedUnion('mode', [
        z.object({
          mode: z.literal('purchase'),
          supplierId: zUuid.optional().nullable(),
          supplierName: zText(160).optional().nullable(),
          purchaseDate: zLocalDate.optional(),
          paymentTerms: zPaymentTerms,
        }),
        z.object({ mode: z.literal('opening') }),
      ]),
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
    requirePermission(actor, stock.source.mode === 'purchase' ? 'purchases.manage' : 'inventory.adjust');
    for (const e of stock.entries) {
      if (e.variantIndex >= input.product.variants.length) throw invalid('Variação inexistente no estoque inicial.', { stock: 'variação' });
      if (input.product.tracking === 'serialized' && (e.units?.length ?? 0) !== e.quantity)
        throw invalid('Produto por unidade: informe o IMEI/série de cada unidade.', { units: 'obrigatório' });
    }
    if (stock.source.mode === 'purchase' && !stock.source.supplierId && !stock.source.supplierName?.trim())
      throw invalid('Escolha ou digite o fornecedor.', { supplierId: 'obrigatório' });
  }
  return tx(deps, actor, async (trx) => {
    const { result } = await idempotent(trx, actor.tenantId, 'product.create_with_stock', idempotencyKey, input, async () => {
      const { id } = await createProductInTx(trx, actor, input.product);
      if (!stock) return { id, purchaseId: null as string | null };
      const variants = await trx.selectFrom('product_variants').select(['id', 'sku']).where('product_id', '=', id).execute();
      const bySku = new Map(variants.map((v) => [v.sku.toLowerCase(), v.id]));
      const variantId = (i: number) => bySku.get(input.product.variants[i]!.sku.toLowerCase())!;

      if (stock.source.mode === 'opening') {
        const loc = await defaultLocation(trx);
        const reason = stock.notes?.trim() || 'Estoque inicial no cadastro do produto';
        for (const e of stock.entries) {
          const v = { id: variantId(e.variantIndex), tracking: input.product.tracking };
          if (input.product.tracking === 'serialized') {
            for (const unit of e.units!) await stockEntryInTx(trx, actor, { variantId: v.id, direction: 'in', kind: 'opening', quantity: 1, unitCostCents: e.unitCostCents, unit, reason }, v, loc);
          } else {
            await stockEntryInTx(trx, actor, { variantId: v.id, direction: 'in', kind: 'opening', quantity: e.quantity, unitCostCents: e.unitCostCents, reason }, v, loc);
          }
        }
        await audit(trx, actor, 'product.created_with_stock', 'product', id, { mode: 'opening', entries: stock.entries.length });
        return { id, purchaseId: null };
      }

      const src = stock.source;
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
        items: stock.entries.map((e) => ({ variantId: variantId(e.variantIndex), quantity: e.quantity, unitCostCents: e.unitCostCents, unitSpecs: e.units })),
        discountCents: 0n,
        extraCostsCents: 0n,
        paymentTerms: src.paymentTerms,
        notes: stock.notes ?? `Estoque inicial do produto ${input.product.name}`,
      });
      await audit(trx, actor, 'product.created_with_stock', 'product', id, { mode: 'purchase', purchaseId: p.id });
      return { id, purchaseId: p.id };
    });
    return result;
  });
}
