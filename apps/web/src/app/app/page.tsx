'use client';

import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { AlertTriangle, ArrowLeftRight, CheckCircle2, Circle, Package, ShoppingBag, ShoppingCart } from 'lucide-react';
import { BarList, RevenueChart, type SeriesPoint } from '@/components/charts';
import { Badge, Card, ErrorState, LinkButton, LoadingBlock, Money, PageHeader, Select, Stat } from '@/components/ui';
import { api, qs } from '@/lib/client/api';
import { brl, dateBR, KIND_LABEL, pct } from '@/lib/client/format';
import { useCan } from '@/lib/client/session';

interface Dashboard {
  metrics: {
    period: { from: string; to: string };
    revenue: { netCents: string; grossSalesCents: string; returnsCents: string; growthBps: number | null };
    salesCount: number;
    unitsSold: number;
    averageTicketCents: string | null;
    result?: { grossProfitCents: string; grossMarginBps: number | null; operatingResultCents: string; operatingMarginBps: number | null; cogsCents: string; growthGrossBps: number | null; variableCostsCents: string; operatingExpensesCents: string };
    cash: { inCents: string; outCents: string; netCents: string };
    formulas: Record<string, string>;
  };
  series: SeriesPoint[];
  byChannel: { name: string; revenue: string; count: number }[];
  byPayment: { name: string; amount: string }[];
  recentSales: { id: string; number: string; saleDate: string; totalCents: string; status: string; origin: string; customerName: string | null }[];
  lowStock: { productId: string; name: string; sku: string; onHand: number; minStock: number }[];
  inspectionCount: number;
  finance?: {
    openNow: { receivable: string; payable: string; overdueR: string; overdueP: string };
    upcoming: { id: string; direction: string; description: string; dueDate: string; balanceCents: string; partyName: string | null }[];
    lastMovements: { id: string; occurredOn: string; direction: string; amountCents: string; kind: string; description: string | null; accountName: string }[];
    accountsBalanceNowCents: string;
  };
  goal: { goalCents: string; monthRevenueCents: string; progressBps: number | null } | null;
  onboarding: { dismissed: boolean; steps: { product: boolean; purchase: boolean; sale: boolean; trade: boolean } };
}

const PRESETS = [
  { v: 'today', l: 'Hoje' },
  { v: '7d', l: 'Últimos 7 dias' },
  { v: '30d', l: 'Últimos 30 dias' },
  { v: 'month', l: 'Este mês' },
  { v: 'last_month', l: 'Mês passado' },
  { v: 'year', l: 'Este ano' },
];

function Growth({ bps }: { bps: number | null | undefined }) {
  if (bps === null || bps === undefined) return <span>sem base de comparação</span>;
  return <span className={bps >= 0 ? 'text-success' : 'text-danger-soft'}>{bps >= 0 ? '▲' : '▼'} {pct(Math.abs(bps))} vs período anterior</span>;
}

export default function DashboardPage() {
  const [preset, setPreset] = useState('month');
  const can = useCan();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['dashboard', preset], queryFn: () => api<Dashboard>(`dashboard${qs({ preset })}`) });
  const d = q.data;
  const steps = d?.onboarding.steps;
  return (
    <div>
      <PageHeader
        title="Início"
        description={d ? `Período: ${dateBR(d.metrics.period.from)} a ${dateBR(d.metrics.period.to)}` : 'Visão geral do seu negócio'}
        actions={
          <>
            <div className="w-44">
              <Select aria-label="Período" value={preset} onChange={(e) => setPreset(e.target.value)}>
                {PRESETS.map((p) => <option key={p.v} value={p.v}>{p.l}</option>)}
              </Select>
            </div>
            {can('trades.confirm') && <LinkButton variant="secondary" href="/app/trocas/nova"><ArrowLeftRight className="size-4" />Nova troca</LinkButton>}
            {can('sales.create') && <LinkButton href="/app/vendas/nova"><ShoppingCart className="size-4" />Nova venda</LinkButton>}
          </>
        }
      />
      {q.isLoading && <LoadingBlock rows={8} />}
      {q.error && <ErrorState error={q.error} retry={() => q.refetch()} />}
      {d && (
        <div className="flex flex-col gap-4">
          {steps && !d.onboarding.dismissed && !(steps.product && steps.purchase && steps.sale && steps.trade) && (
            <Card title="Primeiros passos" description="Configure o essencial em poucos minutos." action={<button className="text-xs text-muted hover:text-fg" onClick={async () => { await api('tenant/onboarding/dismiss', { method: 'POST' }); qc.invalidateQueries({ queryKey: ['dashboard'] }); }}>Dispensar</button>}>
              <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {[
                  { done: steps.product, label: 'Cadastrar produtos', href: '/app/produtos/novo', icon: Package },
                  { done: steps.purchase, label: 'Registrar uma compra (entrada de estoque)', href: '/app/compras/nova', icon: ShoppingBag },
                  { done: steps.sale, label: 'Registrar a primeira venda', href: '/app/vendas/nova', icon: ShoppingCart },
                  { done: steps.trade, label: 'Fazer uma troca', href: '/app/trocas/nova', icon: ArrowLeftRight },
                ].map((s) => (
                  <li key={s.label}>
                    <Link href={s.href} className="flex items-center gap-3 rounded-xl border border-line bg-bg px-3 py-3 text-sm hover:border-primary">
                      {s.done ? <CheckCircle2 className="size-4 text-success" aria-label="Concluído" /> : <Circle className="size-4 text-muted" aria-label="Pendente" />}
                      <span className={s.done ? 'text-muted line-through' : ''}>{s.label}</span>
                    </Link>
                  </li>
                ))}
              </ol>
            </Card>
          )}

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Receita líquida" value={brl(d.metrics.revenue.netCents)} hint={<Growth bps={d.metrics.revenue.growthBps} />} info={d.metrics.formulas.netRevenue} />
            {d.metrics.result ? (
              <Stat label="Resultado bruto" tone="primary" value={brl(d.metrics.result.grossProfitCents)} hint={<Growth bps={d.metrics.result.growthGrossBps} />} info={d.metrics.formulas.grossProfit} />
            ) : (
              <Stat label="Vendas" value={d.metrics.salesCount} hint="no período" />
            )}
            <Stat label="Itens vendidos" value={d.metrics.unitsSold} hint={`${d.metrics.salesCount} venda(s) · ticket ${brl(d.metrics.averageTicketCents)}`} info={d.metrics.formulas.averageTicket} />
            {d.metrics.result ? (
              <Stat label="Margem bruta" value={pct(d.metrics.result.grossMarginBps)} hint={`Operacional: ${pct(d.metrics.result.operatingMarginBps)}`} info={d.metrics.formulas.margin} />
            ) : (
              <Stat label="Caixa do período" value={brl(d.metrics.cash.netCents)} info={d.metrics.formulas.cash} />
            )}
          </div>

          {d.goal && (
            <Card title="Meta de faturamento do mês">
              <div className="flex items-center justify-between text-sm"><span>{brl(d.goal.monthRevenueCents)} de {brl(d.goal.goalCents)}</span><span className="tabular">{pct(d.goal.progressBps)}</span></div>
              <div className="mt-2 h-2 rounded-full bg-surface-3"><div className="h-2 rounded-full bg-primary" style={{ width: `${Math.min(100, (d.goal.progressBps ?? 0) / 100)}%` }} /></div>
            </Card>
          )}

          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2" title="Receita e resultado por dia" description={d.metrics.result ? 'Resultado bruto = receita − custo histórico das mercadorias vendidas.' : undefined}>
              <RevenueChart data={d.series} />
            </Card>
            <Card title="Desempenho" description="Caixa do período e posições atuais">
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-xl border border-line bg-bg p-2"><p className="text-[11px] text-muted">Entradas</p><p className="text-sm font-semibold text-success tabular">{brl(d.metrics.cash.inCents)}</p></div>
                <div className="rounded-xl border border-line bg-bg p-2"><p className="text-[11px] text-muted">Saídas</p><p className="text-sm font-semibold text-danger-soft tabular">{brl(d.metrics.cash.outCents)}</p></div>
                <div className="rounded-xl border border-line bg-bg p-2"><p className="text-[11px] text-muted">Saldo</p><p className="text-sm font-semibold tabular">{brl(d.metrics.cash.netCents)}</p></div>
              </div>
              <p className="mt-2 text-[11px] text-muted" title={d.metrics.formulas.cash}>Vendas a prazo entram no caixa só quando recebidas.</p>
              {d.finance && (
                <dl className="mt-4 flex flex-col gap-3 text-sm">
                  <div className="flex justify-between"><dt className="text-muted">A receber (hoje)</dt><dd className="tabular">{brl(d.finance.openNow.receivable)}</dd></div>
                  <div className="flex justify-between"><dt className="text-muted">Atrasado a receber</dt><dd className="tabular text-danger-soft">{brl(d.finance.openNow.overdueR)}</dd></div>
                  <div className="flex justify-between"><dt className="text-muted">A pagar (hoje)</dt><dd className="tabular">{brl(d.finance.openNow.payable)}</dd></div>
                  <div className="flex justify-between"><dt className="text-muted">Saldo das contas (hoje)</dt><dd className="tabular">{brl(d.finance.accountsBalanceNowCents)}</dd></div>
                </dl>
              )}
              <div className="mt-4 flex flex-col gap-2 text-sm">
                <Link href="/app/produtos?filter=low_stock" className="flex items-center justify-between rounded-xl border border-line bg-bg px-3 py-2 hover:border-primary">
                  <span className="flex items-center gap-2"><AlertTriangle className="size-4 text-warning" />Estoque baixo</span>
                  <Badge tone={d.lowStock.length ? 'warning' : 'neutral'}>{d.lowStock.length}</Badge>
                </Link>
                <Link href="/app/estoque" className="flex items-center justify-between rounded-xl border border-line bg-bg px-3 py-2 hover:border-primary">
                  <span>Itens aguardando inspeção</span>
                  <Badge tone={d.inspectionCount ? 'info' : 'neutral'}>{d.inspectionCount}</Badge>
                </Link>
              </div>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Vendas por canal"><BarList items={d.byChannel.map((c) => ({ label: c.name, valueCents: c.revenue, hint: `${c.count} venda(s)` }))} empty="Sem vendas neste período." /></Card>
            <Card title="Vendas por forma de pagamento"><BarList items={d.byPayment.map((c) => ({ label: c.name, valueCents: c.amount }))} empty="Sem vendas neste período." /></Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2" title="Vendas recentes" action={<Link href="/app/vendas" className="text-xs text-primary-soft">Ver todas</Link>}>
              {d.recentSales.length ? (
                <ul className="divide-y divide-line/60">
                  {d.recentSales.map((s) => (
                    <li key={s.id}>
                      <Link href={`/app/vendas/${s.id}`} className="flex items-center justify-between gap-3 py-2.5 text-sm hover:text-primary-soft">
                        <span className="min-w-0"><span className="font-medium">Venda #{s.number}</span> <span className="text-muted">· {s.customerName ?? 'Consumidor'} · {dateBR(s.saleDate)}</span></span>
                        <span className="flex items-center gap-2">{s.origin === 'trade' && <Badge tone="primary">Troca</Badge>}<Money cents={s.totalCents} /></span>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="py-8 text-center text-sm text-muted">Nenhuma venda registrada ainda.</p>
              )}
            </Card>
            <Card title="Agenda financeira" action={d.finance && <Link href="/app/financeiro/receber" className="text-xs text-primary-soft">Contas</Link>}>
              {!d.finance ? (
                <p className="text-sm text-muted">Disponível para quem tem acesso ao financeiro.</p>
              ) : d.finance.upcoming.length ? (
                <ul className="flex flex-col gap-2">
                  {d.finance.upcoming.map((t) => (
                    <li key={t.id} className="flex items-center justify-between gap-2 rounded-xl border-l-2 bg-bg px-3 py-2 text-sm" style={{ borderColor: t.direction === 'receivable' ? 'var(--color-success)' : 'var(--color-warning)' }}>
                      <span className="min-w-0"><span className="block truncate">{t.partyName ?? t.description}</span><span className="text-xs text-muted">{t.direction === 'receivable' ? 'Receber' : 'Pagar'} · {dateBR(t.dueDate)}</span></span>
                      <span className="tabular">{brl(t.balanceCents)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted">Nenhuma conta vencendo nos próximos 14 dias.</p>
              )}
              {d.finance && d.finance.lastMovements.length > 0 && (
                <>
                  <p className="mb-2 mt-4 text-[11px] font-semibold uppercase tracking-wide text-muted">Últimos lançamentos</p>
                  <ul className="flex flex-col gap-1.5 text-xs">
                    {d.finance.lastMovements.map((m) => (
                      <li key={m.id} className="flex justify-between gap-2"><span className="truncate text-muted">{KIND_LABEL[m.kind] ?? m.kind} · {m.accountName}</span><span className={m.direction === 'in' ? 'tabular text-success' : 'tabular text-danger-soft'}>{m.direction === 'in' ? '+' : '−'}{brl(m.amountCents)}</span></li>
                    ))}
                  </ul>
                </>
              )}
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
