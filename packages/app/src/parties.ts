import { z } from 'zod';
import { sql } from '@gct/db';
import { conflict, invalid, normalizeDocument, normalizeSearch, notFound } from '@gct/shared';
import { audit, can, isUniqueViolation, requirePermission, requireWritable, tx, type Actor, type AppDeps } from './core';
import { decodeCursor, pageOf, zPageQuery, zText } from './validation';

export const zParty = z.object({
  personType: z.enum(['PF', 'PJ']).default('PF'),
  name: zText(160).min(1, 'Informe o nome'),
  tradeName: zText(160).optional().nullable(),
  document: zText(20).optional().nullable(),
  email: z.string().trim().email('E-mail inválido').max(160).optional().nullable().or(z.literal('')),
  phone: zText(30).optional().nullable(),
  address: z
    .object({
      street: zText(160).optional(),
      number: zText(20).optional(),
      district: zText(80).optional(),
      zip: zText(12).optional(),
      complement: zText(80).optional(),
    })
    .optional()
    .default({}),
  city: zText(80).optional().nullable(),
  state: zText(2).optional().nullable(),
  isCustomer: z.boolean().default(true),
  isSupplier: z.boolean().default(false),
  notes: zText(2000).optional().nullable(),
});
export type PartyInput = z.input<typeof zParty>;

function validDocument(doc: string, type: 'PF' | 'PJ'): boolean {
  if (type === 'PF' && doc.length !== 11) return false;
  if (type === 'PJ' && doc.length !== 14) return false;
  if (/^(\d)\1+$/.test(doc)) return false;
  const digits = doc.split('').map(Number);
  const calc = (len: number, weights: number[]) => {
    const sum = weights.reduce((acc, w, i) => acc + digits[i]! * w, 0);
    const r = sum % 11;
    return r < 2 ? 0 : 11 - r;
  };
  if (type === 'PF') {
    const w1 = [10, 9, 8, 7, 6, 5, 4, 3, 2];
    const w2 = [11, 10, 9, 8, 7, 6, 5, 4, 3, 2];
    return calc(9, w1) === digits[9] && calc(10, w2) === digits[10];
  }
  const w1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const w2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  return calc(12, w1) === digits[12] && calc(13, w2) === digits[13];
}

function prepare(input: z.infer<typeof zParty>) {
  if (!input.isCustomer && !input.isSupplier) throw invalid('Marque cliente, fornecedor ou ambos.', { isCustomer: 'obrigatório' });
  const docNorm = input.document ? normalizeDocument(input.document) : '';
  if (docNorm && !validDocument(docNorm, input.personType))
    throw invalid(input.personType === 'PF' ? 'CPF inválido.' : 'CNPJ inválido.', { document: 'inválido' });
  const phoneNorm = input.phone ? input.phone.replace(/\D/g, '') : '';
  return {
    person_type: input.personType,
    name: input.name,
    trade_name: input.tradeName || null,
    document: input.document || null,
    document_normalized: docNorm || null,
    email: input.email || null,
    phone: input.phone || null,
    phone_normalized: phoneNorm || null,
    address: JSON.stringify(input.address ?? {}),
    city: input.city || null,
    state: input.state ? input.state.toUpperCase() : null,
    is_customer: input.isCustomer,
    is_supplier: input.isSupplier,
    notes: input.notes || null,
    search_text: normalizeSearch([input.name, input.tradeName ?? '', input.email ?? '', phoneNorm, docNorm].join(' ')),
  };
}

export async function createParty(deps: AppDeps, actor: Actor, input: z.infer<typeof zParty>) {
  requirePermission(actor, 'parties.manage');
  requireWritable(actor);
  const values = prepare(input);
  return tx(deps, actor, async (trx) => {
    try {
      const row = await trx
        .insertInto('parties')
        .values({ tenant_id: actor.tenantId, ...values, created_by: actor.userId })
        .returning(['id', 'name'])
        .executeTakeFirstOrThrow();
      await audit(trx, actor, 'party.created', 'party', row.id, { roles: { customer: input.isCustomer, supplier: input.isSupplier } });
      return row;
    } catch (e) {
      if (isUniqueViolation(e)) {
        // Deduplicação: aponta a ficha existente para reaproveitar (cliente e fornecedor na mesma ficha).
        const existing = await trx.selectFrom('parties').select(['id', 'name']).where('document_normalized', '=', values.document_normalized).executeTakeFirst();
        throw conflict(`Já existe cadastro com este documento${existing ? `: ${existing.name}` : ''}. Edite a ficha existente para acrescentar o papel.`);
      }
      throw e;
    }
  });
}

export async function updateParty(deps: AppDeps, actor: Actor, id: string, input: z.infer<typeof zParty>) {
  requirePermission(actor, 'parties.manage');
  requireWritable(actor);
  const values = prepare(input);
  return tx(deps, actor, async (trx) => {
    try {
      const r = await trx.updateTable('parties').set(values).where('id', '=', id).where('status', '=', 'active').executeTakeFirst();
      if (!r.numUpdatedRows) throw notFound('Cadastro');
    } catch (e) {
      if (isUniqueViolation(e)) throw conflict('Outro cadastro já usa este documento.');
      throw e;
    }
    await audit(trx, actor, 'party.updated', 'party', id);
  });
}

/** Arquivar mantém todo o histórico. */
export async function setPartyStatus(deps: AppDeps, actor: Actor, id: string, status: 'active' | 'archived') {
  requirePermission(actor, 'parties.manage');
  requireWritable(actor);
  return tx(deps, actor, async (trx) => {
    const r = await trx.updateTable('parties').set({ status }).where('id', '=', id).executeTakeFirst();
    if (!r.numUpdatedRows) throw notFound('Cadastro');
    await audit(trx, actor, `party.${status}`, 'party', id);
  });
}

export const zPartyList = zPageQuery.extend({
  q: z.string().max(100).optional(),
  role: z.enum(['customer', 'supplier', 'all']).default('all'),
  status: z.enum(['active', 'archived', 'all']).default('active'),
});

export async function listParties(deps: AppDeps, actor: Actor, q: z.infer<typeof zPartyList>) {
  requirePermission(actor, 'parties.view');
  const offset = decodeCursor(q.cursor);
  const showDoc = can(actor, 'parties.manage');
  return tx(deps, actor, async (trx) => {
    let query = trx
      .selectFrom('parties as p')
      .select([
        'p.id', 'p.person_type', 'p.name', 'p.trade_name', 'p.email', 'p.phone', 'p.city', 'p.state', 'p.is_customer',
        'p.is_supplier', 'p.status', 'p.created_at',
        ...(showDoc ? (['p.document'] as const) : []),
        sql<bigint>`coalesce((select sum(t.balance_cents) from financial_titles t where t.party_id = p.id and t.direction = 'receivable' and t.status in ('open','partially_settled')), 0)`.as('receivable_cents'),
        sql<bigint>`coalesce((select balance_cents from store_credit_balances c where c.party_id = p.id), 0)`.as('store_credit_cents'),
        sql<number>`count(*) over ()::int`.as('total'),
      ]);
    if (q.status !== 'all') query = query.where('p.status', '=', q.status);
    if (q.role === 'customer') query = query.where('p.is_customer', '=', true);
    if (q.role === 'supplier') query = query.where('p.is_supplier', '=', true);
    if (q.q) {
      const n = normalizeSearch(q.q).replace(/[%_]/g, '');
      const digits = q.q.replace(/\D/g, '');
      query = query.where((eb) =>
        eb.or([
          eb('p.search_text', 'like', `%${n}%`),
          ...(digits.length >= 4 ? [eb('p.document_normalized', '=', digits), eb('p.phone_normalized', 'like', `%${digits}%`)] : []),
        ]),
      );
    }
    const rows = await query.orderBy('p.name').orderBy('p.id').limit(q.limit + 1).offset(offset).execute();
    const total = rows[0]?.total ?? 0;
    return pageOf(rows.map(({ total: _t, ...r }) => r), offset, q.limit, total);
  });
}

/** Ficha: dados, histórico de vendas/compras/trocas, títulos e crédito. */
export async function getParty(deps: AppDeps, actor: Actor, id: string) {
  requirePermission(actor, 'parties.view');
  return tx(deps, actor, async (trx) => {
    const party = await trx.selectFrom('parties').selectAll().where('id', '=', id).executeTakeFirst();
    if (!party) throw notFound('Cadastro');
    const { search_text: _s, document_normalized: _d, phone_normalized: _p, ...pub } = party;
    const safe = can(actor, 'parties.manage') ? pub : { ...pub, document: null };
    const sales = can(actor, 'sales.view')
      ? await trx
          .selectFrom('sales')
          .select(['id', 'number', 'status', 'sale_date', 'total_cents', 'origin'])
          .where('customer_id', '=', id)
          .where('status', '<>', 'draft')
          .orderBy('sale_date', 'desc')
          .limit(50)
          .execute()
      : [];
    const purchases = can(actor, 'purchases.manage') || can(actor, 'finance.view')
      ? await trx
          .selectFrom('purchases')
          .select(['id', 'number', 'status', 'purchase_date', 'total_cents', 'origin'])
          .where('supplier_id', '=', id)
          .orderBy('purchase_date', 'desc')
          .limit(50)
          .execute()
      : [];
    const trades = await trx
      .selectFrom('trades')
      .select(['id', 'number', 'status', 'confirmed_at', 'sale_total_cents', 'purchase_total_cents', 'difference_cents'])
      .where('party_id', '=', id)
      .orderBy('confirmed_at', 'desc')
      .limit(50)
      .execute();
    const titles = can(actor, 'finance.view')
      ? await trx
          .selectFrom('financial_titles')
          .select(['id', 'direction', 'description', 'due_date', 'original_cents', 'balance_cents', 'status'])
          .where('party_id', '=', id)
          .where('status', 'in', ['open', 'partially_settled'])
          .orderBy('due_date')
          .execute()
      : [];
    const credit = await trx.selectFrom('store_credit_balances').select('balance_cents').where('party_id', '=', id).executeTakeFirst();
    const creditEntries = await trx
      .selectFrom('store_credit_entries')
      .select(['id', 'kind', 'amount_cents', 'balance_after_cents', 'origin_type', 'reason', 'created_at'])
      .where('party_id', '=', id)
      .orderBy('created_at', 'desc')
      .limit(50)
      .execute();
    return { party: safe, sales, purchases, trades, titles, storeCreditCents: credit?.balance_cents ?? 0n, creditEntries };
  });
}
