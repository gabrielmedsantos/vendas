'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, ChevronDown, Download, Landmark, Lock, Merge, Plus, Scale, Search, Undo2, Vault, Wallet } from 'lucide-react';
import { CashFlowChart, type CashPoint } from '@/components/charts';
import { KpiCard, monthOf, PeriodNav, rangeLabel, Tile, todayISO, type Range } from '@/components/dashboard';
import { useAccounts, useDebounced } from '@/components/ops/hooks';
import { Badge, Button, Card, cx, ErrorState, Field, FormError, Input, LoadingBlock, Modal, MoneyInput, PageHeader, Pager, Select, Table, Td, Th } from '@/components/ui';
import { useToast } from '@/components/toast';
import { api, newKey, qs } from '@/lib/client/api';
import { brl, dateBR, KIND_LABEL } from '@/lib/client/format';
import { useCan } from '@/lib/client/session';

interface CashRow {
  id: string; occurredOn: string; direction: 'in' | 'out'; amountCents: string; kind: string; originType: string; description: string | null; accountName: string;
  reversed: boolean; category: string; categoryLabel: string; titleOrigin: string | null; titleOriginId: string | null; titleDescription: string | null; partyName: string | null;
}
interface CashFlow {
  period: Range;
  summary: { openingCents: string; inCents: string; outCents: string; netCents: string; closingCents: string; balanceNowCents: string; openReceivableCents: string; overdueReceivableCents: string; openPayableCents: string; overduePayableCents: string };
  byCategory: { category: string; label: string; inCents: string; outCents: string; count: number }[];
  series: CashPoint[];
  data: CashRow[];
  meta: { cursor: string | null; hasMore: boolean; total?: number };
}

const CATEGORY_LABEL: Record<string, string> = {
  sale: 'Vendas', trade: 'Trocas', purchase: 'Compras de mercadoria', expense: 'Despesas', acquisition_cost: 'Custos de aquisição', refund: 'Reembolsos a clientes',
  receipt: 'Recebimentos avulsos', payment: 'Pagamentos avulsos', capital: 'Aportes, retiradas e empréstimos', adjustment: 'Ajustes e estornos', transfer: 'Transferências entre contas',
};

function signed(cents: string): string {
  const v = BigInt(cents);
  return `${v < 0n ? '−' : v > 0n ? '+' : ''}${brl((v < 0n ? -v : v).toString())}`;
}

function originLink(m: CashRow): { href: string; label: string } | null {
  if (!m.titleOriginId) return null;
  if (m.titleOrigin === 'sale') return { href: `/app/vendas/${m.titleOriginId}`, label: 'Ver venda' };
  if (m.titleOrigin === 'purchase') return { href: `/app/compras/${m.titleOriginId}`, label: 'Ver compra' };
  if (m.titleOrigin === 'trade') return { href: `/app/trocas/${m.titleOriginId}`, label: 'Ver troca' };
  if (m.titleOrigin === 'expense') return { href: '/app/financeiro/despesas', label: 'Abrir' };
  return null;
}

type Dialog = null | 'movement' | 'transfer' | 'account' | 'open' | 'close' | 'period' | 'unify' | 'adjust' | 'reverse';

export default function FinancePage() {
  const can = useCan();
  const qc = useQueryClient();
  const toast = useToast();
  const accounts = useAccounts();
  const [cursor, setCursor] = useState<string | undefined>();
  const [accountFilter, setAccountFilter] = useState('');
  const [range, setRange] = useState<Range>(() => monthOf(todayISO()));
  const [termInput, setTerm] = useState('');
  const term = useDebounced(termInput.trim(), 300);
  const [direction, setDirection] = useState('');
  const [category, setCategory] = useState('');
  const [exporting, setExporting] = useState(false);
  const flowQs = { from: range.from, to: range.to, accountId: accountFilter || undefined, direction: direction || undefined, category: category || undefined, q: term || undefined };
  const flow = useQuery({ queryKey: ['cash-flow', flowQs, cursor], queryFn: () => api<CashFlow>(`finance/cash-flow${qs({ ...flowQs, cursor, limit: 25 })}`), placeholderData: (prev) => prev });
  const sum = flow.data?.summary;
  const breakdown = useQuery({ queryKey: ['balance-breakdown'], queryFn: () => api<{ items: { label: string; cents: string; count: number }[]; balanceCents: string; openPayableCents: string; openReceivableCents: string; stockCostCents?: string }>('finance/balance-breakdown') });
  const periods = useQuery({ queryKey: ['periods'], queryFn: () => api<{ period: string; status: string; reason: string | null }[]>('finance/periods') });
  const [dialog, setDialog] = useState<Dialog>(null);
  const [f, setF] = useState<Record<string, string>>({});
  const [target, setTarget] = useState<string>('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState(newKey);
  const open = (d: Dialog, init: Record<string, string> = {}) => { setF(init); setError(null); setDialog(d); };
  const run = async (fn: () => Promise<unknown>, msg: string) => {
    setBusy(true); setError(null);
    try { await fn(); await qc.invalidateQueries(); toast(msg); setDialog(null); setKey(newKey()); } catch (e) { setError(e); } finally { setBusy(false); }
  };
  const manage = can('finance.manage');
  const total = accounts.data?.reduce((a, x) => a + BigInt(x.balanceCents), 0n) ?? 0n;
  // CSV do período com os filtros atuais (todas as páginas, até 2.000 linhas).
  const exportCsv = async () => {
    setExporting(true);
    try {
      const rows: CashRow[] = [];
      let c: string | undefined;
      for (let i = 0; i < 20; i++) {
        const page = await api<CashFlow>(`finance/cash-flow${qs({ ...flowQs, cursor: c, limit: 100 })}`);
        rows.push(...page.data);
        if (!page.meta.hasMore || !page.meta.cursor) break;
        c = page.meta.cursor;
      }
      const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
      const money = (cents: string, dir: string) => `${dir === 'out' ? '-' : ''}${(BigInt(cents) / 100n).toString()},${(BigInt(cents) % 100n).toString().padStart(2, '0')}`;
      const csv = ['Data;Tipo;Descrição;Cliente/fornecedor;Origem;Conta;Valor;Estornado',
        ...rows.map((m) => [dateBR(m.occurredOn), m.direction === 'in' ? 'Entrada' : 'Saída', esc(m.titleDescription ?? m.description ?? KIND_LABEL[m.kind] ?? m.kind), esc(m.partyName ?? ''), esc(m.categoryLabel), esc(m.accountName), money(m.amountCents, m.direction), m.reversed ? 'sim' : ''].join(';'))].join('\r\n');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }));
      a.download = `fluxo-de-caixa-${range.from}-a-${range.to}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast(`${rows.length} lançamento(s) exportado(s).`);
    } catch (e) { toast(e instanceof Error ? e.message : 'Não foi possível exportar.'); } finally { setExporting(false); }
  };
  return (
    <div>
      <PageHeader title="Fluxo de caixa" description="Tudo que entrou e saiu das contas: vendas, compras, despesas, recebimentos, aportes e ajustes." actions={manage && <>
        {(accounts.data?.length ?? 0) > 1 && <Button variant="secondary" onClick={() => open('transfer', { from: accounts.data?.[0]?.id ?? '', to: accounts.data?.[1]?.id ?? '' })}><ArrowLeftRight className="size-4" />Transferência</Button>}
        <Button variant="secondary" onClick={exportCsv} loading={exporting}><Download className="size-4" />Exportar CSV</Button>
        <Button onClick={() => open('movement', { kind: 'capital_in', accountId: accounts.data?.[0]?.id ?? '' })}><Plus className="size-4" />Novo lançamento</Button>
      </>} />
      {manage && accounts.data && accounts.data.length > 1 && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-primary/40 bg-primary/10 p-4 text-sm">
          <div>
            <p className="font-medium">Você tem {accounts.data.length} contas. Quer deixar uma só?</p>
            <p className="text-muted">O saldo das outras vai para a conta escolhida, dinheiro, Pix e cartões passam a entrar nela e as outras são arquivadas. O histórico continua.</p>
          </div>
          <Button onClick={() => open('unify', { targetId: (accounts.data!.find((a) => a.kind === 'bank') ?? accounts.data![0]!).id, name: 'Conta da loja' })}><Merge className="size-4" />Unificar contas</Button>
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <PeriodNav value={range} onChange={(r) => { setRange(r); setCursor(undefined); }} />
        {(accounts.data?.length ?? 0) > 1 && (
          <div className="w-52"><Select aria-label="Conta" value={accountFilter} onChange={(e) => { setAccountFilter(e.target.value); setCursor(undefined); }}><option value="">Todas as contas</option>{accounts.data?.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select></div>
        )}
      </div>

      {flow.error && <ErrorState error={flow.error} retry={() => flow.refetch()} />}
      {!flow.data && flow.isLoading && <LoadingBlock rows={6} />}
      {sum && (
        <>
          <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-[1.3fr_1fr_1fr_1fr]">
            <KpiCard tone="violet" label={accountFilter ? 'Saldo da conta hoje' : 'Saldo em caixa hoje'} value={brl(sum.balanceNowCents)} icon={<Landmark className="size-4" />}
              info="Soma de tudo que entrou menos tudo que saiu das contas até hoje. É dinheiro, não lucro."
              hint={manage && accounts.data?.length === 1 ? <button className="underline underline-offset-2 hover:no-underline" onClick={() => { setTarget(accounts.data![0]!.id); open('adjust', { target: '', reason: 'Conferência com o saldo real' }); }}>Ajustar ao saldo real</button> : `${accounts.data?.length ?? 0} conta(s)`} />
            <Tile label="Entradas no período" tone="in" value={brl(sum.inCents)} icon={<ArrowDownLeft className="size-5" />} hint="dinheiro que entrou" />
            <Tile label="Saídas no período" tone="out" value={brl(sum.outCents)} icon={<ArrowUpRight className="size-5" />} hint="dinheiro que saiu" />
            <Tile label="Resultado de caixa" tone={BigInt(sum.netCents) < 0n ? 'out' : 'primary'} value={signed(sum.netCents)} icon={<Scale className="size-5" />}
              hint={`saldo ${brl(sum.openingCents)} → ${brl(sum.closingCents)}`} info="Entradas − saídas do período. Saldo no início do período → saldo no fim." />
          </div>

          <div className="mb-4 grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
            <Card className="min-w-0" title="Entradas e saídas por dia" description={rangeLabel(range).replace(/^./, (c) => c.toUpperCase())}>
              <CashFlowChart data={flow.data!.series} />
            </Card>
            <div className="flex flex-col gap-4">
              <Card title="Para onde foi o dinheiro" description="Por origem, no período">
                {flow.data!.byCategory.length === 0 ? <p className="py-6 text-center text-sm text-muted">Sem movimento no período.</p> : (
                  <ul className="flex flex-col gap-2.5 text-sm">
                    {flow.data!.byCategory.map((c) => {
                      const v = BigInt(c.inCents) - BigInt(c.outCents);
                      return (
                        <li key={c.category}>
                          <button type="button" className={cx('flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-surface-2', category === c.category && 'bg-surface-2 ring-1 ring-primary/50')}
                            onClick={() => { setCategory(category === c.category ? '' : c.category); setCursor(undefined); }} aria-pressed={category === c.category} title="Filtrar a lista por esta origem">
                            <span className="flex min-w-0 items-center gap-2"><span className={cx('size-2 shrink-0 rounded-full', v >= 0n ? 'bg-[#24a878]' : 'bg-[#e5534b]')} aria-hidden /><span>{c.label} <span className="text-xs text-muted">{c.count}</span></span></span>
                            <span className={cx('shrink-0 tabular font-medium', v >= 0n ? 'text-success' : 'text-danger-soft')}>{signed(v.toString())}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </Card>
              <Card title="Previsto" description="Ainda não passou pelas contas">
                <dl className="flex flex-col gap-3 text-sm">
                  <div className="flex items-center justify-between gap-2"><dt><Link href="/app/financeiro/receber" className="hover:text-primary-soft">A receber em aberto</Link>{BigInt(sum.overdueReceivableCents) > 0n && <span className="block text-xs text-danger-soft">{brl(sum.overdueReceivableCents)} atrasado</span>}</dt><dd className="tabular text-success">{brl(sum.openReceivableCents)}</dd></div>
                  <div className="flex items-center justify-between gap-2"><dt><Link href="/app/financeiro/pagar" className="hover:text-primary-soft">A pagar em aberto</Link>{BigInt(sum.overduePayableCents) > 0n && <span className="block text-xs text-danger-soft">{brl(sum.overduePayableCents)} atrasado</span>}</dt><dd className="tabular text-danger-soft">{brl(sum.openPayableCents)}</dd></div>
                  <div className="flex items-center justify-between gap-2 border-t border-line pt-3 font-medium"><dt>Saldo previsto</dt><dd className="tabular">{brl((BigInt(sum.balanceNowCents) + BigInt(sum.openReceivableCents) - BigInt(sum.openPayableCents)).toString())}</dd></div>
                </dl>
              </Card>
            </div>
          </div>
        </>
      )}

      <Card title="Lançamentos" description="Os totais acima usam só o período (e a conta). A lista também aplica busca e filtros.">
        <div className="mb-3 grid gap-2 md:grid-cols-[minmax(0,1fr)_160px_220px_auto]">
          <div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden /><Input aria-label="Pesquisar lançamentos" className="pl-9" placeholder="Pesquisar por descrição, cliente, fornecedor ou valor…" value={termInput} onChange={(e) => { setTerm(e.target.value); setCursor(undefined); }} /></div>
          <Select aria-label="Tipo" value={direction} onChange={(e) => { setDirection(e.target.value); setCursor(undefined); }}><option value="">Entradas e saídas</option><option value="in">Só entradas</option><option value="out">Só saídas</option></Select>
          <Select aria-label="Origem" value={category} onChange={(e) => { setCategory(e.target.value); setCursor(undefined); }}><option value="">Todas as origens</option>{Object.entries(CATEGORY_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
          <Button variant="secondary" disabled={!termInput && !direction && !category} onClick={() => { setTerm(''); setDirection(''); setCategory(''); setCursor(undefined); }}>Limpar filtros</Button>
        </div>
        {flow.data && flow.data.data.length === 0 && (
          <div className="py-12 text-center text-sm text-muted">
            <Wallet className="mx-auto mb-2 size-6" aria-hidden />
            {term || direction || category ? 'Nenhum lançamento com esses filtros.' : 'Nenhum lançamento no período.'}
          </div>
        )}
        {flow.data && flow.data.data.length > 0 && (
          <>
            {/* Celular: cartões; telas maiores: tabela. */}
            <ul className="flex flex-col divide-y divide-line/60 md:hidden">
              {flow.data.data.map((m) => {
                const link = originLink(m);
                return (
                  <li key={m.id} className={cx('flex items-start justify-between gap-3 py-3', m.reversed && 'opacity-60')}>
                    <span className="flex min-w-0 items-start gap-2.5">
                      <span className={m.direction === 'in' ? 'mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-[#24a878]/15 text-success' : 'mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-danger/15 text-danger-soft'} aria-label={m.direction === 'in' ? 'Entrada' : 'Saída'}>
                        {m.direction === 'in' ? <ArrowDownLeft className="size-3.5" /> : <ArrowUpRight className="size-3.5" />}
                      </span>
                      <span className="min-w-0 text-sm">
                        <span className="block truncate font-medium">{m.titleDescription ?? m.description ?? KIND_LABEL[m.kind] ?? m.kind}</span>
                        <span className="block text-xs text-muted">{dateBR(m.occurredOn)} · {m.categoryLabel}{m.partyName ? ` · ${m.partyName}` : ''}</span>
                        {link && <Link href={link.href} className="text-xs text-primary-soft">{link.label}</Link>}
                        {m.reversed && <Badge tone="neutral">Estornado</Badge>}
                      </span>
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-1">
                      <span className={cx('text-sm font-semibold tabular', m.direction === 'in' ? 'text-success' : 'text-danger-soft')}>{m.direction === 'in' ? '+' : '−'}{brl(m.amountCents)}</span>
                      {manage && !m.reversed && ['manual', 'balance_adjustment'].includes(m.originType) && m.kind !== 'reversal' && <Button size="sm" variant="quiet" onClick={() => { setTarget(m.id); open('reverse', { reason: '' }); }}><Undo2 className="size-3.5" />Estornar</Button>}
                    </span>
                  </li>
                );
              })}
            </ul>
            <div className="hidden md:block">
            <Table>
              <thead><tr><Th>Data</Th><Th>Tipo</Th><Th>Descrição</Th><Th>Origem</Th>{(accounts.data?.length ?? 0) > 1 && <Th>Conta</Th>}<Th right>Valor</Th>{manage && <Th />}</tr></thead>
              <tbody>{flow.data.data.map((m) => {
                const link = originLink(m);
                return (
                  <tr key={m.id} className={cx('hover:bg-surface-2', m.reversed && 'opacity-60')}>
                    <Td className="whitespace-nowrap">{dateBR(m.occurredOn)}</Td>
                    <Td>{m.direction === 'in'
                      ? <span className="inline-flex items-center gap-1 rounded-full bg-[#24a878]/15 px-2 py-0.5 text-xs font-medium text-success"><ArrowDownLeft className="size-3" />Entrada</span>
                      : <span className="inline-flex items-center gap-1 rounded-full bg-danger/15 px-2 py-0.5 text-xs font-medium text-danger-soft"><ArrowUpRight className="size-3" />Saída</span>}</Td>
                    <Td><span className="block max-w-xs truncate">{m.titleDescription ?? m.description ?? KIND_LABEL[m.kind] ?? m.kind}</span>{m.partyName && <span className="block text-xs text-muted">{m.partyName}</span>}</Td>
                    <Td><span className="text-xs">{m.categoryLabel}</span>{link && <Link href={link.href} className="ml-1.5 text-xs text-primary-soft hover:underline">{link.label}</Link>}</Td>
                    {(accounts.data?.length ?? 0) > 1 && <Td className="text-xs text-muted">{m.accountName}</Td>}
                    <Td right className={cx('whitespace-nowrap font-medium', m.direction === 'in' ? 'text-success' : 'text-danger-soft')}>{m.direction === 'in' ? '+' : '−'}{brl(m.amountCents)}</Td>
                    {manage && <Td right>{m.reversed ? <Badge tone="neutral">Estornado</Badge> : ['manual', 'balance_adjustment'].includes(m.originType) && m.kind !== 'reversal'
                      ? <Button size="sm" variant="quiet" onClick={() => { setTarget(m.id); open('reverse', { reason: '' }); }}><Undo2 className="size-3.5" />Estornar</Button>
                      : null}</Td>}
                  </tr>
                );
              })}</tbody>
            </Table>
            </div>
            <Pager hasMore={flow.data.meta.hasMore} cursor={flow.data.meta.cursor} onNext={setCursor} onFirst={() => setCursor(undefined)} isFirst={!cursor} total={flow.data.meta.total} />
          </>
        )}
      </Card>

      <details className="group mt-4 rounded-[var(--radius-card)] border border-line bg-surface">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-4 sm:p-5">
          <span><span className="block text-sm font-semibold">Contas e conferência</span><span className="text-xs text-muted">Saldo por conta, abrir/fechar caixa, de onde vem o saldo e fechamento de períodos</span></span>
          <ChevronDown className="size-4 text-muted transition-transform group-open:rotate-180" aria-hidden />
        </summary>
        <div className="flex flex-col gap-4 border-t border-line p-4 sm:p-5">
          {accounts.isLoading && <LoadingBlock />}
          {accounts.error && <ErrorState error={accounts.error} />}
          {accounts.data && (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {accounts.data.map((a) => (
                <div key={a.id} className="rounded-2xl border border-line bg-bg p-4">
                  <div className="flex items-center justify-between"><p className="text-sm font-medium">{a.name}</p><Badge tone={a.kind === 'cash' ? 'warning' : 'info'}>{a.kind === 'cash' ? 'Caixa' : a.kind === 'bank' ? 'Banco' : 'Outra'}</Badge></div>
                  <p className="mt-2 text-xl font-semibold tabular">{brl(a.balanceCents)}</p>
                  {manage && <Button size="sm" variant="quiet" className="mt-1 -ml-2" onClick={() => { setTarget(a.id); open('adjust', { target: '', reason: 'Conferência com o saldo real' }); }}><Scale className="size-3.5" />Ajustar saldo</Button>}
                  {a.kind === 'cash' && manage && (
                    <div className="mt-2">{a.openSession
                      ? <Button size="sm" variant="secondary" onClick={() => { setTarget(a.openSession!); open('close', { counted: '' }); }}><Lock className="size-3.5" />Fechar caixa</Button>
                      : <Button size="sm" variant="secondary" onClick={() => { setTarget(a.id); open('open', { counted: a.balanceCents }); }}><Vault className="size-3.5" />Abrir caixa</Button>}
                    </div>
                  )}
                </div>
              ))}
              {manage && <button type="button" onClick={() => open('account', { kind: 'bank' })} className="flex min-h-28 items-center justify-center gap-2 rounded-2xl border border-dashed border-line text-sm text-muted hover:border-primary hover:text-fg"><Plus className="size-4" />Nova conta</button>}
            </div>
          )}
          {breakdown.data && (
            <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
              <div>
                <p className="mb-1 text-sm font-semibold">De onde vem o saldo</p>
                <p className="mb-2 text-xs text-muted">Tudo que entrou menos tudo que saiu das contas desde o início, por tipo. É dinheiro, não lucro.</p>
                {breakdown.data.items.length === 0 ? <p className="text-sm text-muted">Nenhum movimento ainda.</p> : (
                  <ul className="divide-y divide-line text-sm">
                    {breakdown.data.items.map((l) => (
                      <li key={l.label} className="flex items-center justify-between gap-3 py-2">
                        <span>{l.label} <span className="text-xs text-muted">({l.count})</span></span>
                        <span className={cx('tabular font-medium', BigInt(l.cents) >= 0n ? 'text-success' : 'text-danger-soft')}>{signed(l.cents)}</span>
                      </li>
                    ))}
                    <li className="flex items-center justify-between gap-3 py-2 font-semibold"><span>Saldo nas contas</span><span className="tabular">{brl(breakdown.data.balanceCents)}</span></li>
                  </ul>
                )}
              </div>
              <div className="flex flex-col gap-3 rounded-xl border border-line bg-bg p-4 text-sm">
                <p className="font-medium">Ainda não passou pela conta</p>
                <div className="flex justify-between"><span className="text-muted">Contas a pagar em aberto</span><span className="tabular text-danger-soft">{brl(breakdown.data.openPayableCents)}</span></div>
                <div className="flex justify-between"><span className="text-muted">Contas a receber em aberto</span><span className="tabular text-success">{brl(breakdown.data.openReceivableCents)}</span></div>
                {breakdown.data.stockCostCents !== undefined && <div className="flex justify-between"><span className="text-muted">Mercadoria em estoque (a custo)</span><span className="tabular">{brl(breakdown.data.stockCostCents)}</span></div>}
                <p className="text-xs text-muted">Compra lançada “a pagar” só sai da conta quando você der baixa em A pagar. O dinheiro usado em mercadoria que ainda está no estoque não some: virou produto e aparece aqui a custo.</p>
              </div>
            </div>
          )}
          <div>
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-sm font-semibold">Períodos fechados</p>
              {manage && <Button size="sm" variant="secondary" onClick={() => open('period', { period: new Date().toISOString().slice(0, 7), status: 'closed' })}>Fechar/reabrir</Button>}
            </div>
            <p className="mb-2 text-xs text-muted">Período fechado não aceita lançamentos retroativos sem reabertura auditada.</p>
            {periods.data?.length ? <ul className="flex flex-wrap gap-2 text-sm">{periods.data.map((p) => <li key={p.period} className="flex items-center gap-2 rounded-lg border border-line px-2 py-1"><span>{p.period}</span><Badge tone={p.status === 'closed' ? 'warning' : 'info'}>{p.status === 'closed' ? 'Fechado' : 'Reaberto'}</Badge></li>)}</ul> : <p className="text-sm text-muted">Nenhum período fechado.</p>}
          </div>
        </div>
      </details>

      <Modal open={dialog === 'movement'} onClose={() => setDialog(null)} title="Lançamento financeiro" footer={<><Button variant="secondary" onClick={() => setDialog(null)}>Cancelar</Button><Button loading={busy} onClick={() => run(() => api('finance/cash-movements', { idempotencyKey: key, body: { accountId: f.accountId || accounts.data?.[0]?.id, kind: f.kind, direction: f.kind === 'cash_adjustment' ? f.direction || 'in' : undefined, amountCents: f.amount, occurredOn: f.date || undefined, description: f.description } }), 'Lançamento registrado.')}>Registrar</Button></>}>
        <div className="flex flex-col gap-3">
          <p className="text-xs text-muted">Aportes, retiradas, empréstimos e saldo inicial têm tipos próprios e não entram na receita de vendas nem nas despesas operacionais.</p>
          <Field label="Tipo" htmlFor="mv-k"><Select id="mv-k" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{['opening', 'capital_in', 'withdrawal', 'loan_in', 'loan_out', 'cash_adjustment'].map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</Select></Field>
          {f.kind === 'cash_adjustment' && <Field label="Sentido" htmlFor="mv-dir"><Select id="mv-dir" value={f.direction ?? 'in'} onChange={(e) => setF({ ...f, direction: e.target.value })}><option value="in">Entrada</option><option value="out">Saída</option></Select></Field>}
          <Field label="Conta" htmlFor="mv-acc"><Select id="mv-acc" value={f.accountId} onChange={(e) => setF({ ...f, accountId: e.target.value })}>{accounts.data?.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select></Field>
          <Field label="Valor" htmlFor="mv-v"><MoneyInput id="mv-v" value={f.amount ?? ''} onChange={(c) => setF({ ...f, amount: c })} /></Field>
          <Field label="Data" htmlFor="mv-d"><Input id="mv-d" type="date" value={f.date ?? ''} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
          <Field label="Descrição" htmlFor="mv-desc" required><Input id="mv-desc" value={f.description ?? ''} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
          <FormError error={error} />
        </div>
      </Modal>
      {dialog === 'adjust' && (() => {
        const acc = accounts.data?.find((a) => a.id === target);
        const cur = BigInt(acc?.balanceCents ?? '0');
        const diff = f.target !== '' && f.target !== undefined ? BigInt(f.target) - cur : null;
        return (
          <Modal open onClose={() => setDialog(null)} title={`Ajustar saldo · ${acc?.name ?? ''}`} footer={<><Button variant="secondary" onClick={() => setDialog(null)}>Cancelar</Button><Button loading={busy} disabled={diff === null || diff === 0n || (f.reason ?? '').trim().length < 3} onClick={() => run(() => api(`finance/accounts/${target}/adjust-balance`, { idempotencyKey: key, body: { targetCents: f.target, reason: (f.reason ?? '').trim() } }), 'Saldo ajustado.')}>Ajustar</Button></>}>
            <div className="flex flex-col gap-3 text-sm">
              <p className="text-muted">Saldo no sistema: <span className="font-semibold text-fg tabular">{brl(cur.toString())}</span></p>
              <Field label="Quanto tem de verdade nesta conta?" htmlFor="adj-target" help="Confira no extrato do banco ou conte o dinheiro."><MoneyInput id="adj-target" value={f.target ?? ''} onChange={(c) => setF({ ...f, target: c })} /></Field>
              {diff !== null && diff !== 0n && (
                <p className={diff > 0n ? 'text-success' : 'text-danger-soft'}>Será lançado um ajuste de {diff > 0n ? 'entrada' : 'saída'} de {brl((diff > 0n ? diff : -diff).toString())}.</p>
              )}
              {diff === 0n && <p className="text-muted">O saldo já está igual; nada a ajustar.</p>}
              <Field label="Motivo" htmlFor="adj-reason"><Input id="adj-reason" maxLength={300} value={f.reason ?? ''} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>
              <p className="text-xs text-muted">O ajuste não conta como receita nem despesa e fica registrado no livro de caixa com o motivo. Gastos conhecidos (compras, despesas) é melhor lançar nas telas próprias, para aparecerem nos relatórios.</p>
              <FormError error={error} />
            </div>
          </Modal>
        );
      })()}
      <Modal open={dialog === 'reverse'} onClose={() => setDialog(null)} title="Estornar lançamento" footer={<><Button variant="secondary" onClick={() => setDialog(null)}>Voltar</Button><Button variant="danger" loading={busy} disabled={(f.reason ?? '').trim().length < 3} onClick={() => run(() => api(`finance/cash-movements/${target}/reverse`, { body: { reason: (f.reason ?? '').trim() } }), 'Lançamento estornado.')}>Estornar</Button></>}>
        <div className="flex flex-col gap-3 text-sm">
          <p className="text-muted">Cria um lançamento oposto de mesmo valor, que anula o original. Os dois ficam no histórico. Movimentos de venda, compra e despesa se estornam na própria tela deles.</p>
          <Field label="Motivo" htmlFor="rv-reason"><Input id="rv-reason" maxLength={300} placeholder="Ex.: lançado errado" value={f.reason ?? ''} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>
          <FormError error={error} />
        </div>
      </Modal>
      <Modal open={dialog === 'unify'} onClose={() => setDialog(null)} title="Unificar contas" footer={<><Button variant="secondary" onClick={() => setDialog(null)}>Cancelar</Button><Button loading={busy} disabled={!f.targetId || (f.name ?? '').trim().length < 2} onClick={() => run(() => api('finance/accounts/unify', { body: { targetId: f.targetId, name: f.name?.trim() || undefined } }), 'Contas unificadas: agora tudo entra numa conta só.')}>Unificar</Button></>}>
        <div className="flex flex-col gap-3 text-sm">
          <Field label="Conta que fica" htmlFor="un-target">
            <Select id="un-target" value={f.targetId ?? ''} onChange={(e) => setF({ ...f, targetId: e.target.value })}>
              {accounts.data?.map((a) => <option key={a.id} value={a.id}>{a.name} · {brl(a.balanceCents)}</option>)}
            </Select>
          </Field>
          <Field label="Nome da conta" htmlFor="un-name"><Input id="un-name" maxLength={80} value={f.name ?? ''} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <ul className="list-disc pl-5 text-muted">
            <li>Saldo das outras contas: transferido para a conta que fica ({brl(total.toString())} no total). Transferência não é receita nem despesa.</li>
            <li>Dinheiro, Pix, débito, crédito e transferência passam a entrar nesta conta.</li>
            <li>As outras contas são arquivadas; os movimentos antigos continuam no histórico.</li>
          </ul>
          <FormError error={error} />
        </div>
      </Modal>
      <Modal open={dialog === 'transfer'} onClose={() => setDialog(null)} title="Transferência entre contas" footer={<><Button variant="secondary" onClick={() => setDialog(null)}>Cancelar</Button><Button loading={busy} onClick={() => run(() => api('finance/transfers', { idempotencyKey: key, body: { fromAccountId: f.from, toAccountId: f.to, amountCents: f.amount, description: f.description || undefined } }), 'Transferência registrada.')}>Transferir</Button></>}>
        <div className="flex flex-col gap-3">
          <p className="text-xs text-muted">Transferência interna (sangria, depósito) não é receita nem despesa.</p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="De" htmlFor="tr-f"><Select id="tr-f" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })}>{accounts.data?.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select></Field>
            <Field label="Para" htmlFor="tr-t"><Select id="tr-t" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })}>{accounts.data?.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select></Field>
          </div>
          <Field label="Valor" htmlFor="tr-v"><MoneyInput id="tr-v" value={f.amount ?? ''} onChange={(c) => setF({ ...f, amount: c })} /></Field>
          <Field label="Descrição" htmlFor="tr-d"><Input id="tr-d" value={f.description ?? ''} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
          <FormError error={error} />
        </div>
      </Modal>
      <Modal open={dialog === 'account'} onClose={() => setDialog(null)} title="Nova conta" footer={<><Button variant="secondary" onClick={() => setDialog(null)}>Cancelar</Button><Button loading={busy} onClick={() => run(() => api('finance/accounts', { body: { name: f.name, kind: f.kind } }), 'Conta criada.')}>Criar</Button></>}>
        <div className="flex flex-col gap-3">
          <Field label="Nome" htmlFor="ac-n"><Input id="ac-n" value={f.name ?? ''} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Tipo" htmlFor="ac-k"><Select id="ac-k" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}><option value="bank">Banco</option><option value="cash">Caixa físico</option><option value="card_transit">Cartões em trânsito</option><option value="other">Outra</option></Select></Field>
          <FormError error={error} />
        </div>
      </Modal>
      <Modal open={dialog === 'open'} onClose={() => setDialog(null)} title="Abrir caixa" footer={<><Button variant="secondary" onClick={() => setDialog(null)}>Cancelar</Button><Button loading={busy} onClick={() => run(() => api('finance/cash-sessions', { body: { accountId: target, countedCents: f.counted || '0' } }), 'Caixa aberto.')}>Abrir</Button></>}>
        <Field label="Valor contado na gaveta" htmlFor="op-c"><MoneyInput id="op-c" value={f.counted ?? ''} onChange={(c) => setF({ ...f, counted: c })} /></Field>
        <div className="mt-3"><FormError error={error} /></div>
      </Modal>
      <Modal open={dialog === 'close'} onClose={() => setDialog(null)} title="Fechar caixa" footer={<><Button variant="secondary" onClick={() => setDialog(null)}>Cancelar</Button><Button loading={busy} onClick={() => run(() => api('finance/cash-sessions/' + target + '/close', { body: { countedCents: f.counted || '0', justification: f.justification || undefined } }), 'Caixa fechado.')}>Fechar</Button></>}>
        <div className="flex flex-col gap-3">
          <Field label="Valor contado" htmlFor="cl-c"><MoneyInput id="cl-c" value={f.counted ?? ''} onChange={(c) => setF({ ...f, counted: c })} /></Field>
          <Field label="Justificativa (obrigatória se houver diferença)" htmlFor="cl-j"><Input id="cl-j" value={f.justification ?? ''} onChange={(e) => setF({ ...f, justification: e.target.value })} /></Field>
          <FormError error={error} />
        </div>
      </Modal>
      <Modal open={dialog === 'period'} onClose={() => setDialog(null)} title="Fechar ou reabrir período" footer={<><Button variant="secondary" onClick={() => setDialog(null)}>Cancelar</Button><Button loading={busy} onClick={() => run(() => api('finance/periods', { body: { period: f.period, status: f.status, reason: f.reason } }), 'Período atualizado.')}>Confirmar</Button></>}>
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Mês (AAAA-MM)" htmlFor="pd-p"><Input id="pd-p" value={f.period ?? ''} onChange={(e) => setF({ ...f, period: e.target.value })} /></Field>
            <Field label="Ação" htmlFor="pd-s"><Select id="pd-s" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="closed">Fechar</option><option value="reopened">Reabrir</option></Select></Field>
          </div>
          <Field label="Motivo" htmlFor="pd-r" required><Input id="pd-r" value={f.reason ?? ''} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>
          <FormError error={error} />
        </div>
      </Modal>
    </div>
  );
}
