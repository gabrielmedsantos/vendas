import { z } from 'zod';
import { nextNumber } from '@gct/db';
import { addDays, formatDateBR, invalid, notFound } from '@gct/shared';
import { audit, requirePermission, requireWritable, todayLocal, tx, type Actor, type AppDeps } from './core';
import { requestDocument } from './documents';
import { decodeCursor, pageOf, zCentsNonNeg, zLocalDate, zPageQuery, zText, zUuid } from './validation';

/**
 * Pós-venda simples (MVP): ordens de serviço e casos de garantia.
 * Não movimentam estoque nem financeiro; cobrança de serviço é feita por uma
 * venda de item "serviço", que pode ser vinculada à ordem.
 */

// ---------------------------------------------------------------- ordens de serviço

export const SERVICE_STATUS = ['open', 'in_progress', 'done', 'delivered', 'canceled'] as const;
type ServiceStatus = (typeof SERVICE_STATUS)[number];
const SERVICE_FLOW: Record<ServiceStatus, ServiceStatus[]> = {
  open: ['in_progress', 'canceled'],
  in_progress: ['open', 'done', 'canceled'],
  done: ['in_progress', 'delivered'],
  delivered: [],
  canceled: [],
};

export const zServiceOrder = z.object({
  partyId: zUuid.optional().nullable(),
  saleId: zUuid.optional().nullable(),
  title: zText(160).min(2, 'Informe o serviço'),
  description: zText(4000).optional().nullable(),
  priceCents: zCentsNonNeg.default(0n),
  dueDate: zLocalDate.optional().nullable(),
});

export const zServiceOrderList = zPageQuery.extend({
  status: z.enum(SERVICE_STATUS).optional(),
  q: zText(80).optional(),
});

export async function createServiceOrder(deps: AppDeps, actor: Actor, input: z.infer<typeof zServiceOrder>) {
  requirePermission(actor, 'sales.create');
  requireWritable(actor);
  return tx(deps, actor, async (trx) => {
    const number = await nextNumber(trx, actor.tenantId, 'service_order');
    const row = await trx
      .insertInto('service_orders')
      .values({
        tenant_id: actor.tenantId, number, party_id: input.partyId ?? null, sale_id: input.saleId ?? null, title: input.title,
        description: input.description ?? null, price_cents: input.priceCents, due_date: input.dueDate ?? null, created_by: actor.userId,
      })
      .returning(['id', 'number'])
      .executeTakeFirstOrThrow();
    await audit(trx, actor, 'service_order.created', 'service_order', row.id, { title: input.title });
    return row;
  });
}

export async function updateServiceOrder(deps: AppDeps, actor: Actor, id: string, input: z.infer<typeof zServiceOrder>) {
  requirePermission(actor, 'sales.create');
  requireWritable(actor);
  return tx(deps, actor, async (trx) => {
    const cur = await trx.selectFrom('service_orders').select(['status']).where('id', '=', id).forUpdate().executeTakeFirst();
    if (!cur) throw notFound('Ordem de serviço');
    if (cur.status === 'delivered' || cur.status === 'canceled') throw invalid('Ordem entregue ou cancelada não pode ser editada.');
    await trx
      .updateTable('service_orders')
      .set({ party_id: input.partyId ?? null, sale_id: input.saleId ?? null, title: input.title, description: input.description ?? null, price_cents: input.priceCents, due_date: input.dueDate ?? null })
      .where('id', '=', id)
      .execute();
    await audit(trx, actor, 'service_order.updated', 'service_order', id, {});
  });
}

export async function setServiceOrderStatus(deps: AppDeps, actor: Actor, id: string, to: ServiceStatus, note?: string) {
  requirePermission(actor, 'sales.create');
  requireWritable(actor);
  return tx(deps, actor, async (trx) => {
    const cur = await trx.selectFrom('service_orders').select(['status']).where('id', '=', id).forUpdate().executeTakeFirst();
    if (!cur) throw notFound('Ordem de serviço');
    const from = cur.status as ServiceStatus;
    if (from === to) return { changed: false };
    if (!SERVICE_FLOW[from].includes(to)) throw invalid(`Não é possível mudar de "${from}" para "${to}".`);
    if (to === 'canceled' && !note?.trim()) throw invalid('Informe o motivo do cancelamento.', { reason: 'Obrigatório' });
    await trx.updateTable('service_orders').set({ status: to }).where('id', '=', id).execute();
    await audit(trx, actor, 'service_order.status', 'service_order', id, { from, to, note: note ?? null });
    return { changed: true };
  });
}

export async function listServiceOrders(deps: AppDeps, actor: Actor, q: z.infer<typeof zServiceOrderList>) {
  requirePermission(actor, 'sales.view');
  const offset = decodeCursor(q.cursor);
  return tx(deps, actor, async (trx) => {
    let query = trx
      .selectFrom('service_orders as o')
      .leftJoin('parties as p', 'p.id', 'o.party_id')
      .select(['o.id', 'o.number', 'o.title', 'o.status', 'o.price_cents', 'o.due_date', 'o.sale_id', 'o.created_at', 'o.updated_at', 'p.name as party_name']);
    if (q.status) query = query.where('o.status', '=', q.status);
    if (q.q) {
      const term = `%${q.q.replace(/[%_]/g, '')}%`;
      query = query.where((eb) => eb.or([eb('o.title', 'ilike', term), eb('p.name', 'ilike', term)]));
    }
    const rows = await query.orderBy('o.number', 'desc').limit(q.limit + 1).offset(offset).execute();
    return pageOf(rows, offset, q.limit);
  });
}

export async function getServiceOrder(deps: AppDeps, actor: Actor, id: string) {
  requirePermission(actor, 'sales.view');
  return tx(deps, actor, async (trx) => {
    const o = await trx
      .selectFrom('service_orders as o')
      .leftJoin('parties as p', 'p.id', 'o.party_id')
      .leftJoin('sales as s', 's.id', 'o.sale_id')
      .selectAll('o')
      .select(['p.name as party_name', 's.number as sale_number'])
      .where('o.id', '=', id)
      .executeTakeFirst();
    if (!o) throw notFound('Ordem de serviço');
    const history = await trx
      .selectFrom('audit_events')
      .select(['action', 'data', 'created_at', 'user_id'])
      .where('entity', '=', 'service_order')
      .where('entity_id', '=', id)
      .orderBy('created_at')
      .execute();
    return { ...o, history };
  });
}

// ---------------------------------------------------------------- garantia

export const WARRANTY_STATUS = ['open', 'in_progress', 'resolved', 'rejected'] as const;
type WarrantyStatus = (typeof WARRANTY_STATUS)[number];
const WARRANTY_FLOW: Record<WarrantyStatus, WarrantyStatus[]> = {
  open: ['in_progress', 'resolved', 'rejected'],
  in_progress: ['resolved', 'rejected'],
  resolved: [],
  rejected: [],
};

export const zWarrantyCase = z.object({
  saleId: zUuid,
  saleItemId: zUuid.optional().nullable(),
  description: zText(4000).min(5, 'Descreva o problema relatado'),
});

/**
 * Abre atendimento de garantia vinculado à venda. Prazo = data da venda +
 * dias de garantia do produto (registrados na venda). Os termos vigentes da
 * empresa são copiados para o caso (documento mostra os termos da época).
 */
export async function openWarrantyCase(deps: AppDeps, actor: Actor, input: z.infer<typeof zWarrantyCase>) {
  requirePermission(actor, 'sales.create');
  requireWritable(actor);
  return tx(deps, actor, async (trx) => {
    const sale = await trx.selectFrom('sales').select(['id', 'status', 'sale_date', 'customer_id', 'number']).where('id', '=', input.saleId).executeTakeFirst();
    if (!sale) throw notFound('Venda');
    if (!['confirmed', 'partially_returned'].includes(sale.status)) throw invalid('Garantia só pode ser aberta para venda confirmada.');
    let termsLine = '';
    if (input.saleItemId) {
      const item = await trx
        .selectFrom('sale_items as si')
        .innerJoin('product_variants as v', 'v.id', 'si.variant_id')
        .innerJoin('products as p', 'p.id', 'v.product_id')
        .select(['si.id', 'si.description', 'p.warranty_days'])
        .where('si.id', '=', input.saleItemId)
        .where('si.sale_id', '=', sale.id)
        .executeTakeFirst();
      if (!item) throw notFound('Item da venda');
      if (item.warranty_days <= 0) throw invalid('Este produto não tem garantia comercial cadastrada.');
      const until = addDays(sale.sale_date, item.warranty_days);
      if (todayLocal(actor.timezone) > until) throw invalid(`Garantia encerrada em ${formatDateBR(until)}.`);
      termsLine = `${item.description}: ${item.warranty_days} dias a partir de ${formatDateBR(sale.sale_date)} (até ${formatDateBR(until)}).`;
    }
    const t = await trx.selectFrom('tenants').select(['settings']).where('id', '=', actor.tenantId).executeTakeFirstOrThrow();
    const companyTerms = (t.settings as { warrantyTerms?: string }).warrantyTerms ?? '';
    const number = await nextNumber(trx, actor.tenantId, 'warranty_case');
    const row = await trx
      .insertInto('warranty_cases')
      .values({
        tenant_id: actor.tenantId, number, sale_id: sale.id, sale_item_id: input.saleItemId ?? null, party_id: sale.customer_id,
        description: input.description, warranty_terms_snapshot: [termsLine, companyTerms].filter(Boolean).join('\n\n') || null, created_by: actor.userId,
      })
      .returning(['id', 'number'])
      .executeTakeFirstOrThrow();
    await audit(trx, actor, 'warranty.opened', 'warranty_case', row.id, { saleId: sale.id });
    return row;
  });
}

export async function setWarrantyStatus(deps: AppDeps, actor: Actor, id: string, to: WarrantyStatus, resolution?: string) {
  requirePermission(actor, 'sales.create');
  requireWritable(actor);
  return tx(deps, actor, async (trx) => {
    const cur = await trx.selectFrom('warranty_cases').select(['status']).where('id', '=', id).forUpdate().executeTakeFirst();
    if (!cur) throw notFound('Caso de garantia');
    const from = cur.status as WarrantyStatus;
    if (from === to) return { changed: false };
    if (!WARRANTY_FLOW[from].includes(to)) throw invalid('Transição de status inválida.');
    if ((to === 'resolved' || to === 'rejected') && !resolution?.trim()) throw invalid('Descreva a solução ou o motivo da recusa.', { resolution: 'Obrigatório' });
    await trx.updateTable('warranty_cases').set({ status: to, ...(resolution ? { resolution } : {}) }).where('id', '=', id).execute();
    await audit(trx, actor, 'warranty.status', 'warranty_case', id, { from, to });
    return { changed: true };
  });
}

export const zWarrantyList = zPageQuery.extend({ status: z.enum(WARRANTY_STATUS).optional(), saleId: zUuid.optional() });

export async function listWarrantyCases(deps: AppDeps, actor: Actor, q: z.infer<typeof zWarrantyList>) {
  requirePermission(actor, 'sales.view');
  const offset = decodeCursor(q.cursor);
  return tx(deps, actor, async (trx) => {
    let query = trx
      .selectFrom('warranty_cases as w')
      .innerJoin('sales as s', 's.id', 'w.sale_id')
      .leftJoin('parties as p', 'p.id', 'w.party_id')
      .leftJoin('sale_items as si', 'si.id', 'w.sale_item_id')
      .select(['w.id', 'w.number', 'w.status', 'w.description', 'w.resolution', 'w.created_at', 'w.sale_id', 's.number as sale_number', 'p.name as party_name', 'si.description as item_description']);
    if (q.status) query = query.where('w.status', '=', q.status);
    if (q.saleId) query = query.where('w.sale_id', '=', q.saleId);
    const rows = await query.orderBy('w.number', 'desc').limit(q.limit + 1).offset(offset).execute();
    return pageOf(rows, offset, q.limit);
  });
}

/** Solicita o termo de garantia em PDF (gerado pelo worker a partir do snapshot). */
export async function requestWarrantyDocument(deps: AppDeps, actor: Actor, id: string) {
  requirePermission(actor, 'sales.view');
  return tx(deps, actor, async (trx) => {
    const w = await trx.selectFrom('warranty_cases').select('id').where('id', '=', id).executeTakeFirst();
    if (!w) throw notFound('Caso de garantia');
    return { id: await requestDocument(trx, actor, 'warranty', 'warranty_case', id) };
  });
}
