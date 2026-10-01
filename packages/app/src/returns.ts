import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { nextNumber, type Tx } from '@gct/db';
import { proportionalShare } from '@gct/domain';
import { conflict, invalid, minCents, notFound } from '@gct/shared';
import { audit, emit, idempotent, requirePermission, requireWritable, todayLocal, tx, type Actor, type AppDeps } from './core';
import { adjustTitle, assertPeriodOpen, createTitle, issueStoreCredit, recordSettlement } from './finance';
import { defaultLocation, stockIn } from './inventory';
import { requestDocument } from './documents';
import { zLocalDate, zQty, zText, zUuid } from './validation';

export const zRefund = z.discriminatedUnion('mode', [
  /** conta a pagar ao cliente; opcionalmente paga agora */
  z.object({ mode: z.literal('refund'), payNow: z.object({ accountId: zUuid, method: z.enum(['cash', 'pix', 'debit', 'credit', 'bank_transfer', 'other']) }).optional().nullable(), dueDate: zLocalDate.optional() }),
  z.object({ mode: z.literal('store_credit') }),
]);

export const zReturn = z.object({
  items: z.array(z.object({ saleItemId: zUuid, quantity: zQty })).min(1).max(200),
  reason: zText(500).min(3, 'Informe o motivo'),
  refund: zRefund.optional(),
});
export type ReturnInput = z.infer<typeof zReturn>;

export interface ReturnResult {
  returnId: string;
  number: string;
  revenueCents: bigint;
  costCents: bigint;
  reducedBalanceCents: bigint;
  refundCents: bigint;
  storeCreditCents: bigint;
  refundTitleId: string | null;
}

/**
 * Devolução total/parcial pela base histórica: receita e custo proporcionais
 * da venda original (nunca preço/custo atual). Estoque volta ao custo de
 * origem em inspeção. Primeiro reduz saldo em aberto; o que já foi pago ou
 * compensado vira reembolso rastreável ou crédito de loja (escolha explícita).
 */
export async function returnInTx(
  trx: Tx,
  actor: Actor,
  saleId: string,
  input: ReturnInput,
  opts: { kind?: 'return' | 'cancellation'; refundOverride?: 'reversal'; restock?: boolean } = {},
): Promise<ReturnResult> {
  const sale = await trx.selectFrom('sales').selectAll().where('id', '=', saleId).forUpdate().executeTakeFirst();
  if (!sale) throw notFound('Venda');
  if (!['confirmed', 'partially_returned'].includes(sale.status)) throw conflict('Venda não está em situação que permita devolução.');
  const today = todayLocal(actor.timezone);
  await assertPeriodOpen(trx, today);
  const loc = await defaultLocation(trx);
  const number = await nextNumber(trx, actor.tenantId, 'return');
  // Registro de devolução é imutável: calcula tudo e insere uma única vez ao final.
  const ret = { id: randomUUID() };
  const itemRows: { sale_item_id: string; quantity: number; revenue_cents: bigint; cost_cents: bigint; unit_id: string | null; lot_id: string | null }[] = [];

  let revenue = 0n;
  let cost = 0n;
  const merged = new Map<string, number>();
  for (const i of input.items) merged.set(i.saleItemId, (merged.get(i.saleItemId) ?? 0) + i.quantity);
  for (const [saleItemId, qty] of [...merged.entries()].sort()) {
    const si = await trx.selectFrom('sale_items').selectAll().where('id', '=', saleItemId).where('sale_id', '=', saleId).forUpdate().executeTakeFirst();
    if (!si) throw invalid('Item não pertence à venda.');
    const returnable = si.quantity - si.returned_qty;
    if (qty > returnable) throw invalid(`Quantidade maior que a devolvível (${returnable}) em "${si.description}".`);
    const itemRevenue = proportionalShare(si.quantity, si.total_cents, si.returned_qty, si.returned_revenue_cents, qty);
    let itemCost = 0n;
    let revenueRows = 0;
    if (si.product_kind === 'physical') {
      // Devolve das alocações mais recentes (LIFO sobre o consumo), custo proporcional por alocação.
      const allocs = await trx.selectFrom('sale_cost_allocations').selectAll().where('sale_item_id', '=', si.id).orderBy('seq', 'desc').forUpdate().execute();
      let need = qty;
      for (const a of allocs) {
        if (need === 0) break;
        const avail = a.quantity - a.returned_qty;
        if (avail <= 0) continue;
        const take = Math.min(need, avail);
        const c = proportionalShare(a.quantity, a.cost_cents, a.returned_qty, a.returned_cost_cents, take);
        await trx.updateTable('sale_cost_allocations').set({ returned_qty: a.returned_qty + take, returned_cost_cents: a.returned_cost_cents + c }).where('id', '=', a.id).execute();
        const { lotId } = await stockIn(trx, actor, {
          variantId: si.variant_id, locationId: loc, quantity: take, costCents: c, bucket: opts.restock ? 'available' : 'inspection', lotSource: 'sale_return',
          kind: 'sale_return', sourceType: 'return', sourceId: ret.id, unitId: a.unit_id, reason: input.reason,
        });
        itemRows.push({ sale_item_id: si.id, quantity: take, revenue_cents: revenueRows === 0 ? itemRevenue : 0n, cost_cents: c, unit_id: a.unit_id, lot_id: lotId });
        revenueRows++;
        itemCost += c;
        need -= take;
      }
      if (need > 0) throw conflict('Alocações de custo insuficientes para a devolução.');
    }
    if (si.product_kind !== 'physical') {
      itemRows.push({ sale_item_id: si.id, quantity: qty, revenue_cents: itemRevenue, cost_cents: 0n, unit_id: null, lot_id: null });
    }
    await trx
      .updateTable('sale_items')
      .set({ returned_qty: si.returned_qty + qty, returned_revenue_cents: si.returned_revenue_cents + itemRevenue, returned_cost_cents: si.returned_cost_cents + itemCost })
      .where('id', '=', si.id)
      .execute();
    revenue += itemRevenue;
    cost += itemCost;
  }

  // Financeiro: reduz saldos abertos da venda; restante foi pago/compensado → reembolso ou crédito.
  let reduced = 0n;
  const titles = await trx
    .selectFrom('financial_titles')
    .select(['id', 'balance_cents'])
    .where('origin_type', '=', 'sale')
    .where('origin_id', '=', saleId)
    .where('direction', '=', 'receivable')
    .where('balance_cents', '>', 0n)
    .orderBy('due_date', 'desc')
    .orderBy('id')
    .execute();
  for (const t of titles) {
    if (reduced === revenue) break;
    const amt = minCents(t.balance_cents, revenue - reduced);
    await adjustTitle(trx, actor, t.id, amt, 'return_reduction', { type: 'return', id: ret.id }, input.reason);
    reduced += amt;
  }
  const remaining = revenue - reduced;
  let refund = 0n;
  let credit = 0n;
  let refundTitleId: string | null = null;
  if (remaining > 0n) {
    if (opts.refundOverride === 'reversal') {
      refund = remaining;
      refundTitleId = await createTitle(trx, actor, {
        direction: 'payable', partyId: sale.customer_id, originType: 'refund', originId: ret.id, description: `Reembolso da venda #${sale.number}`,
        competenceDate: today, dueDate: today, amountCents: remaining,
      });
    } else if (!input.refund) {
      throw invalid('Valor já pago/compensado: escolha reembolso ou crédito da loja.', { refund: 'obrigatório' });
    } else if (input.refund.mode === 'store_credit') {
      if (!sale.customer_id) throw invalid('Crédito da loja exige cliente identificado na venda.');
      credit = remaining;
      await issueStoreCredit(trx, actor, { partyId: sale.customer_id, amountCents: remaining, originType: 'return', originId: ret.id, reason: input.reason });
    } else {
      refund = remaining;
      refundTitleId = await createTitle(trx, actor, {
        direction: 'payable', partyId: sale.customer_id, originType: 'refund', originId: ret.id, description: `Reembolso da venda #${sale.number}`,
        competenceDate: today, dueDate: input.refund.dueDate ?? today, amountCents: remaining,
      });
      if (input.refund.payNow) {
        await recordSettlement(trx, actor, { direction: 'out', method: input.refund.payNow.method, accountId: input.refund.payNow.accountId, settledOn: today, allocations: [{ titleId: refundTitleId, amountCents: remaining }] });
      }
    }
  }
  await trx
    .insertInto('returns')
    .values({
      id: ret.id, tenant_id: actor.tenantId, number, sale_id: saleId, kind: opts.kind ?? 'return', reason: input.reason, revenue_cents: revenue, cost_cents: cost,
      reduced_balance_cents: reduced, refund_cents: refund, store_credit_cents: credit, refund_title_id: refundTitleId, created_by: actor.userId,
    })
    .execute();
  for (const row of itemRows) await trx.insertInto('return_items').values({ tenant_id: actor.tenantId, return_id: ret.id, ...row }).execute();
  const items = await trx.selectFrom('sale_items').select(['quantity', 'returned_qty']).where('sale_id', '=', saleId).execute();
  const fully = items.every((i) => i.returned_qty === i.quantity);
  await trx
    .updateTable('sales')
    .set({
      status: fully ? 'returned' : 'partially_returned',
      returned_revenue_cents: sale.returned_revenue_cents + revenue,
      returned_cost_cents: sale.returned_cost_cents + cost,
    })
    .where('id', '=', saleId)
    .execute();
  await audit(trx, actor, opts.kind === 'cancellation' ? 'sale.canceled' : 'sale.returned', 'sale', saleId, { returnId: ret.id, revenue, cost, reduced, refund, credit, reason: input.reason });
  await emit(trx, actor.tenantId, 'SaleReturned', { saleId, returnId: ret.id });
  await requestDocument(trx, actor, 'return_receipt', 'return', ret.id);
  return { returnId: ret.id, number: number.toString(), revenueCents: revenue, costCents: cost, reducedBalanceCents: reduced, refundCents: refund, storeCreditCents: credit, refundTitleId };
}

export async function returnSale(deps: AppDeps, actor: Actor, saleId: string, input: ReturnInput, idempotencyKey?: string) {
  requirePermission(actor, 'reversals.execute');
  requireWritable(actor);
  return tx(deps, actor, async (trx) => {
    const sale = await trx.selectFrom('sales').select(['origin', 'trade_id']).where('id', '=', saleId).executeTakeFirst();
    if (!sale) throw notFound('Venda');
    const { result } = await idempotent(trx, actor.tenantId, 'sale.return', idempotencyKey, { saleId, input }, () => returnInTx(trx, actor, saleId, input));
    return result;
  });
}

/** Cancelamento de venda confirmada = devolução de todos os itens remanescentes. Original intacto. */
/** `restock`: os itens não chegaram a sair (venda lançada por engano) e voltam direto ao estoque, sem inspeção. */
export async function cancelSale(deps: AppDeps, actor: Actor, saleId: string, input: { reason: string; refund?: z.infer<typeof zRefund>; restock?: boolean }, idempotencyKey?: string) {
  requirePermission(actor, 'reversals.execute');
  requireWritable(actor);
  return tx(deps, actor, async (trx) => {
    const { result } = await idempotent(trx, actor.tenantId, 'sale.cancel', idempotencyKey, { saleId, input }, async () => {
      const sale = await trx.selectFrom('sales').select(['trade_id']).where('id', '=', saleId).executeTakeFirst();
      if (!sale) throw notFound('Venda');
      if (sale.trade_id) throw conflict('Venda de troca é cancelada pela reversão da troca.');
      const items = await trx.selectFrom('sale_items').select(['id', 'quantity', 'returned_qty']).where('sale_id', '=', saleId).execute();
      const pending = items.filter((i) => i.quantity > i.returned_qty).map((i) => ({ saleItemId: i.id, quantity: i.quantity - i.returned_qty }));
      if (pending.length === 0) throw conflict('Venda já totalmente devolvida.');
      return returnInTx(trx, actor, saleId, { items: pending, reason: input.reason, refund: input.refund }, { kind: 'cancellation', restock: input.restock === true });
    });
    return result;
  });
}


/**
 * "Excluir venda" (venda de teste ou lançada por engano): cancela com estorno vinculado
 * (valor devolvido na mesma conta em que entrou, itens de volta ao estoque) e marca a venda
 * como excluída. Nada é apagado: some das listas, do Início e do fluxo de caixa, e fica
 * consultável na aba Excluídas.
 */
export async function deleteSale(deps: AppDeps, actor: Actor, saleId: string, reason: string, idempotencyKey?: string) {
  requirePermission(actor, 'reversals.execute');
  requireWritable(actor);
  if (reason.trim().length < 3) throw invalid('Informe o motivo da exclusão.', { reason: 'obrigatório' });
  return tx(deps, actor, async (trx) => {
    const { result } = await idempotent(trx, actor.tenantId, 'sale.delete', idempotencyKey, { saleId, reason }, async () => {
      const sale = await trx.selectFrom('sales').select(['id', 'status', 'trade_id', 'deleted_at', 'number', 'sale_date']).where('id', '=', saleId).forUpdate().executeTakeFirst();
      if (!sale) throw notFound('Venda');
      // A venda sai também dos totais do mês dela: mês fechado não pode mudar.
      await assertPeriodOpen(trx, sale.sale_date);
      if (sale.deleted_at) throw conflict('Venda já excluída.');
      if (sale.trade_id) throw conflict('Venda de troca: desfaça pela própria troca.');
      if (sale.status === 'draft') throw conflict('Orçamento se exclui pela lista de orçamentos.');
      if (['confirmed', 'partially_returned'].includes(sale.status)) {
        // Devolve na conta e no meio em que o dinheiro entrou; sem recebimento, na primeira conta ativa.
        const paid = await trx
          .selectFrom('settlements as s')
          .innerJoin('settlement_allocations as sa', 'sa.settlement_id', 's.id')
          .innerJoin('financial_titles as t', 't.id', 'sa.title_id')
          .innerJoin('financial_accounts as a', 'a.id', 's.account_id')
          .select(['s.account_id', 's.method'])
          .where('t.origin_type', '=', 'sale').where('t.origin_id', '=', saleId).where('s.direction', '=', 'in').where('a.status', '=', 'active')
          .orderBy('s.created_at')
          .executeTakeFirst();
        const account = paid?.account_id ?? (await trx.selectFrom('financial_accounts').select('id').where('status', '=', 'active').orderBy('created_at').executeTakeFirst())?.id;
        if (!account) throw conflict('Nenhuma conta ativa para devolver o valor.');
        const method = (['cash', 'pix', 'debit', 'credit', 'bank_transfer', 'other'] as const).find((m) => m === paid?.method) ?? 'other';
        const items = await trx.selectFrom('sale_items').select(['id', 'quantity', 'returned_qty']).where('sale_id', '=', saleId).execute();
        const pending = items.filter((i) => i.quantity > i.returned_qty).map((i) => ({ saleItemId: i.id, quantity: i.quantity - i.returned_qty }));
        await returnInTx(trx, actor, saleId, { items: pending, reason: `Venda excluída: ${reason.trim()}`, refund: { mode: 'refund', payNow: { accountId: account, method } } }, { kind: 'cancellation', restock: true });
      }
      await trx.updateTable('sales').set({ deleted_at: new Date(), deleted_by: actor.userId, deleted_reason: reason.trim() }).where('id', '=', saleId).execute();
      await audit(trx, actor, 'sale.deleted', 'sale', saleId, { reason: reason.trim(), number: sale.number?.toString() ?? null });
      return { id: saleId };
    });
    return result;
  });
}
