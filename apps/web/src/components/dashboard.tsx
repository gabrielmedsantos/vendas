'use client';

import type { ReactNode } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, HelpCircle, TrendingDown, TrendingUp } from 'lucide-react';
import { addDays } from '@gct/shared';
import { cx } from '@/components/ui';
import { pct } from '@/lib/client/format';

/**
 * Cartões de indicador em gradiente (paleta FlowPay). Cada gradiente tem contraste ≥ 4,5:1
 * com texto branco na cor mais clara, então rótulos pequenos continuam legíveis.
 */
const GRADIENT = {
  violet: 'from-[#7b4ff5] to-[#4c2bbf]',
  blue: 'from-[#2563eb] to-[#1e3a8a]',
  teal: 'from-[#0e7490] to-[#134e5e]',
  green: 'from-[#0b6b53] to-[#064e3b]',
  amber: 'from-[#c2410c] to-[#7c2d12]',
} as const;
export type KpiTone = keyof typeof GRADIENT;

export function KpiCard({ label, value, tone, icon, growthBps, hint, info }: {
  label: string; value: ReactNode; tone: KpiTone; icon?: ReactNode; growthBps?: number | null; hint?: ReactNode; info?: string;
}) {
  return (
    <div className={cx('relative overflow-hidden rounded-[var(--radius-card)] bg-gradient-to-br p-4 text-white shadow-lg shadow-black/20 sm:p-5', GRADIENT[tone])}>
      <span className="pointer-events-none absolute -right-6 -top-6 size-28 rounded-full bg-white/10" aria-hidden />
      <span className="pointer-events-none absolute -bottom-10 right-10 size-24 rounded-full bg-white/5" aria-hidden />
      <div className="relative flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-sm font-medium">
          {label}
          {info && <span title={info} aria-label={info} className="cursor-help"><HelpCircle className="size-3.5" /></span>}
        </span>
        {icon && <span className="flex size-8 items-center justify-center rounded-xl bg-white/15" aria-hidden>{icon}</span>}
      </div>
      <div className="relative mt-3 text-2xl font-bold tracking-tight tabular sm:text-[1.75rem]">{value}</div>
      <div className="relative mt-2 flex flex-wrap items-center gap-2 text-xs">
        {growthBps !== undefined && <GrowthChip bps={growthBps} />}
        {hint && <span>{hint}</span>}
      </div>
    </div>
  );
}

export function GrowthChip({ bps, onDark = true }: { bps: number | null; onDark?: boolean }) {
  if (bps === null) return <span className={cx('rounded-full px-2 py-0.5 font-medium', onDark ? 'bg-white/15' : 'bg-surface-3 text-muted')}>sem comparação</span>;
  const up = bps >= 0;
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <span className={cx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold', onDark ? 'bg-white/15' : up ? 'bg-success/10 text-success' : 'bg-danger/10 text-danger-soft')}>
      <Icon className="size-3" aria-hidden />{up ? '+' : '−'}{pct(Math.abs(bps))}
      <span className="sr-only">{up ? 'de alta' : 'de queda'}</span>
      <span className="font-normal opacity-90">vs período anterior</span>
    </span>
  );
}

/** Indicador compacto em superfície (entradas/saídas/saldo). */
export function Tile({ label, value, tone = 'default', icon, hint, info }: { label: string; value: ReactNode; tone?: 'default' | 'in' | 'out' | 'primary'; icon?: ReactNode; hint?: ReactNode; info?: string }) {
  const ring = { default: 'bg-surface-3 text-muted', in: 'bg-[#24a878]/15 text-success', out: 'bg-danger/15 text-danger-soft', primary: 'bg-primary/15 text-primary-soft' }[tone];
  const text = { default: 'text-fg', in: 'text-success', out: 'text-danger-soft', primary: 'text-fg' }[tone];
  return (
    <div className="flex items-start gap-3 rounded-[var(--radius-card)] border border-line bg-surface p-4">
      {icon && <span className={cx('flex size-10 shrink-0 items-center justify-center rounded-xl', ring)} aria-hidden>{icon}</span>}
      <div className="min-w-0">
        <p className="flex items-center gap-1 text-xs text-muted">{label}{info && <span title={info} aria-label={info} className="cursor-help"><HelpCircle className="size-3" /></span>}</p>
        <p className={cx('mt-0.5 truncate text-lg font-semibold tabular sm:text-xl', text)}>{value}</p>
        {hint && <p className="mt-0.5 text-[11px] text-muted">{hint}</p>}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ período

export interface Range { from: string; to: string }
const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

export function monthOf(date: string): Range {
  const [y, m] = [Number(date.slice(0, 4)), Number(date.slice(5, 7))];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${date.slice(0, 7)}-01`, to: `${date.slice(0, 7)}-${String(last).padStart(2, '0')}` };
}
const isMonth = (r: Range) => r.from.endsWith('-01') && monthOf(r.from).to === r.to;
const days = (r: Range) => Math.round((Date.parse(r.to) - Date.parse(r.from)) / 86400000) + 1;
const br = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;

export function rangeLabel(r: Range): string {
  if (isMonth(r)) return `${MONTHS[Number(r.from.slice(5, 7)) - 1]} de ${r.from.slice(0, 4)}`;
  return r.from === r.to ? br(r.from) : `${br(r.from)} a ${br(r.to)}`;
}

export function shiftRange(r: Range, dir: -1 | 1): Range {
  if (isMonth(r)) {
    const [y, m] = [Number(r.from.slice(0, 4)), Number(r.from.slice(5, 7)) + dir];
    const d = new Date(Date.UTC(y, m - 1, 1));
    return monthOf(d.toISOString().slice(0, 10));
  }
  const n = days(r) * dir;
  return { from: addDays(r.from, n), to: addDays(r.to, n) };
}

export function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** ‹ Outubro de 2026 › com atalhos e intervalo livre. */
export function PeriodNav({ value, onChange }: { value: Range; onChange: (r: Range) => void }) {
  const today = todayISO();
  const presets: { id: string; label: string; range: Range }[] = [
    { id: 'month', label: 'Este mês', range: monthOf(today) },
    { id: 'last_month', label: 'Mês passado', range: monthOf(addDays(monthOf(today).from, -1)) },
    { id: '7d', label: 'Últimos 7 dias', range: { from: addDays(today, -6), to: today } },
    { id: '30d', label: 'Últimos 30 dias', range: { from: addDays(today, -29), to: today } },
    { id: 'today', label: 'Hoje', range: { from: today, to: today } },
    { id: 'year', label: 'Este ano', range: { from: `${today.slice(0, 4)}-01-01`, to: `${today.slice(0, 4)}-12-31` } },
  ];
  const current = presets.find((p) => p.range.from === value.from && p.range.to === value.to)?.id ?? 'custom';
  const btn = 'flex size-10 items-center justify-center rounded-xl border border-line bg-surface hover:border-line-strong hover:bg-surface-2';
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" className={btn} aria-label="Período anterior" onClick={() => onChange(shiftRange(value, -1))}><ChevronLeft className="size-4" /></button>
      <label className="relative flex h-10 items-center gap-2 rounded-xl border border-line bg-surface pl-3 pr-2 text-sm font-medium hover:border-line-strong">
        <CalendarDays className="size-4 text-muted" aria-hidden />
        <span className="first-letter:uppercase">{rangeLabel(value)}</span>
        <select aria-label="Período" className="absolute inset-0 cursor-pointer opacity-0" value={current}
          onChange={(e) => { const p = presets.find((x) => x.id === e.target.value); if (p) onChange(p.range); }}>
          {presets.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          {current === 'custom' && <option value="custom">Personalizado</option>}
        </select>
      </label>
      <button type="button" className={btn} aria-label="Próximo período" onClick={() => onChange(shiftRange(value, 1))}><ChevronRight className="size-4" /></button>
      <div className="flex items-center gap-1 text-xs text-muted">
        <input type="date" aria-label="De" className="h-10 rounded-xl border border-line bg-surface px-2 text-fg [color-scheme:dark]" value={value.from} max={value.to} onChange={(e) => e.target.value && onChange({ from: e.target.value, to: value.to < e.target.value ? e.target.value : value.to })} />
        <span>a</span>
        <input type="date" aria-label="Até" className="h-10 rounded-xl border border-line bg-surface px-2 text-fg [color-scheme:dark]" value={value.to} min={value.from} onChange={(e) => e.target.value && onChange({ from: value.from > e.target.value ? e.target.value : value.from, to: e.target.value })} />
      </div>
    </div>
  );
}
