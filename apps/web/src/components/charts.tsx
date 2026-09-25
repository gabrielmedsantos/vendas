'use client';

import { useState } from 'react';
import { Area, AreaChart, CartesianGrid, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
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
            <li className="flex items-center gap-1.5"><span className="h-0.5 w-4 rounded border-t-2 border-dashed" style={{ borderColor: S2 }} />Resultado bruto</li>
          </ul>
        ) : <span />}
        <button className="text-xs text-primary-soft hover:underline" onClick={() => setTable(!table)}>{table ? 'Ver gráfico' : 'Ver tabela'}</button>
      </div>
      {table ? (
        <div className="max-h-64 overflow-y-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-muted"><th className="py-1">Dia</th><th className="text-right">Vendas</th><th className="text-right">Receita</th>{hasProfit && <th className="text-right">Resultado bruto</th>}</tr></thead>
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
                formatter={(v, name) => [formatBRL(BigInt(Math.round(Number(v)))), name === 'revenue' ? 'Receita' : 'Resultado bruto']}
              />
              <Area type="monotone" dataKey="revenue" stroke={S1} strokeWidth={2} fill="url(#rev)" activeDot={{ r: 4, strokeWidth: 2, stroke: '#12131c' }} />
              {hasProfit && <Line type="monotone" dataKey="profit" stroke={S2} strokeWidth={2} strokeDasharray="5 4" dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: '#12131c' }} />}
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
