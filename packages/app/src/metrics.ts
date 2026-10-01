import { z } from 'zod';
import { sql, type Tx } from '@gct/db';
import { computeManagementResult, growthBps, type ManagementResult, type PeriodFacts } from '@gct/domain';
import { addDays, daysBetween, invalid, monthRange, ratioBps, toCsv } from '@gct/shared';
import { can, requirePermission, todayLocal, tx, type Actor, type AppDeps } from './core';
import { zLocalDate } from './validation';

export const zPeriod = z.object({ from: zLocalDate.optional(), to: zLocalDate.optional(), preset: z.enum(['today', '7d', '30d', 'month', 'last_month', 'year']).optional() });

export function resolvePeriod(actor: Actor, q: z.infer<typeof zPeriod>): { from: string; to: string } {
  const today = todayLocal(actor.timezone);
  if (q.from && q.to) {
    if (q.from > q.to) throw invalid('Data inicial depois da final.');
    if (daysBetween(q.from, q.to) > 800) throw invalid('Período máximo de 800 dias.');
    return { from: q.from, to: q.to };
  }
  switch (q.preset ?? 'month') {
    case 'today':
      return { from: today, to: today };
    case '7d':
      return { from: addDays(today, -6), to: today };
    case '30d':
      return { from: addDays(today, -29), to: today };
    case 'last_month': {
      const m = monthRange(addDays(`${today.slice(0, 7)}-01`, -1));
      return m;
    }
    case 'year':
      return { from: `${today.slice(0, 4)}-01-01`, to: today };
    default:
      return { from: `${today.slice(0, 7)}-01`, to: today };
  }
}

function previousPeriod(p: { from: string; to: string }) {
  const len = daysBetween(p.from, p.to) + 1;
  return { from: addDays(p.from, -len), to: addDays(p.from, -1) };
}

/**
 * Fatos do período a partir dos livros (fonte única para painel, API e relatórios).
 * Datas locais: venda pela data de entrega; devolução, despesa e liquidação pela data local.
 */
export async function periodFacts(trx: Tx, from: string, to: string): Promise<PeriodFacts & { cashInCents: bigint; cashOutCents: bigint }> {
  const r = await sql<{
    revenue: bigint; cogs: bigint; channel: bigint; sales: number; units: number; ret_rev: bigint; ret_cogs: bigint;
    fees: bigint; expenses: bigint; extra_cogs: bigint; cash_in: bigint; cash_out: bigint;
  }>`
    with tz as (select timezone from tenants where id = app_tenant_id())
    select
      (select coalesce(sum(total_cents), 0) from sales where status not in ('draft', 'canceled') and sale_date between ${from}::date and ${to}::date) as revenue,
      (select coalesce(sum(cost_total_cents), 0) from sales where status not in ('draft', 'canceled') and sale_date between ${from}::date and ${to}::date) as cogs,
      (select coalesce(sum(channel_cost_cents), 0) from sales where status not in ('draft', 'canceled') and sale_date between ${from}::date and ${to}::date) as channel,
      (select count(*) from sales where status not in ('draft', 'canceled') and sale_date between ${from}::date and ${to}::date)::int as sales,
      (select coalesce(sum(si.quantity), 0) from sale_items si join sales s on s.id = si.sale_id
         where s.status not in ('draft', 'canceled') and s.sale_date between ${from}::date and ${to}::date and si.product_kind = 'physical')::int as units,
      (select coalesce(sum(revenue_cents), 0) from returns r where (r.created_at at time zone (select timezone from tz))::date between ${from}::date and ${to}::date) as ret_rev,
      (select coalesce(sum(cost_cents), 0) from returns r where (r.created_at at time zone (select timezone from tz))::date between ${from}::date and ${to}::date) as ret_cogs,
      (select coalesce(sum(case when reversal_of is null then fee_cents else -fee_cents end), 0) from settlements where direction = 'in' and settled_on between ${from}::date and ${to}::date) as fees,
      (select coalesce(sum(amount_cents), 0) from expenses where status = 'active' and competence_date between ${from}::date and ${to}::date) as expenses,
      (select coalesce(sum(to_cogs_cents), 0) from acquisition_costs where occurred_on between ${from}::date and ${to}::date) as extra_cogs,
      (select coalesce(sum(amount_cents), 0) from cash_movements where direction = 'in' and kind not in ('transfer_in', 'opening') and origin_type <> 'balance_adjustment' and occurred_on between ${from}::date and ${to}::date) as cash_in,
      (select coalesce(sum(amount_cents), 0) from cash_movements where direction = 'out' and kind not in ('transfer_out') and origin_type <> 'balance_adjustment' and occurred_on between ${from}::date and ${to}::date) as cash_out
  `.execute(trx);
  const f = r.rows[0]!;
  return {
    salesRevenueCents: f.revenue,
    returnsRevenueCents: f.ret_rev,
    cogsCents: f.cogs + f.extra_cogs,
    returnsCogsCents: f.ret_cogs,
    paymentFeesCents: f.fees,
    channelCostsCents: f.channel,
    operatingExpensesCents: f.expenses,
    salesCount: f.sales,
    unitsSold: f.units,
    cashInCents: f.cash_in,
    cashOutCents: f.cash_out,
  };
}

export interface MetricsView {
  period: { from: string; to: string };
  previous: { from: string; to: string };
  revenue: { netCents: bigint; grossSalesCents: bigint; returnsCents: bigint; growthBps: number | null };
  salesCount: number;
  unitsSold: number;
  averageTicketCents: bigint | null;
  result?: ManagementResult & { growthGrossBps: number | null };
  cash: { inCents: bigint; outCents: bigint; netCents: bigint };
  formulas: Record<string, string>;
}

export const FORMULAS = {
  netRevenue: 'Receita líquida = vendas entregues e confirmadas no período − devoluções/estornos do período.',
  cogs: 'CMV = custo histórico das saídas vendidas (FIFO ou custo da unidade) + ajustes de custo pós-venda − custo das devoluções.',
  grossProfit: 'Resultado bruto = receita líquida − CMV.',
  contribution: 'Após custos variáveis = resultado bruto − taxas de recebimento − comissões de canal.',
  operatingResult: 'Resultado operacional gerencial = após custos variáveis − despesas operacionais por competência (inclui perdas de estoque). Não é lucro líquido contábil.',
  margin: 'Margem = resultado / receita líquida × 100; sem receita positiva, "sem base".',
  cash: 'Caixa do período = entradas e saídas liquidadas nas contas (exclui transferências internas, saldo inicial e ajustes de saldo à conferência). Vendas a prazo só entram quando recebidas.',
  averageTicket: 'Ticket médio = receita comercial das vendas válidas / quantidade de vendas.',
};

export async function computeMetrics(trx: Tx, actor: Actor, period: { from: string; to: string }): Promise<MetricsView> {
  const prev = previousPeriod(period);
  const cur = await periodFacts(trx, period.from, period.to);
  const old = await periodFacts(trx, prev.from, prev.to);
  const res = computeManagementResult(cur);
  const oldRes = computeManagementResult(old);
  const view: MetricsView = {
    period,
    previous: prev,
    revenue: { netCents: res.netRevenueCents, grossSalesCents: cur.salesRevenueCents, returnsCents: cur.returnsRevenueCents, growthBps: growthBps(res.netRevenueCents, oldRes.netRevenueCents) },
    salesCount: cur.salesCount,
    unitsSold: cur.unitsSold,
    averageTicketCents: res.averageTicketCents,
    cash: { inCents: cur.cashInCents, outCents: cur.cashOutCents, netCents: cur.cashInCents - cur.cashOutCents },
    formulas: FORMULAS,
  };
  if (can(actor, 'costs.view')) view.result = { ...res, growthGrossBps: growthBps(res.grossProfitCents, oldRes.grossProfitCents) };
  return view;
}

export async function getMetrics(deps: AppDeps, actor: Actor, q: z.infer<typeof zPeriod>) {
  requirePermission(actor, 'dashboard.view');
  const period = resolvePeriod(actor, q);
  return tx(deps, actor, (trx) => computeMetrics(trx, actor, period));
}

/** Painel: métricas + pendências + atividade. Saldos atuais são rotulados como atuais. */
export async function getDashboard(deps: AppDeps, actor: Actor, q: z.infer<typeof zPeriod>) {
  requirePermission(actor, 'dashboard.view');
  const period = resolvePeriod(actor, q);
  const today = todayLocal(actor.timezone);
  const showCost = can(actor, 'costs.view');
  const showFinance = can(actor, 'finance.view');
  return tx(deps, actor, async (trx) => {
    const metrics = await computeMetrics(trx, actor, period);
    const daily = await sql<{ day: string; revenue: bigint; cost: bigint; count: number }>`
      select d::date::text as day,
             coalesce(sum(s.total_cents), 0) as revenue,
             coalesce(sum(s.cost_total_cents), 0) as cost,
             count(s.id)::int as count
      from generate_series(${period.from}::date, ${period.to}::date, interval '1 day') d
      left join sales s on s.sale_date = d::date and s.status not in ('draft', 'canceled')
      group by d order by d`.execute(trx);
    const byChannel = await sql<{ name: string; revenue: bigint; count: number }>`
      select coalesce(ch.name, 'Sem canal') as name, sum(s.total_cents) as revenue, count(*)::int as count
      from sales s left join sales_channels ch on ch.id = s.channel_id
      where s.status not in ('draft', 'canceled') and s.sale_date between ${period.from}::date and ${period.to}::date
      group by 1 order by 2 desc`.execute(trx);
    const byPayment = await sql<{ name: string; amount: bigint }>`
      select sp.method_name as name, sum(sp.amount_cents) as amount
      from sale_payments sp join sales s on s.id = sp.sale_id
      where s.status not in ('draft', 'canceled') and s.sale_date between ${period.from}::date and ${period.to}::date
      group by 1 order by 2 desc`.execute(trx);
    const recent = await trx
      .selectFrom('sales as s')
      .leftJoin('parties as c', 'c.id', 's.customer_id')
      .select(['s.id', 's.number', 's.sale_date', 's.total_cents', 's.status', 's.origin', 'c.name as customer_name'])
      .where('s.status', 'not in', ['draft', 'canceled'])
      .orderBy('s.confirmed_at', 'desc')
      .limit(6)
      .execute();
    const lowStock = await sql<{ product_id: string; name: string; sku: string; on_hand: number; min_stock: number }>`
      select p.id as product_id, p.name, v.sku, coalesce(b.on_hand, 0)::int as on_hand, v.min_stock
      from product_variants v join products p on p.id = v.product_id
      left join stock_balances b on b.variant_id = v.id
      where p.kind = 'physical' and p.status = 'active' and v.status = 'active' and v.min_stock > 0 and coalesce(b.on_hand, 0) <= v.min_stock
      order by coalesce(b.on_hand, 0) asc, p.name limit 8`.execute(trx);
    const inspection = await sql<{ n: number }>`select count(*)::int as n from inventory_lots where status = 'inspection' and qty_remaining > 0`.execute(trx);
    let finance: Record<string, unknown> | undefined;
    if (showFinance) {
      const open = await sql<{ receivable: bigint; payable: bigint; overdue_r: bigint; overdue_p: bigint }>`
        select coalesce(sum(balance_cents) filter (where direction = 'receivable'), 0) as receivable,
               coalesce(sum(balance_cents) filter (where direction = 'payable'), 0) as payable,
               coalesce(sum(balance_cents) filter (where direction = 'receivable' and due_date < ${today}::date), 0) as overdue_r,
               coalesce(sum(balance_cents) filter (where direction = 'payable' and due_date < ${today}::date), 0) as overdue_p
        from financial_titles where status in ('open', 'partially_settled')`.execute(trx);
      const upcoming = await trx
        .selectFrom('financial_titles as t')
        .leftJoin('parties as p', 'p.id', 't.party_id')
        .select(['t.id', 't.direction', 't.description', 't.due_date', 't.balance_cents', 'p.name as party_name'])
        .where('t.status', 'in', ['open', 'partially_settled'])
        .where('t.due_date', '<=', addDays(today, 14))
        .orderBy('t.due_date')
        .limit(8)
        .execute();
      const lastMovements = await trx
        .selectFrom('cash_movements as m')
        .innerJoin('financial_accounts as a', 'a.id', 'm.account_id')
        .select(['m.id', 'm.occurred_on', 'm.direction', 'm.amount_cents', 'm.kind', 'a.name as account_name'])
        // Recebimento/pagamento mostra o que foi pago (ex.: "Venda #12", "Aluguel"), não só "Recebimento".
        .select(sql<string | null>`coalesce(
          (select t.description from settlement_allocations sa join financial_titles t on t.id = sa.title_id
            where m.origin_type in ('settlement', 'settlement_reversal') and sa.settlement_id = m.origin_id order by sa.amount_cents desc limit 1),
          m.description)`.as('description'))
        .orderBy('m.created_at', 'desc')
        .limit(6)
        .execute();
      const balances = await sql<{ total: bigint }>`select coalesce(sum(case when direction='in' then amount_cents else -amount_cents end), 0)::bigint as total from cash_movements`.execute(trx);
      finance = { openNow: open.rows[0], upcoming, lastMovements, accountsBalanceNowCents: balances.rows[0]!.total };
    }
    const tenant = await trx.selectFrom('tenants').select(['settings', 'onboarding']).where('id', '=', actor.tenantId).executeTakeFirstOrThrow();
    const settings = tenant.settings as { revenueGoalCents?: string };
    const counts = await sql<{ products: number; sales: number; purchases: number; trades: number }>`
      select (select count(*) from products)::int as products, (select count(*) from sales where status <> 'draft')::int as sales,
             (select count(*) from purchases where status <> 'draft')::int as purchases, (select count(*) from trades)::int as trades`.execute(trx);
    const c = counts.rows[0]!;
    const goal = settings.revenueGoalCents ? BigInt(settings.revenueGoalCents) : null;
    const monthFacts = goal ? await periodFacts(trx, `${today.slice(0, 7)}-01`, today) : null;
    return {
      metrics,
      series: daily.rows.map((d) => ({ day: d.day, revenueCents: d.revenue, grossProfitCents: showCost ? d.revenue - d.cost : undefined, count: d.count })),
      byChannel: byChannel.rows,
      byPayment: byPayment.rows,
      recentSales: recent,
      lowStock: lowStock.rows,
      inspectionCount: inspection.rows[0]!.n,
      finance,
      goal: goal
        ? {
            goalCents: goal,
            monthRevenueCents: monthFacts!.salesRevenueCents - monthFacts!.returnsRevenueCents,
            progressBps: ratioBps(monthFacts!.salesRevenueCents - monthFacts!.returnsRevenueCents, goal),
          }
        : null,
      onboarding: {
        dismissed: Boolean((tenant.onboarding as { dismissed?: boolean }).dismissed),
        steps: { product: c.products > 0, purchase: c.purchases > 0, sale: c.sales > 0, trade: c.trades > 0 },
      },
    };
  });
}

// ---------------------------------------------------------------------------
// Relatórios (mesmos fatos; linhas detalhadas)

export const REPORT_KINDS = ['sales', 'top_products', 'categories', 'channels', 'payments', 'purchases', 'stock', 'movements', 'trades', 'receivables', 'payables', 'cash_flow', 'result'] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];

const COST_REPORTS = new Set<ReportKind>(['stock', 'result', 'purchases']);

export interface ReportData {
  kind: ReportKind;
  title: string;
  period: { from: string; to: string };
  columns: { key: string; label: string; type: 'text' | 'money' | 'int' | 'date' | 'bps' }[];
  rows: Record<string, unknown>[];
  totals?: Record<string, unknown>;
}

export async function buildReport(trx: Tx, actor: Actor, kind: ReportKind, period: { from: string; to: string }): Promise<ReportData> {
  const showCost = can(actor, 'costs.view');
  if (COST_REPORTS.has(kind) && !showCost) throw invalid('Relatório exige permissão para ver custos.');
  const { from, to } = period;
  switch (kind) {
    case 'sales': {
      const r = await sql<Record<string, unknown>>`
        select s.sale_date, s.number, coalesce(c.name, 'Consumidor') as customer, coalesce(ch.name, '') as channel, s.origin,
               (select string_agg(sp.method_name, ', ') from sale_payments sp where sp.sale_id = s.id) as payments,
               (select coalesce(sum(quantity),0) from sale_items si where si.sale_id = s.id)::int as qty,
               s.total_cents, s.returned_revenue_cents ${showCost ? sql`, s.cost_total_cents, s.total_cents - s.cost_total_cents as gross_cents` : sql``}
        from sales s left join parties c on c.id = s.customer_id left join sales_channels ch on ch.id = s.channel_id
        where s.status not in ('draft', 'canceled') and s.sale_date between ${from}::date and ${to}::date
        order by s.sale_date, s.number`.execute(trx);
      const cols: ReportData['columns'] = [
        { key: 'sale_date', label: 'Data', type: 'date' }, { key: 'number', label: 'Nº', type: 'int' }, { key: 'customer', label: 'Cliente', type: 'text' },
        { key: 'channel', label: 'Canal', type: 'text' }, { key: 'payments', label: 'Pagamento', type: 'text' }, { key: 'qty', label: 'Itens', type: 'int' },
        { key: 'total_cents', label: 'Total', type: 'money' }, { key: 'returned_revenue_cents', label: 'Devolvido', type: 'money' },
      ];
      if (showCost) cols.push({ key: 'cost_total_cents', label: 'CMV', type: 'money' }, { key: 'gross_cents', label: 'Resultado bruto', type: 'money' });
      const f = await periodFacts(trx, from, to);
      return { kind, title: 'Vendas', period, columns: cols, rows: r.rows, totals: { total_cents: f.salesRevenueCents, returns_cents: f.returnsRevenueCents, count: f.salesCount } };
    }
    case 'top_products': {
      const r = await sql<Record<string, unknown>>`
        select si.description, si.sku, sum(si.quantity - si.returned_qty)::int as qty, sum(si.total_cents - si.returned_revenue_cents) as revenue_cents
               ${showCost ? sql`, sum(si.cost_cents - si.returned_cost_cents) as cost_cents, sum(si.total_cents - si.returned_revenue_cents) - sum(si.cost_cents - si.returned_cost_cents) as gross_cents` : sql``}
        from sale_items si join sales s on s.id = si.sale_id
        where s.status not in ('draft', 'canceled') and s.sale_date between ${from}::date and ${to}::date
        group by si.description, si.sku order by revenue_cents desc limit 100`.execute(trx);
      const cols: ReportData['columns'] = [{ key: 'description', label: 'Produto', type: 'text' }, { key: 'sku', label: 'SKU', type: 'text' }, { key: 'qty', label: 'Qtd líquida', type: 'int' }, { key: 'revenue_cents', label: 'Receita líquida', type: 'money' }];
      if (showCost) cols.push({ key: 'cost_cents', label: 'CMV', type: 'money' }, { key: 'gross_cents', label: 'Resultado bruto', type: 'money' });
      return { kind, title: 'Produtos mais vendidos', period, columns: cols, rows: r.rows };
    }
    case 'categories': {
      const r = await sql<Record<string, unknown>>`
        select coalesce(c.name, 'Sem categoria') as category, sum(si.quantity - si.returned_qty)::int as qty, sum(si.total_cents - si.returned_revenue_cents) as revenue_cents
               ${showCost ? sql`, sum(si.total_cents - si.returned_revenue_cents) - sum(si.cost_cents - si.returned_cost_cents) as gross_cents` : sql``}
        from sale_items si join sales s on s.id = si.sale_id join product_variants v on v.id = si.variant_id join products p on p.id = v.product_id
        left join categories c on c.id = p.category_id
        where s.status not in ('draft', 'canceled') and s.sale_date between ${from}::date and ${to}::date
        group by 1 order by revenue_cents desc`.execute(trx);
      const cols: ReportData['columns'] = [{ key: 'category', label: 'Categoria', type: 'text' }, { key: 'qty', label: 'Qtd', type: 'int' }, { key: 'revenue_cents', label: 'Receita líquida', type: 'money' }];
      if (showCost) cols.push({ key: 'gross_cents', label: 'Resultado bruto', type: 'money' });
      return { kind, title: 'Vendas por categoria', period, columns: cols, rows: r.rows };
    }
    case 'channels': {
      const r = await sql<Record<string, unknown>>`
        select coalesce(ch.name, 'Sem canal') as channel, count(*)::int as count, sum(s.total_cents) as revenue_cents, sum(s.channel_cost_cents) as channel_cost_cents
        from sales s left join sales_channels ch on ch.id = s.channel_id
        where s.status not in ('draft', 'canceled') and s.sale_date between ${from}::date and ${to}::date group by 1 order by 3 desc`.execute(trx);
      return { kind, title: 'Vendas por canal', period, columns: [{ key: 'channel', label: 'Canal', type: 'text' }, { key: 'count', label: 'Vendas', type: 'int' }, { key: 'revenue_cents', label: 'Receita', type: 'money' }, { key: 'channel_cost_cents', label: 'Comissão', type: 'money' }], rows: r.rows };
    }
    case 'payments': {
      const r = await sql<Record<string, unknown>>`
        select sp.method_name as method, count(*)::int as count, sum(sp.amount_cents) as amount_cents, sum(sp.fee_cents) as expected_fee_cents
        from sale_payments sp join sales s on s.id = sp.sale_id
        where s.status not in ('draft', 'canceled') and s.sale_date between ${from}::date and ${to}::date group by 1 order by 3 desc`.execute(trx);
      return { kind, title: 'Vendas por forma de pagamento', period, columns: [{ key: 'method', label: 'Forma', type: 'text' }, { key: 'count', label: 'Lançamentos', type: 'int' }, { key: 'amount_cents', label: 'Valor', type: 'money' }, { key: 'expected_fee_cents', label: 'Taxa prevista', type: 'money' }], rows: r.rows };
    }
    case 'purchases': {
      const r = await sql<Record<string, unknown>>`
        select p.purchase_date, p.number, s.name as supplier, p.origin, p.status, p.total_cents
        from purchases p join parties s on s.id = p.supplier_id
        where p.status not in ('draft') and p.purchase_date between ${from}::date and ${to}::date order by p.purchase_date, p.number`.execute(trx);
      return { kind, title: 'Compras', period, columns: [{ key: 'purchase_date', label: 'Data', type: 'date' }, { key: 'number', label: 'Nº', type: 'int' }, { key: 'supplier', label: 'Fornecedor', type: 'text' }, { key: 'origin', label: 'Origem', type: 'text' }, { key: 'status', label: 'Situação', type: 'text' }, { key: 'total_cents', label: 'Total', type: 'money' }], rows: r.rows };
    }
    case 'stock': {
      const r = await sql<Record<string, unknown>>`
        select p.name, v.sku, coalesce(b.on_hand, 0)::int as on_hand, coalesce(b.inspection, 0)::int as inspection,
               coalesce((select sum(cost_remaining_cents) from inventory_lots l where l.variant_id = v.id and l.qty_remaining > 0), 0) as cost_cents,
               coalesce(b.on_hand, 0) * v.retail_price_cents as potential_cents
        from product_variants v join products p on p.id = v.product_id left join stock_balances b on b.variant_id = v.id
        where p.kind = 'physical' and v.status = 'active' and (coalesce(b.on_hand, 0) + coalesce(b.inspection, 0)) > 0 order by p.name`.execute(trx);
      return { kind, title: 'Estoque a custo (posição atual)', period, columns: [{ key: 'name', label: 'Produto', type: 'text' }, { key: 'sku', label: 'SKU', type: 'text' }, { key: 'on_hand', label: 'Disponível+reservado', type: 'int' }, { key: 'inspection', label: 'Em inspeção', type: 'int' }, { key: 'cost_cents', label: 'Custo', type: 'money' }, { key: 'potential_cents', label: 'Potencial de venda (estimativa)', type: 'money' }], rows: r.rows };
    }
    case 'movements': {
      const r = await sql<Record<string, unknown>>`
        select (m.created_at at time zone t.timezone)::date as day, p.name, v.sku, m.direction, m.kind, m.quantity, m.physical_after, m.reason ${showCost ? sql`, m.cost_cents` : sql``}
        from stock_movements m join product_variants v on v.id = m.variant_id join products p on p.id = v.product_id join tenants t on t.id = m.tenant_id
        where (m.created_at at time zone t.timezone)::date between ${from}::date and ${to}::date order by m.created_at`.execute(trx);
      const cols: ReportData['columns'] = [{ key: 'day', label: 'Data', type: 'date' }, { key: 'name', label: 'Produto', type: 'text' }, { key: 'sku', label: 'SKU', type: 'text' }, { key: 'direction', label: 'Sentido', type: 'text' }, { key: 'kind', label: 'Tipo', type: 'text' }, { key: 'quantity', label: 'Qtd', type: 'int' }, { key: 'physical_after', label: 'Saldo físico', type: 'int' }, { key: 'reason', label: 'Motivo', type: 'text' }];
      if (showCost) cols.push({ key: 'cost_cents', label: 'Custo', type: 'money' });
      return { kind, title: 'Movimentos de estoque', period, columns: cols, rows: r.rows };
    }
    case 'trades': {
      const r = await sql<Record<string, unknown>>`
        select (t.confirmed_at at time zone tn.timezone)::date as day, t.number, p.name as party, t.status, t.sale_total_cents, t.purchase_total_cents, t.offset_cents, t.difference_cents, t.difference_policy
        from trades t join parties p on p.id = t.party_id join tenants tn on tn.id = t.tenant_id
        where (t.confirmed_at at time zone tn.timezone)::date between ${from}::date and ${to}::date order by t.confirmed_at`.execute(trx);
      return { kind, title: 'Trocas', period, columns: [{ key: 'day', label: 'Data', type: 'date' }, { key: 'number', label: 'Nº', type: 'int' }, { key: 'party', label: 'Cliente', type: 'text' }, { key: 'status', label: 'Situação', type: 'text' }, { key: 'sale_total_cents', label: 'Saída (S)', type: 'money' }, { key: 'purchase_total_cents', label: 'Entrada (P)', type: 'money' }, { key: 'offset_cents', label: 'Compensado', type: 'money' }, { key: 'difference_cents', label: 'Diferença (S−P)', type: 'money' }, { key: 'difference_policy', label: 'Destino', type: 'text' }], rows: r.rows };
    }
    case 'receivables':
    case 'payables': {
      const dir = kind === 'receivables' ? 'receivable' : 'payable';
      const r = await sql<Record<string, unknown>>`
        select t.due_date, coalesce(p.name, '') as party, t.description, t.original_cents, t.balance_cents, t.status
        from financial_titles t left join parties p on p.id = t.party_id
        where t.direction = ${dir} and t.due_date between ${from}::date and ${to}::date order by t.due_date`.execute(trx);
      return { kind, title: kind === 'receivables' ? 'Contas a receber' : 'Contas a pagar', period, columns: [{ key: 'due_date', label: 'Vencimento', type: 'date' }, { key: 'party', label: 'Pessoa', type: 'text' }, { key: 'description', label: 'Descrição', type: 'text' }, { key: 'original_cents', label: 'Original', type: 'money' }, { key: 'balance_cents', label: 'Saldo', type: 'money' }, { key: 'status', label: 'Situação', type: 'text' }], rows: r.rows };
    }
    case 'cash_flow': {
      const r = await sql<Record<string, unknown>>`
        select m.occurred_on, a.name as account, m.kind, m.description,
               case when m.direction = 'in' then m.amount_cents else 0 end as in_cents,
               case when m.direction = 'out' then m.amount_cents else 0 end as out_cents
        from cash_movements m join financial_accounts a on a.id = m.account_id
        where m.occurred_on between ${from}::date and ${to}::date order by m.occurred_on, m.created_at`.execute(trx);
      const f = await periodFacts(trx, from, to);
      return { kind, title: 'Fluxo de caixa realizado', period, columns: [{ key: 'occurred_on', label: 'Data', type: 'date' }, { key: 'account', label: 'Conta', type: 'text' }, { key: 'kind', label: 'Tipo', type: 'text' }, { key: 'description', label: 'Descrição', type: 'text' }, { key: 'in_cents', label: 'Entrada', type: 'money' }, { key: 'out_cents', label: 'Saída', type: 'money' }], rows: r.rows, totals: { in_cents: f.cashInCents, out_cents: f.cashOutCents } };
    }
    case 'result': {
      const f = await periodFacts(trx, from, to);
      const res = computeManagementResult(f);
      const rows = [
        { line: 'Vendas entregues', value_cents: f.salesRevenueCents },
        { line: '(−) Devoluções e estornos', value_cents: -f.returnsRevenueCents },
        { line: '= Receita líquida', value_cents: res.netRevenueCents },
        { line: '(−) CMV', value_cents: -res.cogsCents },
        { line: '= Resultado bruto', value_cents: res.grossProfitCents },
        { line: '(−) Taxas de recebimento', value_cents: -f.paymentFeesCents },
        { line: '(−) Comissões de canal', value_cents: -f.channelCostsCents },
        { line: '= Após custos variáveis', value_cents: res.contributionCents },
        { line: '(−) Despesas operacionais', value_cents: -f.operatingExpensesCents },
        { line: '= Resultado operacional gerencial', value_cents: res.operatingResultCents },
      ];
      return { kind, title: 'Resultado gerencial (não contábil)', period, columns: [{ key: 'line', label: 'Linha', type: 'text' }, { key: 'value_cents', label: 'Valor', type: 'money' }], rows, totals: { gross_margin_bps: res.grossMarginBps, operating_margin_bps: res.operatingMarginBps } };
    }
  }
}

export async function getReport(deps: AppDeps, actor: Actor, kind: ReportKind, q: z.infer<typeof zPeriod>) {
  requirePermission(actor, 'reports.view');
  if (!REPORT_KINDS.includes(kind)) throw invalid('Relatório inexistente.');
  const period = resolvePeriod(actor, q);
  return tx(deps, actor, (trx) => buildReport(trx, actor, kind, period));
}

/** CSV com fórmulas neutralizadas; valores em reais com vírgula decimal. */
export function reportToCsv(r: ReportData): string {
  const fmt = (v: unknown, type: string) => {
    if (v === null || v === undefined) return '';
    if (type === 'money') {
      const n = BigInt(String(v));
      const neg = n < 0n;
      const a = neg ? -n : n;
      return `${neg ? '-' : ''}${a / 100n},${(a % 100n).toString().padStart(2, '0')}`;
    }
    return String(v);
  };
  return toCsv(r.columns.map((c) => c.label), r.rows.map((row) => r.columns.map((c) => fmt(row[c.key], c.type))));
}
