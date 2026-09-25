import { z } from 'zod';
import { jsonb, nextNumber, sql, type Tx } from '@gct/db';
import { assertPaymentsCoverTotal, computeSaleTotals, discountExceedsLimit, type PaymentKind } from '@gct/domain';
import { addDays, applyBps, conflict, forbidden, invalid, notFound } from '@gct/shared';
import { audit, can, emit, idempotent, requirePermission, requireWritable, todayLocal, tx, type Actor, type AppDeps } from './core';
import { checkLimit } from './billing';
import { assertPeriodOpen, createInstallmentTitles, createTitle, recordSettlement, useStoreCredit, type SettlementMethod } from './finance';
import { defaultLocation, releaseReservations, reserve, stockOutFifo, stockOutUnit } from './inventory';
import { requestDocument } from './documents';
import { decodeCursor, pageOf, zCentsNonNeg, zCentsPos, zLocalDate, zPageQuery, zQty, zText, zUuid } from './validation';

export const zSalePayment = z.object({
  kind: z.enum(['cash', 'pix', 'debit', 'credit', 'bank_transfer', 'store_credit', 'installment']),
  paymentMethodId: zUuid.optional().nullable(),
  amountCents: zCentsPos,
  installments: z.number().int().min(1).max(48).default(1),
  firstDueDate: zLocalDate.optional(),
  interval: z.union([z.literal('monthly'), z.number().int().min(1).max(365)]).optional(),
  /** registrar recebimento agora (dinheiro/Pix confirmado pelo operador) */
  settleNow: z.boolean().optional(),
  accountId: zUuid.optional().nullable(),
  reference: zText(120).optional().nullable(),
});
export type SalePaymentInput = z.infer<typeof zSalePayment>;

export const zSaleItem = z.object({
  variantId: zUuid,
  unitId: zUuid.optional().nullable(),
  quantity: zQty,
  unitPriceCents: zCentsNonNeg,
  discountCents: zCentsNonNeg.optional(),
});

export const zSale = z.object({
  customerId: zUuid.optional().nullable(),
  channelId: zUuid.optional().nullable(),
  saleDate: zLocalDate.optional(),
  items: z.array(zSaleItem).min(1).max(200),
  discountCents: zCentsNonNeg.default(0n),
  shippingCents: zCentsNonNeg.default(0n),
  payments: z.array(zSalePayment).max(10).default([]),
  notes: zText(2000).optional().nullable(),
});
export type SaleInput = z.infer<typeof zSale>;

interface InternalPayment {
  kind: PaymentKind;
  paymentMethodId?: string | null;
  amountCents: bigint;
  installments?: number;
  firstDueDate?: string;
  interval?: 'monthly' | number;
  settleNow?: boolean;
  accountId?: string | null;
  reference?: string | null;
}

export interface ConfirmedSale {
  saleId: string;
  number: string;
  totalCents: bigint;
  costCents: bigint;
  receivableTitleIds: string[];
  offsetTitleId: string | null;
}

/**
 * Confirmação atômica: valida, bloqueia estoque em ordem canônica, baixa com
 * custo histórico (FIFO/unidade), cria venda com snapshot, títulos e
 * liquidações confirmadas, auditoria e outbox. Qualquer erro desfaz tudo.
 */
export async function confirmSaleInTx(
  trx: Tx,
  actor: Actor,
  input: Omit<SaleInput, 'payments'> & { payments: InternalPayment[] },
  opts: { origin?: 'sale' | 'trade' | 'store'; saleId?: string; tradeId?: string | null } = {},
): Promise<ConfirmedSale> {
  const origin = opts.origin ?? 'sale';
  const saleDate = input.saleDate ?? todayLocal(actor.timezone);
  await assertPeriodOpen(trx, saleDate);
  await checkLimit(trx, actor.tenantId, 'monthly_sales', 1);

  const needsCustomer = origin === 'trade' || input.payments.some((p) => p.kind === 'installment' || p.kind === 'store_credit');
  if (needsCustomer && !input.customerId) throw invalid('Cliente obrigatório para venda a prazo, crédito da loja ou troca.', { customerId: 'obrigatório' });
  if (input.customerId) {
    const c = await trx.selectFrom('parties').select(['id', 'status', 'is_customer']).where('id', '=', input.customerId).executeTakeFirst();
    if (!c || c.status !== 'active') throw invalid('Cliente inválido.', { customerId: 'inválido' });
    if (!c.is_customer) await trx.updateTable('parties').set({ is_customer: true }).where('id', '=', c.id).execute();
  }
  const channel = input.channelId
    ? await trx.selectFrom('sales_channels').select(['id', 'commission_bps', 'active']).where('id', '=', input.channelId).executeTakeFirst()
    : await trx.selectFrom('sales_channels').select(['id', 'commission_bps', 'active']).where('active', '=', true).orderBy('created_at').executeTakeFirst();
  if (!channel || !channel.active) throw invalid('Canal de venda inválido.', { channelId: 'inválido' });

  const variantIds = [...new Set(input.items.map((i) => i.variantId))];
  const variants = await trx
    .selectFrom('product_variants as v')
    .innerJoin('products as p', 'p.id', 'v.product_id')
    .select(['v.id', 'v.sku', 'v.label', 'v.status as v_status', 'p.name', 'p.kind', 'p.tracking', 'p.status'])
    .where('v.id', 'in', variantIds)
    .execute();
  const vmap = new Map(variants.map((v) => [v.id, v]));
  const unitIds = new Set<string>();
  for (const i of input.items) {
    const v = vmap.get(i.variantId);
    if (!v || v.status !== 'active' || v.v_status !== 'active') throw invalid('Produto inativo ou inexistente não pode ser vendido.', { items: i.variantId });
    if (v.tracking === 'serialized') {
      if (!i.unitId) throw invalid(`Escolha a unidade (IMEI/série) de "${v.name}".`, { items: 'unidade obrigatória' });
      if (i.quantity !== 1) throw invalid('Item serializado é vendido por unidade.');
      if (unitIds.has(i.unitId)) throw invalid('A mesma unidade aparece duas vezes.');
      unitIds.add(i.unitId);
    } else if (i.unitId) {
      throw invalid('Unidade informada para produto sem controle serial.');
    }
  }

  const totals = computeSaleTotals(
    input.items.map((i) => ({ quantity: i.quantity, unitPriceCents: i.unitPriceCents, discountCents: i.discountCents })),
    input.discountCents,
    input.shippingCents,
  );
  let discountApprovedBy: string | null = null;
  if (discountExceedsLimit(totals.subtotalCents, totals.discountCents, actor.discountLimitBps)) {
    if (!can(actor, 'sales.discount_over_limit'))
      throw forbidden('Desconto acima do seu limite. Peça a um gestor para aprovar ou reduzir o desconto.');
    discountApprovedBy = actor.userId;
  }
  if (totals.totalCents > 0n || input.payments.length > 0) assertPaymentsCoverTotal(totals.totalCents, input.payments);

  // Estoque: ordem canônica (variante, unidade) para evitar deadlock entre vendas concorrentes.
  const loc = await defaultLocation(trx);
  const order = input.items
    .map((item, idx) => ({ item, idx }))
    .sort((a, b) => (a.item.variantId === b.item.variantId ? ((a.item.unitId ?? '') < (b.item.unitId ?? '') ? -1 : 1) : a.item.variantId < b.item.variantId ? -1 : 1));
  const number = await nextNumber(trx, actor.tenantId, 'sale');
  const sale = opts.saleId
    ? await trx
        .updateTable('sales')
        .set({ number, status: 'confirmed' })
        .where('id', '=', opts.saleId)
        .returning('id')
        .executeTakeFirstOrThrow()
    : await trx
        .insertInto('sales')
        .values({ tenant_id: actor.tenantId, sale_date: saleDate, number, status: 'confirmed', origin, created_by: actor.userId })
        .returning('id')
        .executeTakeFirstOrThrow();
  const stockResults = new Map<number, Awaited<ReturnType<typeof stockOutFifo>>>();
  for (const { item, idx } of order) {
    const v = vmap.get(item.variantId)!;
    if (v.kind === 'service') continue;
    const r =
      v.tracking === 'serialized'
        ? await stockOutUnit(trx, actor, {
            unitId: item.unitId!, variantId: v.id, kind: origin === 'trade' ? 'trade_out' : 'sale', sourceType: 'sale', sourceId: sale.id,
            allowReservedBy: { sourceType: 'sale', sourceId: sale.id },
          })
        : await stockOutFifo(trx, actor, { variantId: v.id, locationId: loc, quantity: item.quantity, kind: origin === 'trade' ? 'trade_out' : 'sale', sourceType: 'sale', sourceId: sale.id });
    stockResults.set(idx, r);
  }
  let costTotal = 0n;
  for (const [idx, item] of input.items.entries()) {
    const v = vmap.get(item.variantId)!;
    const line = totals.lines[idx]!;
    const st = stockResults.get(idx);
    const cost = st?.costCents ?? 0n;
    costTotal += cost;
    const si = await trx
      .insertInto('sale_items')
      .values({
        tenant_id: actor.tenantId, sale_id: sale.id, position: idx, variant_id: v.id, product_kind: v.kind, unit_id: item.unitId ?? null,
        description: `${v.name}${v.label ? ` ${v.label}` : ''}`, sku: v.sku, quantity: item.quantity, unit_price_cents: item.unitPriceCents,
        gross_cents: line.grossCents, line_discount_cents: line.lineDiscountCents, order_discount_share_cents: line.orderDiscountShareCents,
        shipping_share_cents: line.shippingShareCents, total_cents: line.totalCents, cost_cents: cost,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    for (const c of st?.consumptions ?? []) {
      await trx
        .insertInto('sale_cost_allocations')
        .values({ tenant_id: actor.tenantId, sale_item_id: si.id, lot_id: c.lotId, unit_id: c.unitId, quantity: c.quantity, cost_cents: c.costCents })
        .execute();
    }
  }

  // Pagamentos: um título por forma; taxa congelada na confirmação.
  const methods = await trx.selectFrom('payment_methods').selectAll().execute();
  const receivableTitleIds: string[] = [];
  let offsetTitleId: string | null = null;
  let feesTotal = 0n;
  const baseTitle = {
    direction: 'receivable' as const,
    partyId: input.customerId ?? null,
    originType: 'sale' as const,
    originId: sale.id,
    competenceDate: saleDate,
  };
  for (const [pos, p] of input.payments.entries()) {
    const method = p.paymentMethodId
      ? methods.find((m) => m.id === p.paymentMethodId)
      : p.kind === 'trade_offset'
        ? undefined
        : methods.find((m) => m.kind === p.kind && m.active);
    if (p.kind !== 'trade_offset') {
      if (!method || !method.active) throw invalid('Forma de pagamento inválida.', { payments: String(pos) });
      if (method.kind !== p.kind) throw invalid('Forma de pagamento não corresponde ao tipo informado.', { payments: String(pos) });
    }
    const installments = p.installments ?? 1;
    const feeBps = method ? ((method.installment_fee_bps as Record<string, number>)[String(installments)] ?? method.fee_bps) : 0;
    const feeCents = applyBps(p.amountCents, feeBps);
    feesTotal += feeCents;
    const accountId = p.accountId ?? method?.account_id ?? null;
    const label = method?.name ?? 'Compensação de troca';
    const desc = `Venda #${number} · ${label}`;
    let settleNow = false;
    switch (p.kind) {
      case 'trade_offset': {
        if (origin !== 'trade') throw invalid('Compensação de troca só existe dentro de uma troca.');
        offsetTitleId = await createTitle(trx, actor, { ...baseTitle, description: `Venda #${number} · compensação de troca`, dueDate: saleDate, amountCents: p.amountCents });
        receivableTitleIds.push(offsetTitleId);
        break;
      }
      case 'store_credit': {
        const t = await createTitle(trx, actor, { ...baseTitle, description: desc, dueDate: saleDate, amountCents: p.amountCents });
        await useStoreCredit(trx, actor, { partyId: input.customerId!, titleId: t, amountCents: p.amountCents, originType: 'sale', originId: sale.id });
        receivableTitleIds.push(t);
        break;
      }
      case 'installment': {
        const first = p.firstDueDate ?? addDays(saleDate, 30);
        const ids = await createInstallmentTitles(trx, actor, { ...baseTitle, description: desc }, { totalCents: p.amountCents, count: installments, firstDueDate: first, interval: p.interval ?? 30 });
        receivableTitleIds.push(...ids);
        break;
      }
      case 'credit':
      case 'debit': {
        // Recebível do cartão: liquidação real ocorre quando a adquirente paga (líquido + taxa).
        const first = p.firstDueDate ?? addDays(saleDate, method!.settlement_days);
        const ids =
          p.kind === 'credit' && installments > 1
            ? await createInstallmentTitles(trx, actor, { ...baseTitle, description: desc }, { totalCents: p.amountCents, count: installments, firstDueDate: first, interval: 'monthly' })
            : [await createTitle(trx, actor, { ...baseTitle, description: desc, dueDate: first, amountCents: p.amountCents })];
        receivableTitleIds.push(...ids);
        settleNow = p.settleNow === true && installments === 1;
        if (settleNow) {
          if (!accountId) throw invalid('Conta de destino obrigatória para registrar o recebimento.');
          await recordSettlement(trx, actor, { direction: 'in', method: p.kind, accountId, settledOn: saleDate, allocations: [{ titleId: ids[0]!, amountCents: p.amountCents }], feeCents, reference: p.reference });
        }
        break;
      }
      default: {
        // Dinheiro, Pix e transferência: recebimento confirmado pelo operador (padrão: sim).
        const t = await createTitle(trx, actor, { ...baseTitle, description: desc, dueDate: p.firstDueDate ?? saleDate, amountCents: p.amountCents });
        receivableTitleIds.push(t);
        settleNow = p.settleNow ?? true;
        if (settleNow) {
          if (!accountId) throw invalid('Conta de destino obrigatória para registrar o recebimento.');
          await recordSettlement(trx, actor, { direction: 'in', method: p.kind as SettlementMethod, accountId, settledOn: saleDate, allocations: [{ titleId: t, amountCents: p.amountCents }], feeCents, reference: p.reference });
        }
      }
    }
    await trx
      .insertInto('sale_payments')
      .values({
        tenant_id: actor.tenantId, sale_id: sale.id, position: pos, kind: p.kind, payment_method_id: method?.id ?? null, method_name: label,
        amount_cents: p.amountCents, installments, fee_bps: feeBps, fee_cents: feeCents, account_id: accountId, first_due_date: p.firstDueDate ?? null, settled_now: settleNow,
      })
      .execute();
  }
  const channelCost = applyBps(totals.totalCents, channel.commission_bps);
  await trx
    .updateTable('sales')
    .set({
      customer_id: input.customerId ?? null,
      seller_user_id: actor.userId,
      channel_id: channel.id,
      sale_date: saleDate,
      confirmed_at: new Date(),
      subtotal_cents: totals.subtotalCents,
      discount_cents: totals.discountCents,
      shipping_cents: totals.shippingCents,
      total_cents: totals.totalCents,
      cost_total_cents: costTotal,
      fees_total_cents: feesTotal,
      channel_cost_cents: channelCost,
      channel_commission_bps: channel.commission_bps,
      discount_approved_by: discountApprovedBy,
      trade_id: opts.tradeId ?? null,
      notes: input.notes ?? null,
      draft_payload: '{}',
    })
    .where('id', '=', sale.id)
    .execute();
  await audit(trx, actor, 'sale.confirmed', 'sale', sale.id, { number, total: totals.totalCents, cost: costTotal, origin, discountApprovedBy });
  await emit(trx, actor.tenantId, 'SaleConfirmed', { saleId: sale.id });
  await requestDocument(trx, actor, 'sale_receipt', 'sale', sale.id);
  return { saleId: sale.id, number: number.toString(), totalCents: totals.totalCents, costCents: costTotal, receivableTitleIds, offsetTitleId };
}

export async function confirmSale(deps: AppDeps, actor: Actor, input: SaleInput, idempotencyKey?: string) {
  requirePermission(actor, 'sales.create');
  requireWritable(actor);
  return tx(deps, actor, async (trx) => {
    const { result, replayed } = await idempotent(trx, actor.tenantId, 'sale.confirm', idempotencyKey, input, async () => {
      const r = await confirmSaleInTx(trx, actor, input);
      return { ...r, costCents: can(actor, 'costs.view') ? r.costCents : undefined };
    });
    return { ...result, replayed };
  });
}

// ---------------------------------------------------------------------------
// Orçamento / rascunho com reserva opcional

export const zSaleDraft = zSale.extend({
  validUntil: zLocalDate.optional(),
  reserveHours: z.number().int().min(1).max(24 * 30).optional(),
});

export async function saveSaleDraft(deps: AppDeps, actor: Actor, input: z.infer<typeof zSaleDraft>, saleId?: string) {
  requirePermission(actor, 'sales.create');
  requireWritable(actor);
  return tx(deps, actor, async (trx) => {
    const today = todayLocal(actor.timezone);
    let id = saleId;
    if (id) {
      const s = await trx.selectFrom('sales').select('status').where('id', '=', id).forUpdate().executeTakeFirst();
      if (!s) throw notFound('Orçamento');
      if (s.status !== 'draft') throw conflict('Somente rascunhos podem ser editados.');
      await releaseReservations(trx, actor, 'sale', id);
    }
    const totals = computeSaleTotals(
      input.items.map((i) => ({ quantity: i.quantity, unitPriceCents: i.unitPriceCents, discountCents: i.discountCents })),
      input.discountCents,
      input.shippingCents,
    );
    const values = {
      customer_id: input.customerId ?? null,
      channel_id: input.channelId ?? null,
      sale_date: input.saleDate ?? today,
      valid_until: input.validUntil ?? null,
      subtotal_cents: totals.subtotalCents,
      discount_cents: totals.discountCents,
      shipping_cents: totals.shippingCents,
      total_cents: totals.totalCents,
      notes: input.notes ?? null,
      draft_payload: jsonb(input),
    };
    if (id) await trx.updateTable('sales').set({ ...values, version: sql`version + 1` }).where('id', '=', id).execute();
    else id = (await trx.insertInto('sales').values({ tenant_id: actor.tenantId, status: 'draft', created_by: actor.userId, ...values }).returning('id').executeTakeFirstOrThrow()).id;
    if (input.reserveHours) {
      const exp = new Date(Date.now() + input.reserveHours * 3600000);
      for (const i of [...input.items].sort((a, b) => (a.variantId < b.variantId ? -1 : 1))) {
        await reserve(trx, actor, { variantId: i.variantId, unitId: i.unitId ?? null, quantity: i.quantity, sourceType: 'sale', sourceId: id!, expiresAt: exp });
      }
    }
    await audit(trx, actor, 'sale.draft_saved', 'sale', id!, { total: totals.totalCents, reserved: !!input.reserveHours });
    return { id: id!, totalCents: totals.totalCents };
  });
}

/** Confirma orçamento: libera reservas próprias e confirma pela regra normal. */
export async function confirmDraft(deps: AppDeps, actor: Actor, saleId: string, payments: SalePaymentInput[], idempotencyKey?: string) {
  requirePermission(actor, 'sales.create');
  requireWritable(actor);
  return tx(deps, actor, async (trx) => {
    const { result } = await idempotent(trx, actor.tenantId, 'sale.confirm_draft', idempotencyKey, { saleId, payments }, async () => {
      const s = await trx.selectFrom('sales').selectAll().where('id', '=', saleId).forUpdate().executeTakeFirst();
      if (!s) throw notFound('Orçamento');
      if (s.status !== 'draft') throw conflict('Orçamento já confirmado ou cancelado.');
      await releaseReservations(trx, actor, 'sale', saleId, 'released');
      const draft = s.draft_payload as Record<string, unknown>;
      const parsed = zSale.parse({ ...draft, payments });
      return confirmSaleInTx(trx, actor, { ...parsed, saleDate: todayLocal(actor.timezone) }, { saleId });
    });
    return result;
  });
}

export async function cancelDraft(deps: AppDeps, actor: Actor, saleId: string) {
  requirePermission(actor, 'sales.create');
  return tx(deps, actor, async (trx) => {
    const s = await trx.selectFrom('sales').select('status').where('id', '=', saleId).forUpdate().executeTakeFirst();
    if (!s) throw notFound('Orçamento');
    if (s.status !== 'draft') throw conflict('Venda confirmada é desfeita por devolução/cancelamento, não por exclusão.');
    await releaseReservations(trx, actor, 'sale', saleId);
    await trx.updateTable('sales').set({ status: 'canceled', canceled_at: new Date() }).where('id', '=', saleId).execute();
    await audit(trx, actor, 'sale.draft_canceled', 'sale', saleId);
  });
}

// ---------------------------------------------------------------------------
// Consultas

export const zSaleList = zPageQuery.extend({
  status: z.enum(['draft', 'confirmed', 'returned', 'all_confirmed', 'all']).default('all_confirmed'),
  from: zLocalDate.optional(),
  to: zLocalDate.optional(),
  q: z.string().max(100).optional(),
  channelId: zUuid.optional(),
  origin: z.enum(['sale', 'trade', 'store']).optional(),
});

export async function listSales(deps: AppDeps, actor: Actor, q: z.infer<typeof zSaleList>) {
  requirePermission(actor, 'sales.view');
  const offset = decodeCursor(q.cursor);
  const showCost = can(actor, 'costs.view');
  return tx(deps, actor, async (trx) => {
    let query = trx
      .selectFrom('sales as s')
      .leftJoin('parties as c', 'c.id', 's.customer_id')
      .leftJoin('sales_channels as ch', 'ch.id', 's.channel_id')
      .select([
        's.id', 's.number', 's.status', 's.origin', 's.sale_date', 's.valid_until', 's.total_cents', 's.returned_revenue_cents', 'c.name as customer_name',
        'ch.name as channel_name', 's.created_at', 's.trade_id',
        ...(showCost ? (['s.cost_total_cents', 's.fees_total_cents', 's.returned_cost_cents'] as const) : []),
        sql<string>`(select string_agg(distinct sp.method_name, ', ') from sale_payments sp where sp.sale_id = s.id)`.as('payment_methods'),
        sql<number>`(select coalesce(sum(quantity),0) from sale_items si where si.sale_id = s.id)::int`.as('items_qty'),
        sql<number>`count(*) over ()::int`.as('total'),
      ]);
    if (q.status === 'draft') query = query.where('s.status', '=', 'draft');
    else if (q.status === 'confirmed') query = query.where('s.status', '=', 'confirmed');
    else if (q.status === 'returned') query = query.where('s.status', 'in', ['partially_returned', 'returned', 'reversed']);
    else if (q.status === 'all_confirmed') query = query.where('s.status', 'not in', ['draft', 'canceled']);
    if (q.from) query = query.where('s.sale_date', '>=', q.from);
    if (q.to) query = query.where('s.sale_date', '<=', q.to);
    if (q.channelId) query = query.where('s.channel_id', '=', q.channelId);
    if (q.origin) query = query.where('s.origin', '=', q.origin);
    if (q.q) {
      const term = q.q.replace(/[%_]/g, '');
      const num = /^\d+$/.test(term) ? BigInt(term) : null;
      query = query.where((eb) =>
        eb.or([
          eb('c.name', 'ilike', `%${term}%`),
          eb.exists(eb.selectFrom('sale_items as si').select('si.id').whereRef('si.sale_id', '=', 's.id').where('si.description', 'ilike', `%${term}%`)),
          ...(num !== null ? [eb('s.number', '=', num)] : []),
        ]),
      );
    }
    const rows = await query.orderBy('s.sale_date', 'desc').orderBy('s.created_at', 'desc').orderBy('s.id').limit(q.limit + 1).offset(offset).execute();
    const total = rows[0]?.total ?? 0;
    return pageOf(rows.map(({ total: _t, ...r }) => r), offset, q.limit, total);
  });
}

export async function getSale(deps: AppDeps, actor: Actor, id: string) {
  requirePermission(actor, 'sales.view');
  const showCost = can(actor, 'costs.view');
  return tx(deps, actor, async (trx) => {
    const sale = await trx
      .selectFrom('sales as s')
      .leftJoin('parties as c', 'c.id', 's.customer_id')
      .leftJoin('sales_channels as ch', 'ch.id', 's.channel_id')
      .selectAll('s')
      .select(['c.name as customer_name', 'ch.name as channel_name'])
      .where('s.id', '=', id)
      .executeTakeFirst();
    if (!sale) throw notFound('Venda');
    const items = await trx
      .selectFrom('sale_items as si')
      .leftJoin('inventory_units as u', 'u.id', 'si.unit_id')
      .selectAll('si')
      .select(['u.internal_code'])
      .where('si.sale_id', '=', id)
      .orderBy('si.position')
      .execute();
    const payments = await trx.selectFrom('sale_payments').selectAll().where('sale_id', '=', id).orderBy('position').execute();
    const titles = can(actor, 'finance.view')
      ? await trx.selectFrom('financial_titles').select(['id', 'description', 'due_date', 'original_cents', 'balance_cents', 'status']).where('origin_type', '=', 'sale').where('origin_id', '=', id).orderBy('due_date').execute()
      : [];
    const returns = await trx.selectFrom('returns').select(['id', 'number', 'kind', 'reason', 'revenue_cents', 'refund_cents', 'store_credit_cents', 'reduced_balance_cents', 'created_at']).where('sale_id', '=', id).orderBy('created_at').execute();
    const documents = await trx.selectFrom('documents').select(['id', 'doc_type', 'number', 'status']).where('source_id', '=', id).execute();
    const stripCost = <T extends Record<string, unknown>>(o: T) => {
      if (showCost) return o;
      const c = { ...o } as Record<string, unknown>;
      for (const k of ['cost_cents', 'cost_total_cents', 'returned_cost_cents', 'fees_total_cents', 'channel_cost_cents']) delete c[k];
      return c;
    };
    return {
      sale: stripCost(sale),
      items: items.map(stripCost),
      payments: showCost ? payments : payments.map(({ fee_bps: _a, fee_cents: _b, ...p }) => p),
      titles,
      returns: showCost ? returns : returns.map((r) => r),
      documents,
      canSeeCost: showCost,
    };
  });
}

export async function listChannels(deps: AppDeps, actor: Actor) {
  return tx(deps, actor, (trx) => trx.selectFrom('sales_channels').select(['id', 'name', 'commission_bps', 'active']).orderBy('name').execute());
}

export async function listPaymentMethods(deps: AppDeps, actor: Actor) {
  return tx(deps, actor, (trx) =>
    trx
      .selectFrom('payment_methods as m')
      .leftJoin('financial_accounts as a', 'a.id', 'm.account_id')
      .select(['m.id', 'm.name', 'm.kind', 'm.fee_bps', 'm.installment_fee_bps', 'm.settlement_days', 'm.account_id', 'a.name as account_name', 'm.active'])
      .orderBy('m.name')
      .execute(),
  );
}

export const zChannel = z.object({ name: zText(60).min(2), commissionBps: z.number().int().min(0).max(10000).default(0), active: z.boolean().default(true) });

export async function saveChannel(deps: AppDeps, actor: Actor, input: z.infer<typeof zChannel>, id?: string) {
  requirePermission(actor, 'settings.manage');
  return tx(deps, actor, async (trx) => {
    try {
      const values = { name: input.name, commission_bps: input.commissionBps, active: input.active };
      const r = id
        ? await trx.updateTable('sales_channels').set(values).where('id', '=', id).returning('id').executeTakeFirst()
        : await trx.insertInto('sales_channels').values({ tenant_id: actor.tenantId, ...values }).returning('id').executeTakeFirstOrThrow();
      if (!r) throw notFound('Canal');
      await audit(trx, actor, 'settings.channel_saved', 'sales_channel', r.id, input);
      return r;
    } catch (e) {
      if ((e as { code?: string }).code === '23505') throw conflict('Já existe canal com esse nome.');
      throw e;
    }
  });
}

export const zPaymentMethod = z.object({
  name: zText(60).min(2),
  kind: z.enum(['cash', 'pix', 'debit', 'credit', 'bank_transfer', 'store_credit', 'installment']),
  feeBps: z.number().int().min(0).max(10000).default(0),
  installmentFeeBps: z.record(z.string().regex(/^\d{1,2}$/), z.number().int().min(0).max(10000)).default({}),
  settlementDays: z.number().int().min(0).max(120).default(0),
  accountId: zUuid.optional().nullable(),
  active: z.boolean().default(true),
});

/** Alterar taxa não muda vendas já confirmadas (snapshot em sale_payments). */
export async function savePaymentMethod(deps: AppDeps, actor: Actor, input: z.infer<typeof zPaymentMethod>, id?: string) {
  requirePermission(actor, 'settings.manage');
  return tx(deps, actor, async (trx) => {
    const values = {
      name: input.name, kind: input.kind, fee_bps: input.feeBps, installment_fee_bps: JSON.stringify(input.installmentFeeBps),
      settlement_days: input.settlementDays, account_id: input.accountId ?? null, active: input.active,
    };
    try {
      const r = id
        ? await trx.updateTable('payment_methods').set(values).where('id', '=', id).returning('id').executeTakeFirst()
        : await trx.insertInto('payment_methods').values({ tenant_id: actor.tenantId, ...values }).returning('id').executeTakeFirstOrThrow();
      if (!r) throw notFound('Forma de pagamento');
      await audit(trx, actor, 'settings.payment_method_saved', 'payment_method', r.id, { feeBps: input.feeBps });
      return r;
    } catch (e) {
      if ((e as { code?: string }).code === '23505') throw conflict('Já existe forma de pagamento com esse nome.');
      throw e;
    }
  });
}

