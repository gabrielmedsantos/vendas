import { z } from 'zod';
import { sql, type Tx } from '@gct/db';
import { addDays, invalid } from '@gct/shared';
import { requirePermission, todayLocal, tx, type Actor, type AppDeps } from './core';
import { decodeCursor, pageOf, zLocalDate, zPageQuery, zUuid } from './validation';

/**
 * Fluxo de caixa: dinheiro que efetivamente entrou e saiu das contas, com a origem de cada
 * movimento (venda, compra, despesa, aporte…). Só leitura do livro de caixa (cash_movements),
 * que é imutável; correções aparecem como estornos vinculados.
 */

export const CASH_CATEGORIES = ['sale', 'trade', 'purchase', 'expense', 'acquisition_cost', 'refund', 'receipt', 'payment', 'capital', 'adjustment', 'transfer'] as const;
export type CashCategory = (typeof CASH_CATEGORIES)[number];

export const CASH_CATEGORY_LABEL: Record<CashCategory, string> = {
  sale: 'Vendas',
  trade: 'Trocas',
  purchase: 'Compras de mercadoria',
  expense: 'Despesas',
  acquisition_cost: 'Custos de aquisição',
  refund: 'Reembolsos a clientes',
  receipt: 'Recebimentos avulsos',
  payment: 'Pagamentos avulsos',
  capital: 'Aportes, retiradas e empréstimos',
  adjustment: 'Ajustes e estornos',
  transfer: 'Transferências entre contas',
};

export const zCashFlow = zPageQuery.extend({
  from: zLocalDate.optional(),
  to: zLocalDate.optional(),
  accountId: zUuid.optional(),
  direction: z.enum(['in', 'out']).optional(),
  category: z.enum(CASH_CATEGORIES).optional(),
  q: z.string().trim().max(80).optional(),
});

/** Classificação de cada movimento (mesma regra do "De onde vem o saldo"). */
const BASE = (from: string, to: string, accountId?: string) => sql`
  select m.id, m.occurred_on, m.direction, m.amount_cents, m.kind, m.origin_type, m.description, m.account_id, a.name as account_name,
         m.created_at, m.reversal_of,
         exists (select 1 from cash_movements r where r.reversal_of = m.id) as reversed,
         movement_of_deleted_sale(m.origin_type, m.origin_id) as hidden,
         t.origin_type as title_origin, t.origin_id as title_origin_id, t.description as title_description, p.name as party_name,
         case
           when m.kind in ('transfer_in', 'transfer_out') then 'transfer'
           when t.origin_type = 'manual' then case when m.direction = 'in' then 'receipt' else 'payment' end
           when t.origin_type is not null then t.origin_type
           when m.kind in ('opening', 'capital_in', 'withdrawal', 'loan_in', 'loan_out') then 'capital'
           when m.kind in ('cash_adjustment', 'reversal') then 'adjustment'
           else case when m.direction = 'in' then 'receipt' else 'payment' end
         end as category
  from cash_movements m
  join financial_accounts a on a.id = m.account_id
  left join lateral (
    select tt.origin_type, tt.origin_id, tt.description, tt.party_id
    from settlement_allocations sa join financial_titles tt on tt.id = sa.title_id
    where m.origin_type in ('settlement', 'settlement_reversal') and sa.settlement_id = m.origin_id
    order by sa.amount_cents desc, tt.id
    limit 1
  ) t on true
  left join parties p on p.id = t.party_id
  where m.occurred_on between ${from}::date and ${to}::date
    ${accountId ? sql`and m.account_id = ${accountId}` : sql``}`;

function monthRange(today: string) {
  const from = `${today.slice(0, 7)}-01`;
  const [y, mo] = [Number(today.slice(0, 4)), Number(today.slice(5, 7))];
  const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return { from, to: `${today.slice(0, 7)}-${String(last).padStart(2, '0')}` };
}

async function balanceBefore(trx: Tx, date: string, accountId?: string): Promise<bigint> {
  const r = await sql<{ b: bigint }>`
    select coalesce(sum(case when direction = 'in' then amount_cents else -amount_cents end), 0)::bigint as b
    from cash_movements where occurred_on < ${date}::date ${accountId ? sql`and account_id = ${accountId}` : sql``}`.execute(trx);
  return BigInt(r.rows[0]!.b);
}

export async function cashFlow(deps: AppDeps, actor: Actor, q: z.infer<typeof zCashFlow>) {
  requirePermission(actor, 'finance.view');
  const today = todayLocal(actor.timezone);
  const def = monthRange(today);
  const from = q.from ?? def.from;
  const to = q.to ?? def.to;
  if (from > to) throw invalid('A data inicial deve ser antes da final.');
  if (addDays(from, 400) < to) throw invalid('Escolha um período de até 400 dias.');
  const offset = decodeCursor(q.cursor);
  return tx(deps, actor, async (trx) => {
    // Sem filtro de conta, transferências internas se anulam e ficam fora dos totais.
    const countTransfers = !!q.accountId;
    const totals = await sql<{ category: CashCategory; direction: 'in' | 'out'; cents: bigint; n: number }>`
      with base as (${BASE(from, to, q.accountId)})
      select category, direction, sum(amount_cents)::bigint as cents, count(*)::int as n from base where not hidden group by 1, 2`.execute(trx);
    let inCents = 0n;
    let outCents = 0n;
    const byCat = new Map<string, { category: CashCategory; label: string; inCents: bigint; outCents: bigint; count: number }>();
    for (const r of totals.rows) {
      if (r.category === 'transfer' && !countTransfers) continue;
      const c = BigInt(r.cents);
      if (r.direction === 'in') inCents += c; else outCents += c;
      const cur = byCat.get(r.category) ?? { category: r.category, label: CASH_CATEGORY_LABEL[r.category], inCents: 0n, outCents: 0n, count: 0 };
      if (r.direction === 'in') cur.inCents += c; else cur.outCents += c;
      cur.count += r.n;
      byCat.set(r.category, cur);
    }
    const opening = await balanceBefore(trx, from, q.accountId);
    // Fechamento inclui transferências (por conta elas mudam o saldo; no total se anulam).
    const net = await sql<{ b: bigint }>`
      with base as (${BASE(from, to, q.accountId)})
      select coalesce(sum(case when direction = 'in' then amount_cents else -amount_cents end), 0)::bigint as b from base`.execute(trx);
    const closing = opening + BigInt(net.rows[0]!.b);

    const daily = await sql<{ day: string; in_cents: bigint; out_cents: bigint; net_cents: bigint }>`
      with base as (${BASE(from, to, q.accountId)})
      select to_char(d::date, 'YYYY-MM-DD') as day,
             coalesce(sum(b.amount_cents) filter (where b.direction = 'in' and not b.hidden and (${countTransfers} or b.category <> 'transfer')), 0)::bigint as in_cents,
             coalesce(sum(b.amount_cents) filter (where b.direction = 'out' and not b.hidden and (${countTransfers} or b.category <> 'transfer')), 0)::bigint as out_cents,
             coalesce(sum(case when b.direction = 'in' then b.amount_cents else -b.amount_cents end), 0)::bigint as net_cents
      from generate_series(${from}::date, ${to}::date, interval '1 day') d
      left join base b on b.occurred_on = d::date
      group by d order by d`.execute(trx);
    let running = opening;
    const series = daily.rows.map((r) => {
      running += BigInt(r.net_cents);
      return { day: r.day, inCents: BigInt(r.in_cents), outCents: BigInt(r.out_cents), balanceCents: r.day <= today ? running : null };
    });

    const term = q.q?.replace(/[%_]/g, '');
    const list = await sql<Record<string, unknown> & { total: number }>`
      with base as (${BASE(from, to, q.accountId)})
      select b.*, count(*) over ()::int as total from base b
      where not b.hidden
        ${q.direction ? sql`and b.direction = ${q.direction}` : sql``}
        ${q.category ? sql`and b.category = ${q.category}` : sql``}
        ${term ? sql`and (coalesce(b.description, '') ilike ${'%' + term + '%'} or coalesce(b.title_description, '') ilike ${'%' + term + '%'}
                       or coalesce(b.party_name, '') ilike ${'%' + term + '%'} or b.account_name ilike ${'%' + term + '%'}
                       or (b.amount_cents / 100)::text = ${term.replace(/\./g, '').replace(/,\d*$/, '')})` : sql``}
      order by b.occurred_on desc, b.created_at desc, b.id
      limit ${q.limit + 1} offset ${offset}`.execute(trx);
    const total = list.rows[0]?.total ?? 0;
    const rows = list.rows.map(({ total: _t, ...r }) => ({ ...r, category_label: CASH_CATEGORY_LABEL[r.category as CashCategory] }));

    const open = await sql<{ direction: string; cents: bigint; overdue: bigint }>`
      select direction, coalesce(sum(balance_cents), 0)::bigint as cents,
             coalesce(sum(balance_cents) filter (where due_date < ${today}::date), 0)::bigint as overdue
      from financial_titles where status in ('open', 'partially_settled') group by direction`.execute(trx);
    const pick = (d: string) => open.rows.find((o) => o.direction === d);
    const balanceNow = await balanceBefore(trx, addDays(today, 1), q.accountId);

    return {
      period: { from, to },
      summary: {
        openingCents: opening, inCents, outCents, netCents: inCents - outCents, closingCents: closing, balanceNowCents: balanceNow,
        openReceivableCents: BigInt(pick('receivable')?.cents ?? 0), overdueReceivableCents: BigInt(pick('receivable')?.overdue ?? 0),
        openPayableCents: BigInt(pick('payable')?.cents ?? 0), overduePayableCents: BigInt(pick('payable')?.overdue ?? 0),
      },
      byCategory: [...byCat.values()].sort((a, b) => { const d = b.inCents + b.outCents - (a.inCents + a.outCents); return d > 0n ? 1 : d < 0n ? -1 : 0; }),
      series,
      ...pageOf(rows, offset, q.limit, total),
    };
  });
}

