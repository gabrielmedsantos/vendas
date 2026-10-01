'use client';

import { useState } from 'react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatBRL } from '@gct/shared';
import { dateBR } from '@/lib/client/format';

const S1 = '#8a62ff';
const S2 = '#d95926';

const compact = (cents: number) => {
  const v = cents / 100;
  return v >= 1000 ? `R$ ${(v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil` : `R$ ${v.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}`;
};

export interface SeriesPoint { day: string; revenueCents: string; grossProfitCents?: string; count: number }

/** Receita (e resultado bruto, quando permitido) por dia. Um eixo; tooltip em crosshair; tabela alternativa. */
export function RevenueChart({ data }: { data: SeriesPoint[] }) {
  const [table, setTable] = useState(false);
  const hasProfit = data.some((d) => d.grossProfitCents !== undefined);
  const rows = data.map((d) => ({ day: d.day, revenue: Number(d.revenueCents), profit: d.grossProfitCents !== undefined ? Number(d.grossProfitCents) : undefined, count: d.count }));
  const empty = rows.every((r) => r.revenue === 0);
  if (empty) return <p className="py-12 text-center text-sm text-muted">Nenhuma venda no período. O gráfico aparece quando houver movimento.</p>;
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        {hasProfit ? (
          <ul className="flex gap-4 text-xs text-muted" aria-label="Legenda">
            <li className="flex items-center gap-1.5"><span className="h-0.5 w-4 rounded" style={{ background: S1 }} />Receita</li>
            <li className="flex items-center gap-1.5"><span className="h-0.5 w-4 rounded border-t-2 border-dashed" style={{ borderColor: S2 }} />Lucro bruto</li>
          </ul>
        ) : <span />}
        <button className="text-xs text-primary-soft hover:underline" onClick={() => setTable(!table)}>{table ? 'Ver gráfico' : 'Ver tabela'}</button>
      </div>
      {table ? (
        <div className="max-h-64 overflow-y-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-muted"><th className="py-1">Dia</th><th className="text-right">Vendas</th><th className="text-right">Receita</th>{hasProfit && <th className="text-right">Lucro bruto</th>}</tr></thead>
            <tbody>{rows.map((r) => <tr key={r.day} className="border-t border-line/60"><td className="py-1">{dateBR(r.day)}</td><td className="text-right tabular">{r.count}</td><td className="text-right tabular">{formatBRL(BigInt(r.revenue))}</td>{hasProfit && <td className="text-right tabular">{formatBRL(BigInt(r.profit ?? 0))}</td>}</tr>)}</tbody>
          </table>
        </div>
      ) : (
        <div className="h-60" role="img" aria-label="Gráfico de receita por dia; use 'Ver tabela' para os valores.">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="rev" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={S1} stopOpacity={0.28} />
                  <stop offset="100%" stopColor={S1} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#262839" vertical={false} />
              <XAxis dataKey="day" tickFormatter={(d: string) => d.slice(8, 10) + '/' + d.slice(5, 7)} stroke="#9a9cb0" fontSize={11} tickLine={false} axisLine={false} minTickGap={24} />
              <YAxis tickFormatter={compact} stroke="#9a9cb0" fontSize={11} tickLine={false} axisLine={false} width={72} />
              <Tooltip
                cursor={{ stroke: '#34374b' }}
                contentStyle={{ background: '#181a26', border: '1px solid #34374b', borderRadius: 12, fontSize: 12, color: '#ececf3' }}
                labelFormatter={(d) => dateBR(String(d))}
                formatter={(v, name) => [formatBRL(BigInt(Math.round(Number(v)))), name === 'revenue' ? 'Receita' : 'Lucro bruto']}
              />
              <Area type="monotone" dataKey="revenue" stroke={S1} strokeWidth={2} fill="url(#rev)" isAnimationActive={false} activeDot={{ r: 4, strokeWidth: 2, stroke: '#12131c' }} />
              {hasProfit && <Line type="monotone" dataKey="profit" stroke={S2} strokeWidth={2} strokeDasharray="5 4" dot={false} isAnimationActive={false} activeDot={{ r: 4, strokeWidth: 2, stroke: '#12131c' }} />}
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

/** Ranking em barras horizontais de uma cor (magnitude), com valor rotulado. */
export function BarList({ items, empty = 'Sem dados no período.' }: { items: { label: string; valueCents: string; hint?: string }[]; empty?: string }) {
  if (!items.length) return <p className="py-8 text-center text-sm text-muted">{empty}</p>;
  const max = items.reduce((m, i) => (BigInt(i.valueCents) > m ? BigInt(i.valueCents) : m), 1n);
  return (
    <ul className="flex flex-col gap-3">
      {items.map((i) => {
        const w = Number((BigInt(i.valueCents) * 1000n) / max) / 10;
        return (
          <li key={i.label} title={`${i.label}: ${formatBRL(i.valueCents)}`}>
            <div className="mb-1 flex justify-between gap-2 text-sm">
              <span className="truncate">{i.label}{i.hint && <span className="ml-1 text-xs text-muted">{i.hint}</span>}</span>
              <span className="tabular text-muted">{formatBRL(i.valueCents)}</span>
            </div>
            <div className="h-1.5 rounded-full bg-surface-3"><div className="h-1.5 rounded-full" style={{ width: `${Math.max(2, w)}%`, background: S1 }} /></div>
          </li>
        );
      })}
    </ul>
  );
}

// Entradas/saídas: polaridade (acima/abaixo de zero) + par de cores validado no fundo escuro.
const IN = '#24a878';
const OUT = '#e5534b';
const tooltipStyle = { background: '#181a26', border: '1px solid #34374b', borderRadius: 12, fontSize: 12, color: '#ececf3' };
const shortDay = (d: string) => d.slice(8, 10) + '/' + d.slice(5, 7);

export interface CashPoint { day: string; inCents: string; outCents: string; balanceCents: string | null }

/** Entradas (para cima) e saídas (para baixo) por dia + saldo ao fim do dia em gráfico próprio (escalas diferentes). */
export function CashFlowChart({ data }: { data: CashPoint[] }) {
  const [table, setTable] = useState(false);
  const rows = data.map((d) => ({ day: d.day, in: Number(d.inCents), out: -Number(d.outCents), balance: d.balanceCents === null ? null : Number(d.balanceCents) }));
  const empty = rows.every((r) => r.in === 0 && r.out === 0);
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <ul className="flex gap-4 text-xs text-muted" aria-label="Legenda">
          <li className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm" style={{ background: IN }} />Entradas (acima)</li>
          <li className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm" style={{ background: OUT }} />Saídas (abaixo)</li>
        </ul>
        <button className="text-xs text-primary-soft hover:underline" onClick={() => setTable(!table)}>{table ? 'Ver gráfico' : 'Ver tabela'}</button>
      </div>
      {table ? (
        <div className="max-h-72 overflow-y-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-muted"><th className="py-1">Dia</th><th className="text-right">Entradas</th><th className="text-right">Saídas</th><th className="text-right">Saldo no fim do dia</th></tr></thead>
            <tbody>{data.map((r) => <tr key={r.day} className="border-t border-line/60"><td className="py-1">{dateBR(r.day)}</td><td className="text-right tabular">{formatBRL(r.inCents)}</td><td className="text-right tabular">{formatBRL(r.outCents)}</td><td className="text-right tabular">{r.balanceCents === null ? '—' : formatBRL(r.balanceCents)}</td></tr>)}</tbody>
          </table>
        </div>
      ) : empty ? (
        <p className="py-16 text-center text-sm text-muted">Nenhuma entrada ou saída neste período.</p>
      ) : (
        <>
          <div className="h-56" role="img" aria-label="Entradas e saídas por dia; use 'Ver tabela' para os valores.">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} stackOffset="sign" barCategoryGap={rows.length > 20 ? 2 : '25%'}>
                <CartesianGrid stroke="#262839" vertical={false} />
                <XAxis dataKey="day" tickFormatter={shortDay} stroke="#9a9cb0" fontSize={11} tickLine={false} axisLine={false} minTickGap={24} />
                <YAxis tickFormatter={(v: number) => compact(Math.abs(v)).replace(/^/, v < 0 ? '−' : '')} stroke="#9a9cb0" fontSize={11} tickLine={false} axisLine={false} width={76} />
                <ReferenceLine y={0} stroke="#34374b" />
                <Tooltip cursor={{ fill: 'rgba(138,98,255,0.08)' }} contentStyle={tooltipStyle} labelFormatter={(d) => dateBR(String(d))}
                  formatter={(v, name) => [formatBRL(BigInt(Math.abs(Math.round(Number(v))))), name === 'in' ? 'Entradas' : 'Saídas']} />
                <Bar dataKey="in" stackId="f" fill={IN} radius={[4, 4, 0, 0]} isAnimationActive={false} />
                <Bar dataKey="out" stackId="f" fill={OUT} radius={[4, 4, 0, 0]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="mb-1 mt-4 text-xs font-medium text-muted">Saldo das contas no fim de cada dia</p>
          <div className="h-28" role="img" aria-label="Saldo no fim de cada dia">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={rows} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="bal" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={S1} stopOpacity={0.3} /><stop offset="100%" stopColor={S1} stopOpacity={0} /></linearGradient>
                </defs>
                <XAxis dataKey="day" hide />
                <YAxis tickFormatter={compact} stroke="#9a9cb0" fontSize={10} tickLine={false} axisLine={false} width={76} domain={['auto', 'auto']} />
                <Tooltip cursor={{ stroke: '#34374b' }} contentStyle={tooltipStyle} labelFormatter={(d) => dateBR(String(d))} formatter={(v) => [formatBRL(BigInt(Math.round(Number(v)))), 'Saldo']} />
                <Area type="monotone" dataKey="balance" stroke={S1} strokeWidth={2} fill="url(#bal)" connectNulls={false} isAnimationActive={false} activeDot={{ r: 4, strokeWidth: 2, stroke: '#12131c' }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </div>
  );
}

/** Participação de cada item no total (barra + %), para canais e formas de pagamento. */
export function ShareList({ items, empty = 'Sem dados no período.' }: { items: { label: string; valueCents: string; hint?: string }[]; empty?: string }) {
  if (!items.length) return <p className="py-10 text-center text-sm text-muted">{empty}</p>;
  const total = items.reduce((a, i) => a + BigInt(i.valueCents), 0n) || 1n;
  return (
    <ul className="flex flex-col gap-3.5">
      {items.map((i) => {
        const share = Number((BigInt(i.valueCents) * 1000n) / total) / 10;
        return (
          <li key={i.label} title={`${i.label}: ${formatBRL(i.valueCents)} (${share.toLocaleString('pt-BR')}%)`}>
            <div className="mb-1.5 flex items-baseline justify-between gap-2 text-sm">
              <span className="truncate font-medium">{i.label}{i.hint && <span className="ml-1.5 text-xs font-normal text-muted">{i.hint}</span>}</span>
              <span className="shrink-0 tabular"><span className="mr-2 text-xs text-muted">{share.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%</span>{formatBRL(i.valueCents)}</span>
            </div>
            <div className="h-2 rounded-full bg-surface-3"><div className="h-2 rounded-full" style={{ width: `${Math.max(2, share)}%`, background: S1 }} /></div>
          </li>
        );
      })}
    </ul>
  );
}
