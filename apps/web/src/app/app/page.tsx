'use client';

import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  AlertTriangle, ArrowDownLeft, ArrowLeftRight, ArrowUpRight, CalendarDays, CheckCircle2, ChevronDown, ChevronRight, Circle, DollarSign, EyeOff, Package, Pencil, Percent, Plus,
  ShoppingBag, ShoppingCart, Target, TrendingUp, Wallet,
} from 'lucide-react';
import { RevenueChart, ShareList, type SeriesPoint } from '@/components/charts';
import { KpiCard, todayISO } from '@/components/dashboard';
import { useToast } from '@/components/toast';
import { Badge, Button, Card, ErrorState, FormError, LinkButton, LoadingBlock, Money, MoneyInput, PageHeader } from '@/components/ui';
import { api, qs } from '@/lib/client/api';
import { brl, dateBR, KIND_LABEL, pct, STATUS_LABEL } from '@/lib/client/format';
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

const initials = (name: string | null) => (name ?? 'Consumidor').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('');

/** Meta do mês: sem meta, convida a definir (quem pode); com meta, progresso e quanto falta por dia. */
function GoalCard({ goal, canEdit, onSaved }: { goal: Dashboard['goal']; canEdit: boolean; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [hidden, setHidden] = useState(() => { try { return localStorage.getItem('gct.goal.hidden') === '1'; } catch { return false; } });
  const toast = useToast();
  const now = new Date();
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const daysLeft = lastDay - now.getDate() + 1;
  const monthName = now.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  const save = async (cents: string | null) => {
    setBusy(true); setError(null);
    try {
      await api('tenant', { method: 'PUT', body: { settings: { revenueGoalCents: cents } } });
      toast(cents ? 'Meta salva.' : 'Meta removida.');
      setEditing(false); onSaved();
    } catch (e) { setError(e); } finally { setBusy(false); }
  };
  const form = (
    <div className="flex flex-wrap items-start gap-2">
      <div className="w-44"><MoneyInput id="goal-v" ariaLabel="Meta de faturamento do mês" value={value} onChange={setValue} /></div>
      <Button loading={busy} disabled={!value || value === '0'} onClick={() => save(value)}>Salvar meta</Button>
      <Button variant="quiet" onClick={() => setEditing(false)}>Cancelar</Button>
      <div className="basis-full"><FormError error={error} /></div>
    </div>
  );
  if (!goal) {
    if (!canEdit || hidden) return null;
    return (
      <section className="flex flex-wrap items-center justify-between gap-4 rounded-[var(--radius-card)] border border-line bg-surface p-4 sm:p-5">
        <div className="flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-xl bg-primary/15 text-primary-soft" aria-hidden><Target className="size-5" /></span>
          <div><p className="text-sm font-semibold">Defina uma meta de faturamento</p><p className="text-xs text-muted">Acompanhe {monthName} e veja quanto falta por dia para bater a meta.</p></div>
        </div>
        {editing ? form : (
          <div className="flex items-center gap-2">
            <Button variant="quiet" onClick={() => { setHidden(true); try { localStorage.setItem('gct.goal.hidden', '1'); } catch { /* sem armazenamento: só nesta visita */ } }}><EyeOff className="size-4" />Ocultar</Button>
            <Button onClick={() => { setValue(''); setEditing(true); }}>Definir meta</Button>
          </div>
        )}
      </section>
    );
  }
  const done = BigInt(goal.monthRevenueCents);
  const target = BigInt(goal.goalCents);
  const missing = target > done ? target - done : 0n;
  const perDay = missing > 0n ? missing / BigInt(Math.max(1, daysLeft)) : 0n;
  const progress = Math.min(100, (goal.progressBps ?? 0) / 100);
  return (
    <section className="rounded-[var(--radius-card)] border border-line bg-surface p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-xl bg-primary/15 text-primary-soft" aria-hidden><Target className="size-5" /></span>
          <div>
            <p className="text-sm font-semibold first-letter:uppercase">Meta de {monthName}</p>
            <p className="text-xs text-muted">{missing > 0n ? <>Faltam <span className="font-medium text-fg">{brl(missing.toString())}</span> · cerca de {brl(perDay.toString())} por dia nos {daysLeft} dia(s) restantes</> : <span className="text-success">Meta batida! 🎉</span>}</p>
          </div>
        </div>
        {editing ? form : (
          <div className="flex items-center gap-3">
            <span className="text-right text-sm"><span className="font-semibold tabular">{brl(goal.monthRevenueCents)}</span><span className="text-muted"> de {brl(goal.goalCents)}</span></span>
            {canEdit && <Button size="sm" variant="secondary" onClick={() => { setValue(goal.goalCents); setEditing(true); }}><Pencil className="size-3.5" />Alterar</Button>}
          </div>
        )}
      </div>
      <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-surface-3" role="progressbar" aria-valuenow={Math.round(progress)} aria-valuemin={0} aria-valuemax={100} aria-label="Progresso da meta">
        <div className="h-full rounded-full bg-gradient-to-r from-[#7b4ff5] to-[#a78bfa]" style={{ width: `${progress}%` }} />
      </div>
      <p className="mt-1.5 text-right text-xs text-muted tabular">{pct(goal.progressBps)}</p>
    </section>
  );
}

export default function DashboardPage() {
  const [preset, setPreset] = useState('month');
  const can = useCan();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['dashboard', preset], queryFn: () => api<Dashboard>(`dashboard${qs({ preset })}`), placeholderData: (prev) => prev });
  const d = q.data;
  const steps = d?.onboarding.steps;
  const best = d?.series.reduce<SeriesPoint | null>((b, p) => (BigInt(p.revenueCents) > 0n && (!b || BigInt(p.revenueCents) > BigInt(b.revenueCents)) ? p : b), null);
  const presetLabel = PRESETS.find((p) => p.v === preset)?.l ?? '';
  return (
    <div>
      <PageHeader
        title="Início"
        description={d ? `Visão geral do seu negócio · ${dateBR(d.metrics.period.from)} a ${dateBR(d.metrics.period.to)}` : 'Visão geral do seu negócio'}
        actions={
          <>
            <label className="relative flex h-10 items-center gap-2 rounded-xl border border-line bg-surface pl-3 pr-8 text-sm font-medium hover:border-line-strong">
              <CalendarDays className="size-4 text-muted" aria-hidden />{presetLabel}
              <ChevronDown className="pointer-events-none absolute right-2.5 size-4 text-muted" aria-hidden />
              <select aria-label="Período" className="absolute inset-0 cursor-pointer opacity-0" value={preset} onChange={(e) => setPreset(e.target.value)}>
                {PRESETS.map((p) => <option key={p.v} value={p.v}>{p.l}</option>)}
              </select>
            </label>
            {can('trades.confirm') && <LinkButton variant="secondary" href="/app/trocas/nova"><ArrowLeftRight className="size-4" />Nova troca</LinkButton>}
            {can('sales.create') && <LinkButton href="/app/vendas/nova"><Plus className="size-4" />Nova venda</LinkButton>}
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

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {d.metrics.result ? (
              <KpiCard tone="violet" label="Lucro bruto" value={brl(d.metrics.result.grossProfitCents)} icon={<TrendingUp className="size-4" />} growthBps={d.metrics.result.growthGrossBps} info={d.metrics.formulas.grossProfit} />
            ) : (
              <KpiCard tone="violet" label="Vendas" value={d.metrics.salesCount} icon={<ShoppingCart className="size-4" />} hint="no período" />
            )}
            <KpiCard tone="blue" label="Total em vendas" value={brl(d.metrics.revenue.netCents)} icon={<DollarSign className="size-4" />} growthBps={d.metrics.revenue.growthBps} info={d.metrics.formulas.netRevenue} />
            <KpiCard tone="teal" label="Itens vendidos" value={d.metrics.unitsSold} icon={<Package className="size-4" />} hint={`${d.metrics.salesCount} venda(s) · ticket médio ${brl(d.metrics.averageTicketCents)}`} info={d.metrics.formulas.averageTicket} />
            {d.metrics.result ? (
              <KpiCard tone="green" label="Margem bruta" value={d.metrics.result.grossMarginBps === null ? '—' : pct(d.metrics.result.grossMarginBps)} icon={<Percent className="size-4" />} hint={d.metrics.result.operatingMarginBps === null ? 'sem vendas no período' : `Operacional ${pct(d.metrics.result.operatingMarginBps)}`} info={d.metrics.formulas.margin} />
            ) : (
              <KpiCard tone="green" label="Caixa do período" value={brl(d.metrics.cash.netCents)} icon={<Wallet className="size-4" />} info={d.metrics.formulas.cash} />
            )}
          </div>

          <GoalCard goal={d.goal} canEdit={can('settings.manage')} onSaved={() => qc.invalidateQueries({ queryKey: ['dashboard'] })} />

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            <Card className="min-w-0 xl:col-span-2" title="Receita e lucro" description={d.metrics.result ? 'Lucro bruto = receita − custo histórico das mercadorias vendidas.' : undefined}>
              <dl className="mb-4 grid grid-cols-3 gap-3">
                <div><dt className="text-[11px] font-semibold uppercase tracking-wide text-muted">Receita</dt><dd className="mt-0.5 text-lg font-semibold tabular">{brl(d.metrics.revenue.netCents)}</dd></div>
                <div><dt className="text-[11px] font-semibold uppercase tracking-wide text-muted">{d.metrics.result ? 'Lucro bruto' : 'Vendas'}</dt><dd className="mt-0.5 text-lg font-semibold tabular">{d.metrics.result ? brl(d.metrics.result.grossProfitCents) : d.metrics.salesCount}</dd></div>
                <div><dt className="text-[11px] font-semibold uppercase tracking-wide text-muted">Melhor dia</dt><dd className="mt-0.5 text-lg font-semibold tabular">{best ? <>{dateBR(best.day).slice(0, 5)} <span className="text-sm font-normal text-muted">{brl(best.revenueCents)}</span></> : '—'}</dd></div>
              </dl>
              <RevenueChart data={d.series} />
            </Card>
            <Card title="Desempenho">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted" title={d.metrics.formulas.cash}>Caixa do período</p>
              <dl className="divide-y divide-line/60 rounded-xl border border-line bg-bg px-3 text-sm">
                <div className="flex items-center justify-between gap-2 py-2"><dt className="flex items-center gap-2 text-muted"><ArrowDownLeft className="size-3.5 text-success" aria-hidden />Entradas</dt><dd className="font-semibold text-success tabular">{brl(d.metrics.cash.inCents)}</dd></div>
                <div className="flex items-center justify-between gap-2 py-2"><dt className="flex items-center gap-2 text-muted"><ArrowUpRight className="size-3.5 text-danger-soft" aria-hidden />Saídas</dt><dd className="font-semibold text-danger-soft tabular">{brl(d.metrics.cash.outCents)}</dd></div>
                <div className="flex items-center justify-between gap-2 py-2"><dt className="text-muted">Saldo do período</dt><dd className="font-semibold tabular">{brl(d.metrics.cash.netCents)}</dd></div>
              </dl>
              {d.finance && (
                <>
                  <div className="mt-5 flex items-center justify-between"><p className="text-[11px] font-semibold uppercase tracking-wide text-muted">A receber</p><Link href="/app/financeiro/receber" className="flex items-center text-xs text-primary-soft">Ver<ChevronRight className="size-3.5" /></Link></div>
                  <p className="mt-1 text-lg font-semibold tabular">{brl(d.finance.openNow.receivable)} {BigInt(d.finance.openNow.overdueR) > 0n ? <span className="text-xs font-normal text-danger-soft">{brl(d.finance.openNow.overdueR)} atrasado</span> : <span className="text-xs font-normal text-muted">{BigInt(d.finance.openNow.receivable) > 0n ? 'em dia' : 'nenhuma pendência'}</span>}</p>
                  <div className="mt-4 flex items-center justify-between"><p className="text-[11px] font-semibold uppercase tracking-wide text-muted">Saldo das contas hoje</p><Link href="/app/financeiro" className="flex items-center text-xs text-primary-soft">Fluxo de caixa<ChevronRight className="size-3.5" /></Link></div>
                  <p className="mt-1 text-lg font-semibold tabular">{brl(d.finance.accountsBalanceNowCents)} <span className="text-xs font-normal text-muted">a pagar {brl(d.finance.openNow.payable)}</span></p>
                </>
              )}
              <div className="mt-5 flex items-center justify-between"><p className="text-[11px] font-semibold uppercase tracking-wide text-muted">Estoque baixo</p><Link href="/app/produtos?filter=low_stock" className="flex items-center text-xs text-primary-soft">Ver<ChevronRight className="size-3.5" /></Link></div>
              {d.lowStock.length ? (
                <ul className="mt-2 flex flex-col gap-1.5 text-sm">
                  {d.lowStock.slice(0, 4).map((p) => (
                    <li key={p.productId}><Link href={`/app/produtos/${p.productId}`} className="flex items-center justify-between gap-2 hover:text-primary-soft"><span className="flex min-w-0 items-center gap-2"><AlertTriangle className="size-3.5 shrink-0 text-warning" aria-hidden /><span className="truncate">{p.name}</span></span><span className="shrink-0 text-xs text-muted tabular">{p.onHand} / mín. {p.minStock}</span></Link></li>
                  ))}
                </ul>
              ) : <p className="mt-1 text-sm text-muted">Nenhum alerta ativo.</p>}
              {d.inspectionCount > 0 && <Link href="/app/estoque" className="mt-3 flex items-center justify-between rounded-xl border border-line bg-bg px-3 py-2 text-sm hover:border-primary"><span>Itens aguardando inspeção</span><Badge tone="info">{d.inspectionCount}</Badge></Link>}
            </Card>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card title="Vendas por canal"><ShareList items={d.byChannel.map((c) => ({ label: c.name, valueCents: c.revenue, hint: `${c.count} venda(s)` }))} empty="Sem vendas neste período." /></Card>
            <Card title="Vendas por pagamento"><ShareList items={d.byPayment.map((c) => ({ label: c.name, valueCents: c.amount }))} empty="Sem vendas neste período." /></Card>
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            <Card className="xl:col-span-2" title="Vendas recentes" description={`${d.metrics.salesCount} venda(s) no período`} action={<Link href="/app/vendas" className="flex items-center text-xs text-primary-soft">Ver todas<ChevronRight className="size-3.5" /></Link>}>
              {d.recentSales.length ? (
                <ul className="divide-y divide-line/60">
                  {d.recentSales.map((s) => (
                    <li key={s.id}>
                      <Link href={`/app/vendas/${s.id}`} className="flex items-center justify-between gap-3 py-2.5 text-sm hover:text-primary-soft">
                        <span className="flex min-w-0 items-center gap-3">
                          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary-soft" aria-hidden>{initials(s.customerName)}</span>
                          <span className="min-w-0"><span className="block truncate font-medium">{s.customerName ?? 'Consumidor'}</span><span className="text-xs text-muted">Venda #{s.number} · {dateBR(s.saleDate)}</span></span>
                        </span>
                        <span className="flex shrink-0 items-center gap-2">{s.origin === 'trade' && <Badge tone="primary">Troca</Badge>}{s.status !== 'confirmed' && <Badge tone="warning">{STATUS_LABEL[s.status] ?? s.status}</Badge>}<Money cents={s.totalCents} /></span>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="py-10 text-center">
                  <p className="text-sm text-muted">Nenhuma venda registrada ainda.</p>
                  {can('sales.create') && <LinkButton className="mt-3" href="/app/vendas/nova"><Plus className="size-4" />Registrar primeira venda</LinkButton>}
                </div>
              )}
            </Card>
            <Card title="Agenda financeira" action={d.finance && <Link href="/app/financeiro/receber" className="flex items-center text-xs text-primary-soft">Contas<ChevronRight className="size-3.5" /></Link>}>
              {!d.finance ? (
                <p className="text-sm text-muted">Disponível para quem tem acesso ao financeiro.</p>
              ) : (
                <>
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">Próximos vencimentos</p>
                  {d.finance.upcoming.length ? (
                    <ul className="flex flex-col gap-2">
                      {d.finance.upcoming.map((t) => (
                        <li key={t.id} className="flex items-center justify-between gap-2 rounded-xl border-l-2 bg-bg px-3 py-2 text-sm" style={{ borderColor: t.direction === 'receivable' ? '#24a878' : 'var(--color-warning)' }}>
                          <span className="min-w-0"><span className="block truncate">{t.partyName ?? t.description}</span><span className="text-xs text-muted">{t.direction === 'receivable' ? 'Receber' : 'Pagar'} · {dateBR(t.dueDate)}{t.dueDate < todayISO() && <span className="ml-1.5 font-medium text-danger-soft">Atrasado</span>}</span></span>
                          <span className="tabular">{brl(t.balanceCents)}</span>
                        </li>
                      ))}
                    </ul>
                  ) : <p className="text-sm text-muted">Nenhuma conta vencendo nos próximos 14 dias.</p>}
                  <div className="mb-2 mt-5 flex items-center justify-between"><p className="text-[11px] font-semibold uppercase tracking-wide text-muted">Últimos lançamentos</p><Link href="/app/financeiro" className="flex items-center text-xs text-primary-soft">Fluxo<ChevronRight className="size-3.5" /></Link></div>
                  {d.finance.lastMovements.length ? (
                    <ul className="flex flex-col gap-2 text-sm">
                      {d.finance.lastMovements.map((m) => (
                        <li key={m.id} className="flex items-center justify-between gap-2">
                          <span className="flex min-w-0 items-center gap-2">
                            <span className={m.direction === 'in' ? 'flex size-6 shrink-0 items-center justify-center rounded-full bg-[#24a878]/15 text-success' : 'flex size-6 shrink-0 items-center justify-center rounded-full bg-danger/15 text-danger-soft'} aria-hidden>{m.direction === 'in' ? <ArrowDownLeft className="size-3.5" /> : <ArrowUpRight className="size-3.5" />}</span>
                            <span className="truncate text-muted">{m.description ?? KIND_LABEL[m.kind] ?? m.kind}</span>
                          </span>
                          <span className={m.direction === 'in' ? 'shrink-0 tabular text-success' : 'shrink-0 tabular text-danger-soft'}>{m.direction === 'in' ? '+' : '−'}{brl(m.amountCents)}</span>
                        </li>
                      ))}
                    </ul>
                  ) : <p className="text-sm text-muted">Nenhum lançamento ainda.</p>}
                </>
              )}
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
