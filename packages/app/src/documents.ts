import { createHash } from 'node:crypto';
import { jsonb, nextNumber, sql, withTenant, type Tx } from '@gct/db';
import { conflict, notFound } from '@gct/shared';
import { audit, emit, requirePermission, tx, type Actor, type AppDeps } from './core';
import { renderDocumentPdf } from './pdf';

export type DocType = 'sale_receipt' | 'purchase_term' | 'trade_summary' | 'quote' | 'return_receipt' | 'warranty';

export const TEMPLATE_VERSION: Record<DocType, string> = {
  sale_receipt: 'recibo-venda@1',
  purchase_term: 'termo-aquisicao@1',
  trade_summary: 'resumo-troca@1',
  quote: 'orcamento@1',
  return_receipt: 'comprovante-devolucao@1',
  warranty: 'garantia@1',
};

export const DOC_LABEL: Record<DocType, string> = {
  sale_receipt: 'Recibo de venda',
  purchase_term: 'Termo de aquisição',
  trade_summary: 'Resumo da troca',
  quote: 'Orçamento',
  return_receipt: 'Comprovante de devolução',
  warranty: 'Termo de garantia',
};

async function companySnapshot(trx: Tx) {
  const t = await trx.selectFrom('tenants').select(['name', 'legal_name', 'document', 'phone', 'email', 'address', 'settings']).executeTakeFirstOrThrow();
  const settings = t.settings as { warrantyTerms?: string; receiptFooter?: string };
  return {
    name: t.name, legalName: t.legal_name, document: t.document, phone: t.phone, email: t.email, address: t.address,
    warrantyTerms: settings.warrantyTerms ?? null, receiptFooter: settings.receiptFooter ?? null,
  };
}

async function partySnapshot(trx: Tx, id: string | null) {
  if (!id) return null;
  const p = await trx.selectFrom('parties').select(['name', 'document', 'phone', 'email', 'person_type']).where('id', '=', id).executeTakeFirst();
  return p ? { name: p.name, document: p.document, phone: p.phone, email: p.email, personType: p.person_type } : null;
}

async function unitIdentifiers(trx: Tx, unitId: string | null) {
  if (!unitId) return [];
  return trx.selectFrom('unit_identifiers').select(['kind', 'value']).where('unit_id', '=', unitId).orderBy('kind').execute();
}

/**
 * Snapshot congelado na transação da operação: partes, valores e termos da época.
 * Nunca contém custo ou margem (documento vai ao cliente/fornecedor).
 */
async function buildSnapshot(trx: Tx, docType: DocType, sourceId: string): Promise<Record<string, unknown>> {
  const company = await companySnapshot(trx);
  switch (docType) {
    case 'quote': {
      const s = await trx.selectFrom('sales').selectAll().where('id', '=', sourceId).executeTakeFirstOrThrow();
      const payload = s.draft_payload as { items?: { variantId: string; quantity: number; unitPriceCents: string; discountCents?: string }[] };
      const ids = (payload.items ?? []).map((i) => i.variantId);
      const vs = ids.length
        ? await trx.selectFrom('product_variants as v').innerJoin('products as p', 'p.id', 'v.product_id').select(['v.id', 'v.sku', 'v.label', 'p.name']).where('v.id', 'in', ids).execute()
        : [];
      const items = (payload.items ?? []).map((i) => {
        const v = vs.find((x) => x.id === i.variantId);
        const unit = BigInt(i.unitPriceCents);
        const disc = BigInt(i.discountCents ?? '0');
        return { description: v ? `${v.name}${v.label ? ` ${v.label}` : ''}` : 'Item', sku: v?.sku ?? '', quantity: i.quantity, unit_price_cents: unit, total_cents: unit * BigInt(i.quantity) - disc, identifiers: [] };
      });
      return {
        company, customer: await partySnapshot(trx, s.customer_id), number: null, date: s.sale_date, validUntil: s.valid_until, items,
        subtotalCents: s.subtotal_cents, discountCents: s.discount_cents, shippingCents: s.shipping_cents, totalCents: s.total_cents, payments: [], notes: s.notes,
      };
    }
    case 'sale_receipt': {
      const s = await trx.selectFrom('sales').selectAll().where('id', '=', sourceId).executeTakeFirstOrThrow();
      const items = await trx
        .selectFrom('sale_items as si')
        .innerJoin('product_variants as v', 'v.id', 'si.variant_id')
        .innerJoin('products as p', 'p.id', 'v.product_id')
        .select(['si.description', 'si.sku', 'si.quantity', 'si.unit_price_cents', 'si.gross_cents', 'si.line_discount_cents', 'si.total_cents', 'si.unit_id', 'p.warranty_days'])
        .where('si.sale_id', '=', sourceId)
        .orderBy('si.position')
        .execute();
      const withIds = [];
      for (const i of items) withIds.push({ ...i, identifiers: await unitIdentifiers(trx, i.unit_id), unit_id: undefined });
      const payments = await trx.selectFrom('sale_payments').select(['method_name', 'kind', 'amount_cents', 'installments', 'first_due_date']).where('sale_id', '=', sourceId).orderBy('position').execute();
      return {
        company, customer: await partySnapshot(trx, s.customer_id), number: s.number?.toString() ?? null, date: s.sale_date, validUntil: s.valid_until,
        items: withIds, subtotalCents: s.subtotal_cents, discountCents: s.discount_cents, shippingCents: s.shipping_cents, totalCents: s.total_cents,
        payments, notes: s.notes, origin: s.origin,
      };
    }
    case 'purchase_term': {
      const p = await trx.selectFrom('purchases').selectAll().where('id', '=', sourceId).executeTakeFirstOrThrow();
      const items = await trx.selectFrom('purchase_items').select(['id', 'description', 'quantity', 'unit_cost_cents', 'landed_cost_cents', 'unit_specs']).where('purchase_id', '=', sourceId).orderBy('position').execute();
      const units = await trx
        .selectFrom('goods_receipt_items as gi')
        .innerJoin('goods_receipts as gr', 'gr.id', 'gi.receipt_id')
        .innerJoin('inventory_units as u', 'u.id', 'gi.unit_id')
        .select(['gi.purchase_item_id', 'u.id', 'u.internal_code', 'u.condition', 'u.accessories', 'u.defects', 'u.battery_health_pct'])
        .where('gr.purchase_id', '=', sourceId)
        .execute();
      const unitsFull: (typeof units[number] & { identifiers: { kind: string; value: string }[] })[] = [];
      for (const u of units) unitsFull.push({ ...u, identifiers: await unitIdentifiers(trx, u.id) });
      return {
        company, supplier: await partySnapshot(trx, p.supplier_id), number: p.number?.toString() ?? null, date: p.purchase_date, origin: p.origin,
        items: items.map((i) => ({ description: i.description, quantity: i.quantity, unitCostCents: i.unit_cost_cents, units: unitsFull.filter((u) => u.purchase_item_id === i.id) })),
        totalCents: p.total_cents,
        declaration:
          'O vendedor declara ser o legítimo proprietário dos itens, que não possuem restrição conhecida, e concorda com os valores acima. ' +
          'Verificações em bases externas só constam neste termo quando registradas com evidência.',
      };
    }
    case 'trade_summary': {
      const t = await trx.selectFrom('trades').selectAll().where('id', '=', sourceId).executeTakeFirstOrThrow();
      const out = await trx.selectFrom('sale_items').select(['description', 'quantity', 'unit_price_cents', 'total_cents', 'unit_id']).where('sale_id', '=', t.sale_id).orderBy('position').execute();
      const outFull = [];
      for (const o of out) outFull.push({ ...o, identifiers: await unitIdentifiers(trx, o.unit_id), unit_id: undefined });
      const inc = await trx
        .selectFrom('trade_valuations as tv')
        .innerJoin('purchase_items as pi', 'pi.id', 'tv.purchase_item_id')
        .select(['pi.description', 'pi.quantity', 'tv.agreed_cents', 'tv.condition', 'tv.identifiers', 'tv.notes'])
        .where('tv.trade_id', '=', sourceId)
        .orderBy('tv.position')
        .execute();
      const payments = await trx.selectFrom('sale_payments').select(['method_name', 'kind', 'amount_cents', 'installments']).where('sale_id', '=', t.sale_id).where('kind', '<>', 'trade_offset').orderBy('position').execute();
      return {
        company, party: await partySnapshot(trx, t.party_id), number: t.number.toString(), date: t.confirmed_at,
        outgoing: outFull, incoming: inc, saleTotalCents: t.sale_total_cents, purchaseTotalCents: t.purchase_total_cents,
        offsetCents: t.offset_cents, differenceCents: t.difference_cents, differencePolicy: t.difference_policy, differencePayments: payments,
      };
    }
    case 'return_receipt': {
      const r = await trx.selectFrom('returns').selectAll().where('id', '=', sourceId).executeTakeFirstOrThrow();
      const s = await trx.selectFrom('sales').select(['number', 'customer_id', 'sale_date']).where('id', '=', r.sale_id).executeTakeFirstOrThrow();
      const items = await trx
        .selectFrom('return_items as ri')
        .innerJoin('sale_items as si', 'si.id', 'ri.sale_item_id')
        .select(['si.description', sql<number>`sum(ri.quantity) filter (where ri.revenue_cents > 0 or si.product_kind = 'service')::int`.as('quantity'), sql<bigint>`sum(ri.revenue_cents)`.as('revenue_cents')])
        .where('ri.return_id', '=', sourceId)
        .groupBy('si.description')
        .execute();
      return {
        company, customer: await partySnapshot(trx, s.customer_id), number: r.number.toString(), date: r.created_at, saleNumber: s.number?.toString(), saleDate: s.sale_date,
        kind: r.kind, reason: r.reason, items, revenueCents: r.revenue_cents, reducedBalanceCents: r.reduced_balance_cents, refundCents: r.refund_cents, storeCreditCents: r.store_credit_cents,
      };
    }
    case 'warranty': {
      const w = await trx.selectFrom('warranty_cases').selectAll().where('id', '=', sourceId).executeTakeFirstOrThrow();
      return { company, party: await partySnapshot(trx, w.party_id), number: w.number.toString(), date: w.created_at, description: w.description, terms: w.warranty_terms_snapshot, status: w.status };
    }
  }
}

/** Cria o registro do documento (snapshot + número) e agenda a geração do PDF. */
export async function requestDocument(trx: Tx, actor: Pick<Actor, 'tenantId' | 'userId'>, docType: DocType, sourceType: string, sourceId: string): Promise<string> {
  const existing = await trx.selectFrom('documents').select('id').where('doc_type', '=', docType).where('source_id', '=', sourceId).executeTakeFirst();
  if (existing) return existing.id;
  const snapshot = await buildSnapshot(trx, docType, sourceId);
  const number = await nextNumber(trx, actor.tenantId, `doc_${docType}`);
  const doc = await trx
    .insertInto('documents')
    .values({
      tenant_id: actor.tenantId, doc_type: docType, number, source_type: sourceType, source_id: sourceId,
      template_version: TEMPLATE_VERSION[docType], snapshot: jsonb({ ...snapshot, docNumber: number.toString(), docType }), created_by: actor.userId,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  await emit(trx, actor.tenantId, 'DocumentRequested', { documentId: doc.id });
  return doc.id;
}

/**
 * Gera o PDF a partir do snapshot (fora da transação de negócio). Idempotente:
 * documento pronto não é regerado. Falha não desfaz a operação de origem.
 */
export async function generateDocument(deps: AppDeps, tenantId: string, documentId: string): Promise<'ready' | 'skipped'> {
  const doc = await withTenant(deps.dbs.app, { tenantId }, (trx) =>
    trx.selectFrom('documents').selectAll().where('id', '=', documentId).executeTakeFirst(),
  );
  if (!doc) throw notFound('Documento');
  if (doc.status === 'ready') return 'skipped';
  try {
    const pdf = await renderDocumentPdf(doc.doc_type as DocType, doc.snapshot as Record<string, unknown>, doc.template_version);
    const sha = createHash('sha256').update(pdf).digest('hex');
    const key = `${tenantId}/documents/${doc.doc_type}/${doc.id}.pdf`;
    await deps.storage.put(key, pdf, 'application/pdf');
    await withTenant(deps.dbs.app, { tenantId }, (trx) =>
      trx.updateTable('documents').set({ status: 'ready', storage_key: key, sha256: sha, generated_at: new Date(), attempts: doc.attempts + 1, last_error: null }).where('id', '=', doc.id).execute(),
    );
    return 'ready';
  } catch (e) {
    await withTenant(deps.dbs.app, { tenantId }, (trx) =>
      trx.updateTable('documents').set({ status: 'failed', attempts: doc.attempts + 1, last_error: (e as Error).message.slice(0, 500) }).where('id', '=', doc.id).execute(),
    );
    throw e;
  }
}

export async function listDocuments(deps: AppDeps, actor: Actor, sourceId?: string) {
  requirePermission(actor, 'sales.view');
  return tx(deps, actor, (trx) => {
    let q = trx.selectFrom('documents').select(['id', 'doc_type', 'number', 'source_type', 'source_id', 'status', 'last_error', 'created_at', 'generated_at', 'sha256']);
    if (sourceId) q = q.where('source_id', '=', sourceId);
    return q.orderBy('created_at', 'desc').limit(200).execute();
  });
}

/** Download autenticado: RLS garante que só a empresa dona encontra o documento. */
export async function readDocumentPdf(deps: AppDeps, actor: Actor, id: string): Promise<{ filename: string; data: Buffer }> {
  requirePermission(actor, 'sales.view');
  const doc = await tx(deps, actor, (trx) => trx.selectFrom('documents').select(['doc_type', 'number', 'status', 'storage_key']).where('id', '=', id).executeTakeFirst());
  if (!doc) throw notFound('Documento');
  if (doc.status !== 'ready' || !doc.storage_key) throw conflict('Documento ainda não foi gerado. Tente novamente em instantes ou reprocesse.');
  return { filename: `${doc.doc_type}-${doc.number}.pdf`, data: await deps.storage.get(doc.storage_key) };
}

/** Reprocessa documento com falha (operador autorizado). */
export async function retryDocument(deps: AppDeps, actor: Actor, id: string) {
  requirePermission(actor, 'sales.view');
  await tx(deps, actor, async (trx) => {
    const d = await trx.selectFrom('documents').select(['status']).where('id', '=', id).executeTakeFirst();
    if (!d) throw notFound('Documento');
    if (d.status === 'ready') throw conflict('Documento já gerado.');
    await trx.updateTable('documents').set({ status: 'pending' }).where('id', '=', id).execute();
    await emit(trx, actor.tenantId, 'DocumentRequested', { documentId: id, retry: true });
    await audit(trx, actor, 'document.retry', 'document', id);
  });
}

/** Solicita documento avulso (orçamento de rascunho, termo de garantia). */
export async function requestDocumentAction(deps: AppDeps, actor: Actor, docType: DocType, sourceType: string, sourceId: string) {
  requirePermission(actor, 'sales.view');
  return tx(deps, actor, async (trx) => ({ id: await requestDocument(trx, actor, docType, sourceType, sourceId) }));
}
