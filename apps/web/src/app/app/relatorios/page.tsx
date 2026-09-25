'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Download, FileDown, Printer } from 'lucide-react';
import { Badge, Button, Card, ErrorState, Input, LoadingBlock, PageHeader, Select, Stat, Table, Td, Th } from '@/components/ui';
import { useToast } from '@/components/toast';
import { api, qs } from '@/lib/client/api';
import { brl, dateBR, dateTimeBR, intBR, KIND_LABEL, pct, STATUS_LABEL } from '@/lib/client/format';
import { useCan } from '@/lib/client/session';

const REPORTS: { kind: string; label: string; cost?: boolean }[] = [
  { kind: 'result', label: 'Resultado gerencial', cost: true },
  { kind: 'sales', label: 'Vendas' },
  { kind: 'top_products', label: 'Produtos mais vendidos' },
  { kind: 'categories', label: 'Vendas por categoria' },
  { kind: 'channels', label: 'Vendas por canal' },
  { kind: 'payments', label: 'Formas de pagamento' },
  { kind: 'trades', label: 'Trocas' },
  { kind: 'purchases', label: 'Compras', cost: true },
  { kind: 'stock', label: 'Estoque a custo (posição atual)', cost: true },
  { kind: 'movements', label: 'Movimentos de estoque' },
  { kind: 'receivables', label: 'Contas a receber' },
  { kind: 'payables', label: 'Contas a pagar' },
  { kind: 'cash_flow', label: 'Fluxo de caixa realizado' },
];

interface Report { kind: string; title: string; period: { from: string; to: string }; columns: { key: string; label: string; type: string }[]; rows: Record<string, unknown>[]; totals?: Record<string, unknown> }

function cell(v: unknown, type: string) {
  if (v === null || v === undefined) return '—';
  if (type === 'money') return brl(String(v));
  if (type === 'date') return dateBR(String(v));
  if (type === 'int') return intBR(Number(v));
  if (type === 'bps') return pct(Number(v));
  const s = String(v);
  return STATUS_LABEL[s] ?? KIND_LABEL[s] ?? s;
}

export default function ReportsPage() {
  const can = useCan();
  const qc = useQueryClient();
  const toast = useToast();
  const [kind, setKind] = useState('result');
  const [preset, setPreset] = useState('month');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const params = from && to ? { from, to } : { preset };
  const available = REPORTS.filter((r) => !r.cost || can('costs.view'));
  const effKind = available.some((r) => r.kind === kind) ? kind : available[0]!.kind;
  const q = useQuery({ queryKey: ['report', effKind, params], queryFn: () => api<Report>(`reports/${effKind}${qs(params)}`) });
  const metrics = useQuery({ queryKey: ['metrics', params], queryFn: () => api<{ revenue: { netCents: string; growthBps: number | null }; salesCount: number; unitsSold: number; averageTicketCents: string | null; result?: { grossProfitCents: string; grossMarginBps: number | null; operatingResultCents: string } }>(`metrics${qs(params)}`) });
  const exportsQ = useQuery({ queryKey: ['exports'], queryFn: () => api<{ id: string; kind: string; status: string; rowCount: number | null; expiresAt: string | null; createdAt: string; error: string | null }[]>('exports'), enabled: can('data.export'), refetchInterval: (s) => (s.state.data?.some((e) => e.status === 'pending' || e.status === 'processing') ? 3000 : false) });
  const r = q.data;
  return (
    <div>
      <PageHeader title="Relatórios" description="Mesmas fórmulas do painel. Resultado gerencial, sem valor contábil ou fiscal." actions={<>
        <Button variant="secondary" onClick={() => window.print()}><Printer className="size-4" />Imprimir / PDF</Button>
        {can('data.export') && <Button onClick={async () => { try { await api('exports', { body: { kind: effKind, format: 'csv', ...params } }); qc.invalidateQueries({ queryKey: ['exports'] }); toast('Exportação em processamento. O link aparece abaixo e expira em 24 h.'); } catch (e) { alert((e as Error).message); } }}><FileDown className="size-4" />Exportar CSV</Button>}
      </>} />
      <Card className="mb-4 print:hidden">
        <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto_auto]">
          <Select aria-label="Relatório" value={effKind} onChange={(e) => setKind(e.target.value)}>{available.map((x) => <option key={x.kind} value={x.kind}>{x.label}</option>)}</Select>
          <Select aria-label="Período" value={preset} onChange={(e) => { setPreset(e.target.value); setFrom(''); setTo(''); }}>
            <option value="today">Hoje</option><option value="7d">Últimos 7 dias</option><option value="30d">Últimos 30 dias</option><option value="month">Este mês</option><option value="last_month">Mês passado</option><option value="year">Este ano</option>
          </Select>
          <Input type="date" aria-label="De" value={from} onChange={(e) => setFrom(e.target.value)} />
          <Input type="date" aria-label="Até" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
      </Card>
      {metrics.data && (
        <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Receita líquida" value={brl(metrics.data.revenue.netCents)} hint={metrics.data.revenue.growthBps === null ? 'sem base de comparação' : `${pct(metrics.data.revenue.growthBps)} vs anterior`} />
          {metrics.data.result && <Stat label="Resultado bruto" tone="primary" value={brl(metrics.data.result.grossProfitCents)} hint={`margem ${pct(metrics.data.result.grossMarginBps)}`} />}
          {metrics.data.result && <Stat label="Resultado operacional" value={brl(metrics.data.result.operatingResultCents)} />}
          <Stat label="Vendas · ticket médio" value={metrics.data.salesCount} hint={brl(metrics.data.averageTicketCents)} />
        </div>
      )}
      <Card title={r ? `${r.title} · ${dateBR(r.period.from)} a ${dateBR(r.period.to)}` : 'Relatório'}>
        {q.isLoading && <LoadingBlock />}
        {q.error && <ErrorState error={q.error} retry={() => q.refetch()} />}
        {r && r.rows.length === 0 && <p className="py-8 text-center text-sm text-muted">Sem registros no período.</p>}
        {r && r.rows.length > 0 && (
          <Table>
            <thead><tr>{r.columns.map((c) => <Th key={c.key} right={['money', 'int', 'bps'].includes(c.type)}>{c.label}</Th>)}</tr></thead>
            <tbody>{r.rows.map((row, i) => (
              <tr key={i} className={String(row.line ?? '').startsWith('=') ? 'font-semibold' : ''}>{r.columns.map((c) => <Td key={c.key} right={['money', 'int', 'bps'].includes(c.type)}>{cell(row[c.key], c.type)}</Td>)}</tr>
            ))}</tbody>
          </Table>
        )}
        {r?.totals && r.kind === 'result' && <p className="mt-3 text-sm text-muted">Margem bruta: {pct((r.totals.gross_margin_bps ?? r.totals.grossMarginBps) as number | null)} · margem operacional: {pct((r.totals.operating_margin_bps ?? r.totals.operatingMarginBps) as number | null)}</p>}
      </Card>
      {can('data.export') && exportsQ.data && exportsQ.data.length > 0 && (
        <Card className="mt-4 print:hidden" title="Exportações recentes" description="Links privados, expiram em 24 horas. Células que parecem fórmulas são neutralizadas.">
          <ul className="flex flex-col gap-2 text-sm">{exportsQ.data.map((e) => (
            <li key={e.id} className="flex items-center justify-between gap-2">
              <span>{REPORTS.find((x) => x.kind === e.kind)?.label ?? e.kind} · {dateTimeBR(e.createdAt)}{e.rowCount !== null ? ` · ${e.rowCount} linha(s)` : ''}</span>
              {e.status === 'done' && e.expiresAt && new Date(e.expiresAt) > new Date() ? <a className="flex items-center gap-1 text-primary-soft hover:underline" href={`/api/v1/exports/${e.id}/download`}><Download className="size-3.5" />Baixar</a> : <Badge tone={e.status === 'failed' ? 'danger' : e.status === 'done' ? 'neutral' : 'info'}>{e.status === 'done' ? 'Expirado' : STATUS_LABEL[e.status] ?? e.status}</Badge>}
            </li>
          ))}</ul>
        </Card>
      )}
    </div>
  );
}
