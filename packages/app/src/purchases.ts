import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { jsonb, nextNumber, sql, type Tx } from '@gct/db';
import { computePurchaseTotals, receivedCostShare } from '@gct/domain';
import { allocateLargestRemainder, AppError, conflict, invalid, notFound } from '@gct/shared';
import { audit, can, emit, idempotent, requirePermission, requireWritable, todayLocal, tx, type Actor, type AppDeps } from './core';
import { assertPeriodOpen, cancelTitleBalance, createInstallmentTitles, createTitle, recordSettlement, type FinCtx } from './finance';
import { defaultLocation, stockIn, upsertUnitForEntry, zUnitSpec, type UnitSpec } from './inventory';
import { requestDocument } from './documents';
import { decodeCursor, pageOf, zCentsNonNeg, zCentsPos, zLocalDate, zPageQuery, zQty, zText, zUuid } from './validation';

export const zPaymentTerms = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('pay_now'), accountId: zUuid, method: z.enum(['cash', 'pix', 'debit', 'credit', 'bank_transfer', 'boleto', 'other']) }),
  z.object({ mode: z.literal('due'), dueDate: zLocalDate }),
  z.object({ mode: z.literal('installments'), count: z.number().int().min(1).max(48), firstDueDate: zLocalDate, interval: z.union([z.literal('monthly'), z.number().int().min(1).max(365)]) }),
]);
export type PaymentTerms = z.infer<typeof zPaymentTerms>;

export const zPurchase = z.object({
  supplierId: zUuid,
  purchaseDate: zLocalDate,
  items: z
    .array(
      z.object({
        variantId: zUuid,
        quantity: zQty,
        unitCostCents: zCentsNonNeg,
        discountCents: zCentsNonNeg.optional(),
        unitSpecs: z.array(zUnitSpec).max(500).optional(),
      }),
    )
    .min(1)
    .max(200),
  discountCents: zCentsNonNeg.default(0n),
  extraCostsCents: zCentsNonNeg.default(0n),
  paymentTerms: zPaymentTerms,
  notes: zText(2000).optional().nullable(),
});
export type PurchaseInput = z.infer<typeof zPurchase>;

async function loadVariants(trx: Tx, ids: string[]) {
  const rows = await trx
    .selectFrom('product_variants as v')
    .innerJoin('products as p', 'p.id', 'v.product_id')
    .select(['v.id', 'v.sku', 'v.label', 'p.name', 'p.kind', 'p.tracking', 'p.status'])
    .where('v.id', 'in', ids)
    .execute();
  const map = new Map(rows.map((r) => [r.id, r]));
  for (const id of ids) if (!map.has(id)) throw invalid('Produto não encontrado.', { items: id });
  return map;
}

async function writeDraft(trx: Tx, actor: Actor, input: PurchaseInput, purchaseId?: string, origin: 'purchase' | 'trade' = 'purchase') {
  const supplier = await trx.selectFrom('parties').select(['id', 'is_supplier', 'status']).where('id', '=', input.supplierId).executeTakeFirst();
  if (!supplier || supplier.status !== 'active') throw invalid('Fornecedor inválido.', { supplierId: 'inválido' });
  if (!supplier.is_supplier) await trx.updateTable('parties').set({ is_supplier: true }).where('id', '=', supplier.id).execute();
  const variants = await loadVariants(trx, [...new Set(input.items.map((i) => i.variantId))]);
  for (const i of input.items) {
    const v = variants.get(i.variantId)!;
    if (v.kind === 'service') throw invalid(`"${v.name}" é serviço e não pode ser comprado para estoque.`);
    if (i.unitSpecs && i.unitSpecs.length > i.quantity) throw invalid('Mais unidades descritas que a quantidade.');
  }
  const totals = computePurchaseTotals(
    input.items.map((i) => ({ quantity: i.quantity, unitCostCents: i.unitCostCents, discountCents: i.discountCents })),
    input.discountCents,
    input.extraCostsCents,
  );
  const values = {
    supplier_id: input.supplierId,
    purchase_date: input.purchaseDate,
    items_cents: totals.itemsCents,
    discount_cents: totals.discountCents,
    extra_costs_cents: totals.extraCostsCents,
    total_cents: totals.totalCents,
    payment_terms: jsonb(input.paymentTerms),
    notes: input.notes ?? null,
  };
  let id = purchaseId;
  if (id) {
    await trx.updateTable('purchases').set({ ...values, version: sql`version + 1` }).where('id', '=', id).execute();
    await trx.deleteFrom('purchase_items').where('purchase_id', '=', id).execute();
  } else {
    const row = await trx
      .insertInto('purchases')
      .values({ tenant_id: actor.tenantId, ...values, origin, created_by: actor.userId })
      .returning('id')
      .executeTakeFirstOrThrow();
    id = row.id;
  }
  for (const [idx, i] of input.items.entries()) {
    const v = variants.get(i.variantId)!;
    const c = totals.lines[idx]!;
    await trx
      .insertInto('purchase_items')
      .values({
        tenant_id: actor.tenantId,
        purchase_id: id,
        position: idx,
        variant_id: i.variantId,
        description: `${v.name}${v.label ? ` ${v.label}` : ''}`,
        quantity: i.quantity,
        unit_cost_cents: i.unitCostCents,
        discount_cents: i.discountCents ?? 0n,
        discount_share_cents: c.discountShareCents,
        extra_share_cents: c.extraCostShareCents,
        landed_cost_cents: c.landedCostCents,
        unit_specs: JSON.stringify(i.unitSpecs ?? []),
      })
      .execute();
  }
  return { id: id!, totalCents: totals.totalCents };
}

export async function createPurchaseDraft(deps: AppDeps, actor: Actor, input: PurchaseInput) {
  requirePermission(actor, 'purchases.manage');
  requireWritable(actor);
  return tx(deps, actor, async (trx) => {
    const r = await writeDraft(trx, actor, input);
    await audit(trx, actor, 'purchase.draft_created', 'purchase', r.id, { total: r.totalCents });
    return r;
  });
}

export async function updatePurchaseDraft(deps: AppDeps, actor: Actor, id: string, input: PurchaseInput & { version?: number }) {
  requirePermission(actor, 'purchases.manage');
  requireWritable(actor);
  return tx(deps, actor, async (trx) => {
    const p = await trx.selectFrom('purchases').select(['status', 'version', 'origin']).where('id', '=', id).forUpdate().executeTakeFirst();
    if (!p) throw notFound('Compra');
    if (p.status !== 'draft') throw conflict('Somente rascunhos podem ser editados.');
    if (input.version !== undefined && input.version !== p.version) throw conflict('Compra alterada por outra pessoa. Recarregue.');
    return writeDraft(trx, actor, input, id);
  });
}

/** Aprovação: numera, cria contas a pagar conforme condição e registra pagamento imediato. */
async function approveInTx(trx: Tx, actor: Actor & FinCtx, id: string): Promise<{ number: bigint; titleIds: string[] }> {
  const p = await trx.selectFrom('purchases').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
  if (!p) throw notFound('Compra');
  if (p.status !== 'draft') throw conflict('Compra já aprovada ou cancelada.');
  await assertPeriodOpen(trx, p.purchase_date);
  const number = await nextNumber(trx, actor.tenantId, 'purchase');
  await trx.updateTable('purchases').set({ status: 'approved', number, approved_at: new Date() }).where('id', '=', id).execute();
  const terms = p.payment_terms as PaymentTerms;
  const base = {
    direction: 'payable' as const,
    partyId: p.supplier_id,
    originType: 'purchase' as const,
    originId: id,
    description: `Compra #${number}`,
    competenceDate: p.purchase_date,
  };
  let titleIds: string[] = [];
  if (p.total_cents > 0n) {
    if (terms.mode === 'installments') {
      titleIds = await createInstallmentTitles(trx, actor, base, { totalCents: p.total_cents, count: terms.count, firstDueDate: terms.firstDueDate, interval: terms.interval });
    } else {
      const due = terms.mode === 'due' ? terms.dueDate : p.purchase_date;
      titleIds = [await createTitle(trx, actor, { ...base, dueDate: due, amountCents: p.total_cents })];
      if (terms.mode === 'pay_now') {
        if (!can(actor, 'finance.settle_payable') && !can(actor, 'purchases.manage')) throw new AppError('forbidden', 'Sem permissão para registrar pagamento.');
        await recordSettlement(trx, actor, { direction: 'out', method: terms.method, accountId: terms.accountId, settledOn: p.purchase_date, allocations: [{ titleId: titleIds[0]!, amountCents: p.total_cents }] });
      }
    }
  }
  await audit(trx, actor, 'purchase.approved', 'purchase', id, { number, total: p.total_cents });
  return { number, titleIds };
}

export async function approvePurchase(deps: AppDeps, actor: Actor, id: string, idempotencyKey?: string) {
  requirePermission(actor, 'purchases.manage');
  requireWritable(actor);
  return tx(deps, actor, async (trx) => {
    const { result } = await idempotent(trx, actor.tenantId, 'purchase.approve', idempotencyKey, { id }, () => approveInTx(trx, actor, id));
    return result;
  });
}

export const zReceive = z.object({
  items: z
    .array(
      z.object({
        purchaseItemId: zUuid,
        quantity: zQty,
        destination: z.enum(['available', 'inspection']).default('available'),
        units: z.array(zUnitSpec).max(500).optional(),
      }),
    )
    .min(1),
  notes: zText(1000).optional().nullable(),
});

/**
 * Recebimento (parcial ou total): só a quantidade recebida entra no estoque,
 * ao custo de aquisição proporcional. Mesma chave → mesmo resultado, sem duplicar.
 */
async function receiveInTx(trx: Tx, actor: Actor, id: string, input: z.infer<typeof zReceive>, sourceKind: 'purchase_receipt' | 'trade_in' = 'purchase_receipt') {
  const p = await trx.selectFrom('purchases').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
  if (!p) throw notFound('Compra');
  if (!['approved', 'partially_received'].includes(p.status)) throw conflict('Compra precisa estar aprovada e com itens pendentes.');
  const loc = await defaultLocation(trx);
  const items = await trx.selectFrom('purchase_items').selectAll().where('purchase_id', '=', id).orderBy('variant_id').forUpdate().execute();
  const byId = new Map(items.map((i) => [i.id, i]));
  const variants = await loadVariants(trx, [...new Set(items.map((i) => i.variant_id))]);
  const receipt = await trx
    .insertInto('goods_receipts')
    .values({ tenant_id: actor.tenantId, purchase_id: id, notes: input.notes ?? null, created_by: actor.userId })
    .returning('id')
    .executeTakeFirstOrThrow();
  const seen = new Set<string>();
  const createdUnits: string[] = [];
  const createdLots: string[] = [];
  for (const r of [...input.items].sort((a, b) => (a.purchaseItemId < b.purchaseItemId ? -1 : 1))) {
    if (seen.has(r.purchaseItemId)) throw invalid('Item repetido no recebimento.');
    seen.add(r.purchaseItemId);
    const item = byId.get(r.purchaseItemId);
    if (!item) throw invalid('Item não pertence à compra.');
    const pending = item.quantity - item.received_qty;
    if (r.quantity > pending) throw invalid(`Quantidade recebida (${r.quantity}) maior que a pendente (${pending}) em "${item.description}".`);
    const cost = receivedCostShare(item.quantity, item.landed_cost_cents, item.received_qty, item.received_cost_cents, r.quantity);
    const v = variants.get(item.variant_id)!;
    if (v.tracking === 'serialized') {
      const specsFromDraft = (item.unit_specs as UnitSpec[]).slice(item.received_qty, item.received_qty + r.quantity);
      const specs: UnitSpec[] = r.units ?? specsFromDraft;
      const perUnit = allocateLargestRemainder(cost, Array.from({ length: r.quantity }, () => 1n));
      for (let k = 0; k < r.quantity; k++) {
        const unitId = await upsertUnitForEntry(trx, actor, item.variant_id, loc, specs[k] ?? {});
        const { lotId } = await stockIn(trx, actor, {
          variantId: item.variant_id, locationId: loc, quantity: 1, costCents: perUnit[k]!, bucket: r.destination,
          lotSource: sourceKind, kind: sourceKind, sourceType: 'goods_receipt', sourceId: receipt.id, unitId,
        });
        await trx.insertInto('goods_receipt_items').values({
          tenant_id: actor.tenantId, receipt_id: receipt.id, purchase_item_id: item.id, quantity: 1, cost_cents: perUnit[k]!, lot_id: lotId, unit_id: unitId, destination: r.destination,
        }).execute();
        createdUnits.push(unitId);
        createdLots.push(lotId);
      }
    } else {
      const { lotId } = await stockIn(trx, actor, {
        variantId: item.variant_id, locationId: loc, quantity: r.quantity, costCents: cost, bucket: r.destination,
        lotSource: sourceKind, kind: sourceKind, sourceType: 'goods_receipt', sourceId: receipt.id,
      });
      await trx.insertInto('goods_receipt_items').values({
        tenant_id: actor.tenantId, receipt_id: receipt.id, purchase_item_id: item.id, quantity: r.quantity, cost_cents: cost, lot_id: lotId, destination: r.destination,
      }).execute();
      createdLots.push(lotId);
    }
    await trx
      .updateTable('purchase_items')
      .set({ received_qty: item.received_qty + r.quantity, received_cost_cents: item.received_cost_cents + cost })
      .where('id', '=', item.id)
      .execute();
    item.received_qty += r.quantity;
  }
  const done = items.every((i) => i.received_qty === i.quantity);
  await trx.updateTable('purchases').set({ status: done ? 'received' : 'partially_received' }).where('id', '=', id).execute();
  await emit(trx, actor.tenantId, 'PurchaseReceived', { purchaseId: id, receiptId: receipt.id });
  await audit(trx, actor, 'purchase.received', 'purchase', id, { receiptId: receipt.id, complete: done });
  return { receiptId: receipt.id, status: done ? 'received' : 'partially_received', unitIds: createdUnits, lotIds: createdLots };
}

export async function receivePurchase(deps: AppDeps, actor: Actor, id: string, input: z.infer<typeof zReceive>, idempotencyKey?: string) {
  if (!can(actor, 'purchases.receive')) requirePermission(actor, 'purchases.manage');
  requireWritable(actor);
  return tx(deps, actor, async (trx) => {
    const { result } = await idempotent(trx, actor.tenantId, 'purchase.receive', idempotencyKey, { id, input }, () => receiveInTx(trx, actor, id, input));
    return result;
  });
}

/** Fluxo MVP: cria, aprova e recebe tudo numa transação. */
export async function quickPurchase(deps: AppDeps, actor: Actor, input: PurchaseInput & { destination?: 'available' | 'inspection' }, idempotencyKey?: string) {
  requirePermission(actor, 'purchases.manage');
  requireWritable(actor);
  return tx(deps, actor, async (trx) => {
    const { result } = await idempotent(trx, actor.tenantId, 'purchase.quick', idempotencyKey, input, async () => {
      const { id } = await writeDraft(trx, actor, input);
      const approved = await approveInTx(trx, actor, id);
      const items = await trx.selectFrom('purchase_items').select(['id', 'quantity']).where('purchase_id', '=', id).execute();
      const rec = await receiveInTx(trx, actor, id, { items: items.map((i) => ({ purchaseItemId: i.id, quantity: i.quantity, destination: input.destination ?? 'available' })) });
      await requestDocument(trx, actor, 'purchase_term', 'purchase', id);
      return { id, number: approved.number, ...rec };
    });
    return result;
  });
}

/** Cancelamento sem recebimento: rascunho sem efeitos; aprovada cancela saldo e gera reembolso do que foi pago. */
export async function cancelPurchase(deps: AppDeps, actor: Actor, id: string, reason: string) {
  requirePermission(actor, 'purchases.manage');
  requireWritable(actor);
  if (reason.trim().length < 3) throw invalid('Informe o motivo do cancelamento.');
  return tx(deps, actor, async (trx) => {
    const p = await trx.selectFrom('purchases').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
    if (!p) throw notFound('Compra');
    if (p.origin === 'trade') throw conflict('Compra de troca é revertida pela própria troca.');
    if (p.status === 'canceled') throw conflict('Compra já cancelada.');
    if (p.status === 'partially_received' || p.status === 'received')
      throw conflict('Compra com mercadoria recebida não pode ser cancelada diretamente. Registre devolução ao fornecedor.');
    let refundCents = 0n;
    if (p.status === 'approved') {
      const titles = await trx.selectFrom('financial_titles').select(['id', 'original_cents', 'balance_cents']).where('origin_type', '=', 'purchase').where('origin_id', '=', id).orderBy('id').execute();
      for (const t of titles) {
        refundCents += t.original_cents - t.balance_cents;
        await cancelTitleBalance(trx, actor, t.id, { type: 'purchase_cancel', id }, reason);
      }
      if (refundCents > 0n) {
        await createTitle(trx, actor, {
          direction: 'receivable', partyId: p.supplier_id, originType: 'refund', originId: id, description: `Reembolso da compra #${p.number} cancelada`,
          competenceDate: todayLocal(actor.timezone), dueDate: todayLocal(actor.timezone), amountCents: refundCents,
        });
      }
    }
    await trx.updateTable('purchases').set({ status: 'canceled', canceled_at: new Date(), cancel_reason: reason }).where('id', '=', id).execute();
    await audit(trx, actor, 'purchase.canceled', 'purchase', id, { reason, refundCents });
    return { refundCents };
  });
}

export const zAcquisitionCost = z.object({
  lotId: zUuid,
  description: zText(200).min(3),
  amountCents: zCentsPos,
  partyId: zUuid.optional().nullable(),
  occurredOn: zLocalDate.optional(),
  payNow: z.object({ accountId: zUuid, method: z.enum(['cash', 'pix', 'debit', 'credit', 'bank_transfer', 'boleto', 'other']) }).optional().nullable(),
});

/**
 * Custo realizado após a entrada (ex.: reparo antes da revenda). Parte do
 * estoque remanescente vai ao custo do lote; parte já vendida vai a CMV
 * (ajuste rastreável). Nunca vira despesa operacional.
 */
export async function addAcquisitionCost(deps: AppDeps, actor: Actor, input: z.infer<typeof zAcquisitionCost>, idempotencyKey?: string) {
  requirePermission(actor, 'purchases.manage');
  requireWritable(actor);
  return tx(deps, actor, async (trx) => {
    const { result } = await idempotent(trx, actor.tenantId, 'acquisition_cost', idempotencyKey, input, async () => {
      const date = input.occurredOn ?? todayLocal(actor.timezone);
      await assertPeriodOpen(trx, date);
      const lot = await trx.selectFrom('inventory_lots').selectAll().where('id', '=', input.lotId).forUpdate().executeTakeFirst();
      if (!lot) throw notFound('Lote');
      const toInventory = lot.qty_remaining === 0 ? 0n : (input.amountCents * BigInt(lot.qty_remaining)) / BigInt(lot.qty_received);
      const toCogs = input.amountCents - toInventory;
      if (toInventory > 0n) {
        await trx.updateTable('inventory_lots').set({ cost_remaining_cents: lot.cost_remaining_cents + toInventory }).where('id', '=', lot.id).execute();
      }
      const acId = randomUUID();
      const titleId = await createTitle(trx, actor, {
        direction: 'payable', partyId: input.partyId ?? null, originType: 'acquisition_cost', originId: acId, description: input.description,
        competenceDate: date, dueDate: date, amountCents: input.amountCents,
      });
      const ac = await trx
        .insertInto('acquisition_costs')
        .values({
          id: acId, tenant_id: actor.tenantId, lot_id: lot.id, description: input.description, amount_cents: input.amountCents, to_inventory_cents: toInventory,
          to_cogs_cents: toCogs, party_id: input.partyId ?? null, title_id: titleId, occurred_on: date, created_by: actor.userId,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      if (input.payNow) {
        await recordSettlement(trx, actor, { direction: 'out', method: input.payNow.method, accountId: input.payNow.accountId, settledOn: date, allocations: [{ titleId, amountCents: input.amountCents }] });
      }
      await audit(trx, actor, 'inventory.acquisition_cost', 'lot', lot.id, { amount: input.amountCents, toInventory, toCogs });
      return { id: ac.id, toInventoryCents: toInventory, toCogsCents: toCogs, titleId };
    });
    return result;
  });
}

export const zPurchaseList = zPageQuery.extend({
  status: z.enum(['draft', 'approved', 'partially_received', 'received', 'canceled', 'all']).default('all'),
  q: z.string().max(100).optional(),
});

export async function listPurchases(deps: AppDeps, actor: Actor, q: z.infer<typeof zPurchaseList>) {
  if (!can(actor, 'purchases.receive')) requirePermission(actor, 'purchases.manage');
  const offset = decodeCursor(q.cursor);
  const showCost = can(actor, 'costs.view') || can(actor, 'purchases.manage');
  return tx(deps, actor, async (trx) => {
    let query = trx
      .selectFrom('purchases as p')
      .innerJoin('parties as s', 's.id', 'p.supplier_id')
      .select([
        'p.id', 'p.number', 'p.status', 'p.origin', 'p.purchase_date', 's.name as supplier_name', 'p.created_at',
        ...(showCost ? (['p.total_cents'] as const) : []),
        sql<number>`(select coalesce(sum(quantity - received_qty), 0) from purchase_items i where i.purchase_id = p.id)::int`.as('pending_qty'),
      ]);
    if (q.status !== 'all') query = query.where('p.status', '=', q.status);
    if (q.q) query = query.where('s.name', 'ilike', `%${q.q.replace(/[%_]/g, '')}%`);
    const rows = await query.orderBy('p.created_at', 'desc').orderBy('p.id').limit(q.limit + 1).offset(offset).execute();
    return pageOf(rows, offset, q.limit);
  });
}

export async function getPurchase(deps: AppDeps, actor: Actor, id: string) {
  if (!can(actor, 'purchases.receive')) requirePermission(actor, 'purchases.manage');
  const showCost = can(actor, 'costs.view') || can(actor, 'purchases.manage');
  return tx(deps, actor, async (trx) => {
    const p = await trx
      .selectFrom('purchases as p')
      .innerJoin('parties as s', 's.id', 'p.supplier_id')
      .selectAll('p')
      .select(['s.name as supplier_name', 's.document as supplier_document'])
      .where('p.id', '=', id)
      .executeTakeFirst();
    if (!p) throw notFound('Compra');
    const items = await trx.selectFrom('purchase_items').selectAll().where('purchase_id', '=', id).orderBy('position').execute();
    const receipts = await trx
      .selectFrom('goods_receipts as r')
      .select(['r.id', 'r.received_at', 'r.notes', sql<number>`(select coalesce(sum(quantity),0) from goods_receipt_items gi where gi.receipt_id = r.id)::int`.as('quantity')])
      .where('r.purchase_id', '=', id)
      .orderBy('r.received_at')
      .execute();
    const titles = can(actor, 'finance.view') || can(actor, 'purchases.manage')
      ? await trx.selectFrom('financial_titles').select(['id', 'description', 'due_date', 'original_cents', 'balance_cents', 'status']).where('origin_type', '=', 'purchase').where('origin_id', '=', id).orderBy('due_date').execute()
      : [];
    const docs = await trx.selectFrom('documents').select(['id', 'doc_type', 'number', 'status']).where('source_id', '=', id).execute();
    const strip = <T extends Record<string, unknown>>(o: T) => {
      if (showCost) return o;
      const c = { ...o } as Record<string, unknown>;
      for (const k of Object.keys(c)) if (k.endsWith('_cents')) delete c[k];
      return c;
    };
    return { purchase: strip(p), items: items.map(strip), receipts, titles, documents: docs };
  });
}

export { receiveInTx, writeDraft, approveInTx };
