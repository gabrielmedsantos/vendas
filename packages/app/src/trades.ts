import { z } from 'zod';
import { jsonb, nextNumber, sql, type Tx } from '@gct/db';
import { assertDifferencePolicy, computeSaleTotals, computeTrade, describeTradeDirection, type TradeComputation } from '@gct/domain';
import { conflict, invalid, notFound, sumCents } from '@gct/shared';
import { audit, can, emit, idempotent, requirePermission, requireWritable, todayLocal, tx, type Actor, type AppDeps } from './core';
import { applyOffset, cancelTitleBalance, createTitle, issueStoreCredit, recordSettlement, reverseOffset, revokeStoreCredit } from './finance';
import { stockOutWholeLot, zUnitSpec } from './inventory';
import { receiveInTx, writeDraft } from './purchases';
import { confirmSaleInTx, zSaleItem, zSalePayment } from './sales';
import { returnInTx } from './returns';
import { requestDocument } from './documents';
import { decodeCursor, pageOf, zCentsNonNeg, zPageQuery, zQty, zText, zUuid } from './validation';

const zIncoming = z.object({
  /** variante existente ou produto novo criado junto com a troca */
  variantId: zUuid.optional(),
  newProduct: z
    .object({
      name: zText(160).min(2),
      categoryId: zUuid.optional().nullable(),
      brand: zText(80).optional().nullable(),
      tracking: z.enum(['serialized', 'quantity']).default('serialized'),
    })
    .optional(),
  quantity: zQty.default(1),
  /** valor acordado de aquisição (compõe P) */
  agreedCents: zCentsNonNeg,
  /** custo adicional previsto (simulação apenas; não é custo realizado) */
  estimatedExtraCostCents: zCentsNonNeg.default(0n),
  suggestedPriceCents: zCentsNonNeg.optional().nullable(),
  destination: z.enum(['inspection', 'available']).default('inspection'),
  unit: zUnitSpec.optional(),
  notes: zText(1000).optional().nullable(),
});

export const zTrade = z.object({
  partyId: zUuid,
  channelId: zUuid.optional().nullable(),
  outgoing: z.array(zSaleItem).min(1).max(50),
  discountCents: zCentsNonNeg.default(0n),
  incoming: z.array(zIncoming).min(1).max(50),
  differencePolicy: z.enum(['receive', 'pay', 'store_credit', 'none']),
  /** D > 0: como o cliente paga a diferença (soma exata de D) */
  differencePayments: z.array(zSalePayment).max(10).default([]),
  /** D < 0 e política "pay": pagar agora (senão fica conta a pagar) */
  payNow: z.object({ accountId: zUuid, method: z.enum(['cash', 'pix', 'debit', 'credit', 'bank_transfer', 'other']) }).optional().nullable(),
  notes: zText(2000).optional().nullable(),
});
export type TradeInput = z.infer<typeof zTrade>;

export interface TradeSimulation {
  computation: TradeComputation;
  explanation: string;
  saleSubtotalCents: bigint;
  saleDiscountCents: bigint;
  estimatedExtraCostsCents: bigint;
  /** efeito projetado; só aparece a quem pode ver custo */
  projected?: { outgoingCostCents: bigint; grossProfitCents: bigint };
  cashEffect: { inCents: bigint; outCents: bigint; storeCreditCents: bigint; openReceivableCents: bigint; openPayableCents: bigint };
}

/** Simulação no servidor (mesmas regras da confirmação), sem efeitos. */
export async function simulateTrade(deps: AppDeps, actor: Actor, input: TradeInput): Promise<TradeSimulation> {
  requirePermission(actor, 'sales.create');
  return tx(deps, actor, async (trx) => {
    const sale = computeSaleTotals(
      input.outgoing.map((o) => ({ quantity: o.quantity, unitPriceCents: o.unitPriceCents, discountCents: o.discountCents })),
      input.discountCents,
      0n,
    );
    const valuations = input.incoming.map((i) => i.agreedCents);
    const t = computeTrade(sale.totalCents, valuations);
    let projected: TradeSimulation['projected'];
    if (can(actor, 'costs.view')) {
      let cost = 0n;
      for (const o of input.outgoing) {
        if (o.unitId) {
          const r = await sql<{ c: bigint | null }>`select l.cost_remaining_cents as c from inventory_units u join inventory_lots l on l.id = u.current_lot_id where u.id = ${o.unitId}`.execute(trx);
          cost += r.rows[0]?.c ?? 0n;
        } else {
          const r = await sql<{ c: bigint | null }>`
            select case when sum(qty_remaining) > 0 then sum(cost_remaining_cents) * ${o.quantity} / sum(qty_remaining) end as c
            from inventory_lots where variant_id = ${o.variantId} and status = 'available' and qty_remaining > 0 and unit_id is null`.execute(trx);
          cost += r.rows[0]?.c ?? 0n;
        }
      }
      projected = { outgoingCostCents: cost, grossProfitCents: sale.totalCents - cost };
    }
    const paid = (kinds: string[]) => sumCents(input.differencePayments.filter((p) => kinds.includes(p.kind) && p.settleNow !== false).map((p) => p.amountCents));
    const cashIn = t.direction === 'customer_pays' ? paid(['cash', 'pix', 'bank_transfer']) : 0n;
    return {
      computation: t,
      explanation: describeTradeDirection(t),
      saleSubtotalCents: sale.subtotalCents,
      saleDiscountCents: sale.discountCents,
      estimatedExtraCostsCents: sumCents(input.incoming.map((i) => i.estimatedExtraCostCents)),
      projected,
      cashEffect: {
        inCents: cashIn,
        outCents: t.direction === 'company_pays' && input.differencePolicy === 'pay' && input.payNow ? t.differenceAbsCents : 0n,
        storeCreditCents: t.direction === 'company_pays' && input.differencePolicy === 'store_credit' ? t.differenceAbsCents : 0n,
        openReceivableCents: t.direction === 'customer_pays' ? t.differenceAbsCents - cashIn : 0n,
        openPayableCents: t.direction === 'company_pays' && input.differencePolicy === 'pay' && !input.payNow ? t.differenceAbsCents : 0n,
      },
    };
  });
}

async function ensureIncomingVariant(trx: Tx, actor: Actor, inc: z.infer<typeof zIncoming>): Promise<{ variantId: string; tracking: string }> {
  if (inc.variantId) {
    const v = await trx
      .selectFrom('product_variants as v')
      .innerJoin('products as p', 'p.id', 'v.product_id')
      .select(['v.id', 'p.tracking', 'p.kind', 'p.status'])
      .where('v.id', '=', inc.variantId)
      .executeTakeFirst();
    if (!v || v.kind !== 'physical' || v.status === 'archived') throw invalid('Produto recebido inválido.');
    return { variantId: v.id, tracking: v.tracking };
  }
  if (!inc.newProduct) throw invalid('Informe o produto recebido (existente ou novo).');
  const n = await nextNumber(trx, actor.tenantId, 'trade_sku');
  const p = await trx
    .insertInto('products')
    .values({
      tenant_id: actor.tenantId, kind: 'physical', tracking: inc.newProduct.tracking, name: inc.newProduct.name, brand: inc.newProduct.brand ?? null,
      category_id: inc.newProduct.categoryId ?? null, condition_default: 'used', search_text: inc.newProduct.name.toLowerCase(), created_by: actor.userId,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  const v = await trx
    .insertInto('product_variants')
    .values({ tenant_id: actor.tenantId, product_id: p.id, sku: `TR-${n.toString().padStart(6, '0')}`, retail_price_cents: inc.suggestedPriceCents ?? 0n, suggested_price_cents: inc.suggestedPriceCents ?? null })
    .returning('id')
    .executeTakeFirstOrThrow();
  return { variantId: v.id, tracking: inc.newProduct.tracking };
}

/**
 * Confirmação atômica da troca:
 * venda (S) + compra vinculada (P) + compensação min(S,P) sem dinheiro;
 * somente a diferença pode gerar caixa, título ou crédito de loja.
 */
export async function confirmTradeInTx(trx: Tx, actor: Actor, input: TradeInput) {
  const party = await trx.selectFrom('parties').select(['id', 'status', 'is_customer', 'is_supplier']).where('id', '=', input.partyId).executeTakeFirst();
  if (!party || party.status !== 'active') throw invalid('Cliente inválido.', { partyId: 'inválido' });
  await trx.updateTable('parties').set({ is_customer: true, is_supplier: true }).where('id', '=', party.id).execute();

  const saleTotals = computeSaleTotals(
    input.outgoing.map((o) => ({ quantity: o.quantity, unitPriceCents: o.unitPriceCents, discountCents: o.discountCents })),
    input.discountCents,
    0n,
  );
  for (const i of input.incoming) if (i.unit && i.quantity !== 1) throw invalid('Item com identificação individual deve ter quantidade 1.');
  const t = computeTrade(saleTotals.totalCents, input.incoming.map((i) => i.agreedCents));
  assertDifferencePolicy(t, input.differencePolicy);
  if (t.direction === 'customer_pays') {
    const paid = sumCents(input.differencePayments.map((p) => p.amountCents));
    if (paid !== t.differenceAbsCents) throw invalid(`Pagamentos da diferença devem somar exatamente ${t.differenceAbsCents} centavos.`, { differencePayments: 'soma incorreta' });
  } else if (input.differencePayments.length > 0) {
    throw invalid('Não há diferença a receber do cliente nesta troca.');
  }
  if (input.differencePolicy !== 'pay' && input.payNow) throw invalid('Pagamento ao cliente só se aplica à política "pagar".');

  const today = todayLocal(actor.timezone);
  const tradeNumber = await nextNumber(trx, actor.tenantId, 'trade');

  // 1) Venda dos itens entregues (baixa de estoque e custo histórico).
  const payments = [
    ...(t.offsetCents > 0n ? [{ kind: 'trade_offset' as const, amountCents: t.offsetCents }] : []),
    ...input.differencePayments,
  ];
  const sale = await confirmSaleInTx(
    trx,
    actor,
    { customerId: input.partyId, channelId: input.channelId, saleDate: today, items: input.outgoing, discountCents: input.discountCents, shippingCents: 0n, payments, notes: input.notes },
    { origin: 'trade' },
  );

  // 2) Compra vinculada dos itens recebidos (cada avaliação com custo próprio).
  const incomingVariants: { variantId: string; tracking: string }[] = [];
  for (const inc of input.incoming) incomingVariants.push(await ensureIncomingVariant(trx, actor, inc));
  const purchase = await writeDraft(
    trx,
    actor,
    {
      supplierId: input.partyId,
      purchaseDate: today,
      items: input.incoming.map((inc, i) => {
        if (inc.agreedCents % BigInt(inc.quantity) !== 0n) throw invalid('Avaliação por quantidade deve dividir em centavos inteiros por unidade.');
        return {
          variantId: incomingVariants[i]!.variantId,
          quantity: inc.quantity,
          unitCostCents: inc.agreedCents / BigInt(inc.quantity),
          unitSpecs: inc.unit ? [inc.unit] : undefined,
        };
      }),
      discountCents: 0n,
      extraCostsCents: 0n,
      paymentTerms: { mode: 'due', dueDate: today },
      notes: `Troca #${tradeNumber}`,
    },
    undefined,
    'trade',
  );
  const purchaseNumber = await nextNumber(trx, actor.tenantId, 'purchase');
  await trx.updateTable('purchases').set({ status: 'approved', number: purchaseNumber, approved_at: new Date() }).where('id', '=', purchase.id).execute();
  const pItems = await trx.selectFrom('purchase_items').select(['id', 'position', 'quantity']).where('purchase_id', '=', purchase.id).orderBy('position').execute();
  const receipt = await receiveInTx(
    trx,
    actor,
    purchase.id,
    {
      items: pItems.map((pi) => ({
        purchaseItemId: pi.id,
        quantity: pi.quantity,
        destination: input.incoming[pi.position]!.destination,
        units: input.incoming[pi.position]!.unit ? [input.incoming[pi.position]!.unit!] : undefined,
      })),
    },
    'trade_in',
  );

  // 3) Títulos da compra: parcela compensada + diferença devida pela empresa.
  const payBase = { direction: 'payable' as const, partyId: input.partyId, originType: 'purchase' as const, originId: purchase.id, competenceDate: today, dueDate: today };
  let offsetId: string | null = null;
  if (t.offsetCents > 0n) {
    const payableOffset = await createTitle(trx, actor, { ...payBase, description: `Compra #${purchaseNumber} · compensação de troca`, amountCents: t.offsetCents });
    offsetId = await applyOffset(trx, actor, {
      partyId: input.partyId, receivableTitleId: sale.offsetTitleId!, payableTitleId: payableOffset, amountCents: t.offsetCents, originType: 'trade', originId: purchase.id,
    });
  }
  let differenceTitleId: string | null = null;
  if (t.direction === 'company_pays') {
    if (input.differencePolicy === 'store_credit') {
      await issueStoreCredit(trx, actor, { partyId: input.partyId, amountCents: t.differenceAbsCents, originType: 'trade', originId: purchase.id, reason: `Diferença da troca #${tradeNumber}` });
    } else {
      differenceTitleId = await createTitle(trx, actor, { ...payBase, description: `Troca #${tradeNumber} · diferença a pagar ao cliente`, amountCents: t.differenceAbsCents });
      if (input.payNow) {
        await recordSettlement(trx, actor, { direction: 'out', method: input.payNow.method, accountId: input.payNow.accountId, settledOn: today, allocations: [{ titleId: differenceTitleId, amountCents: t.differenceAbsCents }] });
      }
    }
  }
  await trx.updateTable('purchases').set({ status: 'received' }).where('id', '=', purchase.id).execute();

  // 4) Registro da troca e avaliações (snapshot).
  const trade = await trx
    .insertInto('trades')
    .values({
      tenant_id: actor.tenantId, number: tradeNumber, party_id: input.partyId, sale_id: sale.saleId, purchase_id: purchase.id,
      sale_total_cents: t.saleTotalCents, purchase_total_cents: t.purchaseTotalCents, offset_cents: t.offsetCents, difference_cents: t.differenceCents,
      difference_policy: input.differencePolicy, offset_id: offsetId, notes: input.notes ?? null, created_by: actor.userId,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  let unitIdx = 0;
  for (const [i, inc] of input.incoming.entries()) {
    const pi = pItems[i]!;
    const unitId = incomingVariants[i]!.tracking === 'serialized' ? receipt.unitIds[unitIdx++] ?? null : null;
    await trx
      .insertInto('trade_valuations')
      .values({
        tenant_id: actor.tenantId, trade_id: trade.id, position: i, variant_id: incomingVariants[i]!.variantId, purchase_item_id: pi.id, unit_id: unitId,
        agreed_cents: inc.agreedCents, estimated_extra_cost_cents: inc.estimatedExtraCostCents, suggested_price_cents: inc.suggestedPriceCents ?? null,
        condition: inc.unit?.condition ?? null, identifiers: jsonb(inc.unit?.identifiers ?? []), checklist: jsonb(inc.unit?.checklist ?? {}),
        destination: inc.destination, notes: inc.notes ?? null,
      })
      .execute();
  }
  await trx.updateTable('sales').set({ trade_id: trade.id }).where('id', '=', sale.saleId).execute();
  await trx.updateTable('purchases').set({ trade_id: trade.id }).where('id', '=', purchase.id).execute();
  await audit(trx, actor, 'trade.confirmed', 'trade', trade.id, {
    number: tradeNumber, S: t.saleTotalCents, P: t.purchaseTotalCents, offset: t.offsetCents, D: t.differenceCents, policy: input.differencePolicy,
  });
  await emit(trx, actor.tenantId, 'TradeConfirmed', { tradeId: trade.id });
  await requestDocument(trx, actor, 'trade_summary', 'trade', trade.id);
  await requestDocument(trx, actor, 'purchase_term', 'purchase', purchase.id);
  return {
    tradeId: trade.id,
    number: tradeNumber.toString(),
    saleId: sale.saleId,
    purchaseId: purchase.id,
    saleTotalCents: t.saleTotalCents,
    purchaseTotalCents: t.purchaseTotalCents,
    offsetCents: t.offsetCents,
    differenceCents: t.differenceCents,
    direction: t.direction,
    differenceTitleId,
    receivedUnitIds: receipt.unitIds,
    receivedLotIds: receipt.lotIds,
  };
}

export async function confirmTrade(deps: AppDeps, actor: Actor, input: TradeInput, idempotencyKey?: string) {
  requirePermission(actor, 'trades.confirm');
  requireWritable(actor);
  return tx(deps, actor, async (trx) => {
    const { result } = await idempotent(trx, actor.tenantId, 'trade.confirm', idempotencyKey, input, () => confirmTradeInTx(trx, actor, input));
    return result;
  });
}

/**
 * Reversão sem dependências: desfaz venda (devolução integral ao custo histórico),
 * compra (retirada dos itens recebidos), compensação e crédito. Dinheiro que já
 * transitou vira título de reembolso separado. Se item recebido já foi vendido
 * ou consumido, bloqueia: exige resolução assistida.
 */
export async function reverseTrade(deps: AppDeps, actor: Actor, tradeId: string, reason: string, idempotencyKey?: string) {
  requirePermission(actor, 'reversals.execute');
  requireWritable(actor);
  if (reason.trim().length < 3) throw invalid('Informe o motivo da reversão.');
  return tx(deps, actor, async (trx) => {
    const { result } = await idempotent(trx, actor.tenantId, 'trade.reverse', idempotencyKey, { tradeId, reason }, async () => {
      const trade = await trx.selectFrom('trades').selectAll().where('id', '=', tradeId).forUpdate().executeTakeFirst();
      if (!trade) throw notFound('Troca');
      if (trade.status !== 'confirmed') throw conflict('Troca já revertida.');
      const today = todayLocal(actor.timezone);

      // Dependências: itens recebidos intactos, sem custos adicionais lançados.
      const lots = await trx
        .selectFrom('goods_receipt_items as gi')
        .innerJoin('goods_receipts as gr', 'gr.id', 'gi.receipt_id')
        .select(['gi.lot_id'])
        .where('gr.purchase_id', '=', trade.purchase_id)
        .orderBy('gi.lot_id')
        .execute();
      const lotIds = lots.map((l) => l.lot_id!).filter(Boolean);
      const consumed = await trx
        .selectFrom('inventory_lots')
        .select('id')
        .where('id', 'in', lotIds)
        .where((eb) => eb('qty_remaining', '<>', eb.ref('qty_received')))
        .executeTakeFirst();
      const extra = lotIds.length ? await trx.selectFrom('acquisition_costs').select('id').where('lot_id', 'in', lotIds).executeTakeFirst() : undefined;
      if (consumed || extra)
        throw conflict('Item recebido na troca já foi revendido, consumido ou recebeu custo adicional. Estorno simples bloqueado: abra resolução assistida com documentos compensatórios e aprovação do gestor.');
      const sale = await trx.selectFrom('sales').select(['status']).where('id', '=', trade.sale_id).executeTakeFirstOrThrow();
      if (sale.status !== 'confirmed') throw conflict('Venda da troca já teve devolução; reversão simples bloqueada.');

      // 1) Desfaz compensação (restaura saldos dos dois títulos).
      if (trade.offset_id) await reverseOffset(trx, actor, trade.offset_id);

      // 2) Venda: devolução integral; reduz saldos e gera reembolso do que foi pago em dinheiro.
      const items = await trx.selectFrom('sale_items').select(['id', 'quantity']).where('sale_id', '=', trade.sale_id).execute();
      const ret = await returnInTx(trx, actor, trade.sale_id, { items: items.map((i) => ({ saleItemId: i.id, quantity: i.quantity })), reason }, { kind: 'cancellation', refundOverride: 'reversal' });
      await trx.updateTable('sales').set({ status: 'reversed', cancel_reason: reason }).where('id', '=', trade.sale_id).execute();

      // 3) Compra: retira os itens recebidos; cancela contas a pagar em aberto; o que foi pago vira a receber.
      for (const lotId of lotIds) {
        await stockOutWholeLot(trx, actor, lotId, { kind: 'reversal', sourceType: 'trade_reversal', sourceId: trade.id, reason });
      }
      const payables = await trx.selectFrom('financial_titles').select(['id', 'original_cents', 'balance_cents']).where('origin_type', '=', 'purchase').where('origin_id', '=', trade.purchase_id).orderBy('id').execute();
      let paidToCustomer = 0n;
      for (const p of payables) {
        paidToCustomer += p.original_cents - p.balance_cents;
        await cancelTitleBalance(trx, actor, p.id, { type: 'trade_reversal', id: trade.id }, reason);
      }
      let refundReceivableId: string | null = null;
      if (paidToCustomer > 0n) {
        refundReceivableId = await createTitle(trx, actor, {
          direction: 'receivable', partyId: trade.party_id, originType: 'refund', originId: trade.id, description: `Devolução da diferença paga na troca #${trade.number}`,
          competenceDate: today, dueDate: today, amountCents: paidToCustomer,
        });
      }
      if (trade.difference_policy === 'store_credit' && trade.difference_cents < 0n) {
        await revokeStoreCredit(trx, actor, { partyId: trade.party_id, amountCents: -trade.difference_cents, originType: 'trade_reversal', originId: trade.id, reason });
      }
      await trx.updateTable('purchases').set({ status: 'canceled', canceled_at: new Date(), cancel_reason: reason }).where('id', '=', trade.purchase_id).execute();
      await trx.updateTable('trades').set({ status: 'reversed', reversed_at: new Date(), reversal_reason: reason }).where('id', '=', trade.id).execute();
      await audit(trx, actor, 'trade.reversed', 'trade', trade.id, { reason, returnId: ret.returnId, refundPayable: ret.refundCents, refundReceivable: paidToCustomer });
      return { tradeId: trade.id, returnId: ret.returnId, refundToCustomerCents: ret.refundCents, refundFromCustomerCents: paidToCustomer, refundReceivableId, refundPayableId: ret.refundTitleId };
    });
    return result;
  });
}

export const zTradeList = zPageQuery.extend({ status: z.enum(['confirmed', 'reversed', 'all']).default('all'), q: z.string().max(100).optional() });

export async function listTrades(deps: AppDeps, actor: Actor, q: z.infer<typeof zTradeList>) {
  requirePermission(actor, 'sales.view');
  const offset = decodeCursor(q.cursor);
  return tx(deps, actor, async (trx) => {
    let query = trx
      .selectFrom('trades as t')
      .innerJoin('parties as p', 'p.id', 't.party_id')
      .select(['t.id', 't.number', 't.status', 't.confirmed_at', 'p.name as party_name', 't.sale_total_cents', 't.purchase_total_cents', 't.offset_cents', 't.difference_cents', 't.difference_policy', 't.sale_id', 't.purchase_id']);
    if (q.status !== 'all') query = query.where('t.status', '=', q.status);
    if (q.q) query = query.where('p.name', 'ilike', `%${q.q.replace(/[%_]/g, '')}%`);
    const rows = await query.orderBy('t.confirmed_at', 'desc').orderBy('t.id').limit(q.limit + 1).offset(offset).execute();
    return pageOf(rows, offset, q.limit);
  });
}

export async function getTrade(deps: AppDeps, actor: Actor, id: string) {
  requirePermission(actor, 'sales.view');
  const showCost = can(actor, 'costs.view');
  return tx(deps, actor, async (trx) => {
    const trade = await trx
      .selectFrom('trades as t')
      .innerJoin('parties as p', 'p.id', 't.party_id')
      .selectAll('t')
      .select(['p.name as party_name'])
      .where('t.id', '=', id)
      .executeTakeFirst();
    if (!trade) throw notFound('Troca');
    const outgoing = await trx
      .selectFrom('sale_items as si')
      .leftJoin('inventory_units as u', 'u.id', 'si.unit_id')
      .select(['si.id', 'si.description', 'si.sku', 'si.quantity', 'si.unit_price_cents', 'si.total_cents', 'u.internal_code', ...(showCost ? (['si.cost_cents'] as const) : [])])
      .where('si.sale_id', '=', trade.sale_id)
      .orderBy('si.position')
      .execute();
    const incoming = await trx
      .selectFrom('trade_valuations as tv')
      .innerJoin('purchase_items as pi', 'pi.id', 'tv.purchase_item_id')
      .leftJoin('inventory_units as u', 'u.id', 'tv.unit_id')
      .select(['tv.id', 'pi.description', 'pi.quantity', 'tv.agreed_cents', 'tv.estimated_extra_cost_cents', 'tv.suggested_price_cents', 'tv.condition', 'tv.identifiers', 'tv.destination', 'tv.notes', 'u.internal_code', 'u.status as unit_status'])
      .where('tv.trade_id', '=', id)
      .orderBy('tv.position')
      .execute();
    const settlements = await trx
      .selectFrom('settlement_allocations as a')
      .innerJoin('settlements as s', 's.id', 'a.settlement_id')
      .innerJoin('financial_titles as t', 't.id', 'a.title_id')
      .select(['s.id', 's.direction', 's.method', 's.settled_on', 'a.amount_cents', 's.reversal_of'])
      .where((eb) => eb.or([eb.and([eb('t.origin_type', '=', 'sale'), eb('t.origin_id', '=', trade.sale_id)]), eb.and([eb('t.origin_type', '=', 'purchase'), eb('t.origin_id', '=', trade.purchase_id)])]))
      .execute();
    const documents = await trx.selectFrom('documents').select(['id', 'doc_type', 'number', 'status']).where('source_id', 'in', [trade.id, trade.purchase_id, trade.sale_id]).execute();
    return { trade, outgoing, incoming, settlements, documents, canSeeCost: showCost };
  });
}
