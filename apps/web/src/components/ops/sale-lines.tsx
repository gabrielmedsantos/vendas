'use client';

import { Minus, Plus, Trash2 } from 'lucide-react';
import { formatBRL } from '@gct/shared';
import { Button, Input, MoneyInput } from '@/components/ui';
import type { PickedVariant } from './product-picker';
import { UnitPicker } from './unit-picker';

export interface SaleLine {
  key: string;
  variant: PickedVariant;
  quantity: number;
  unitPriceCents: string;
  unitId?: string;
  unitCode?: string;
  unitCostCents?: string | null;
}

export function lineFromVariant(v: PickedVariant): SaleLine {
  return { key: crypto.randomUUID(), variant: v, quantity: 1, unitPriceCents: v.retailPriceCents, unitId: v.unitId, unitCode: v.unitCode, unitCostCents: v.unitCostCentsSpecific ?? v.unitCostCents ?? null };
}

/** Preço de atacado aplicado automaticamente quando a quantidade atinge o mínimo. */
function priceFor(v: PickedVariant, qty: number): string {
  if (v.wholesalePriceCents && v.wholesaleMinQty && qty >= v.wholesaleMinQty) return v.wholesalePriceCents;
  return v.retailPriceCents;
}

export function SaleLines({ lines, onChange, showCost }: { lines: SaleLine[]; onChange: (l: SaleLine[]) => void; showCost: boolean }) {
  const set = (i: number, patch: Partial<SaleLine>) => onChange(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const usedUnits = lines.map((l) => l.unitId).filter(Boolean) as string[];
  if (!lines.length) return <p className="py-6 text-center text-sm text-muted">Busque produtos acima para adicionar à operação.</p>;
  return (
    <ul className="flex flex-col gap-3">
      {lines.map((l, i) => {
        const serial = l.variant.tracking === 'serialized';
        const over = !serial && l.variant.kind === 'physical' && l.quantity > l.variant.available;
        return (
          <li key={l.key} className="rounded-xl border border-line bg-bg p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate font-medium">{l.variant.name}{l.variant.label ? ` · ${l.variant.label}` : ''}</p>
                <p className="text-xs text-muted">{l.variant.sku}{l.variant.kind === 'service' ? ' · serviço' : serial ? '' : ` · ${l.variant.available} disponível(is)`}{showCost && l.unitCostCents ? ` · custo ${formatBRL(l.unitCostCents)}` : ''}</p>
              </div>
              <Button type="button" variant="quiet" size="sm" onClick={() => onChange(lines.filter((_, j) => j !== i))} aria-label={`Remover ${l.variant.name}`}><Trash2 className="size-4" /></Button>
            </div>
            {serial && (
              <div className="mt-2">
                <UnitPicker variantId={l.variant.variantId} value={l.unitId} exclude={usedUnits} onChange={(id, code, cost) => set(i, { unitId: id, unitCode: code, unitCostCents: cost ?? l.unitCostCents })} />
              </div>
            )}
            <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
              <div className="flex items-center gap-1" aria-label="Quantidade">
                <Button type="button" variant="secondary" size="sm" disabled={serial || l.quantity <= 1} onClick={() => set(i, { quantity: l.quantity - 1, unitPriceCents: priceFor(l.variant, l.quantity - 1) })} aria-label="Diminuir"><Minus className="size-3.5" /></Button>
                <Input type="number" min={1} value={l.quantity} disabled={serial} onChange={(e) => { const n = Math.max(1, Number(e.target.value) || 1); set(i, { quantity: n, unitPriceCents: priceFor(l.variant, n) }); }} className="h-8 w-16 text-center" aria-label="Quantidade" />
                <Button type="button" variant="secondary" size="sm" disabled={serial} onClick={() => set(i, { quantity: l.quantity + 1, unitPriceCents: priceFor(l.variant, l.quantity + 1) })} aria-label="Aumentar"><Plus className="size-3.5" /></Button>
              </div>
              <div className="w-36"><MoneyInput value={l.unitPriceCents} onChange={(c) => set(i, { unitPriceCents: c })} ariaLabel="Preço unitário" /></div>
              <div className="text-right text-sm"><span className="block text-[11px] text-muted">Subtotal</span><span className="font-medium tabular">{formatBRL(BigInt(l.unitPriceCents || '0') * BigInt(l.quantity))}</span></div>
            </div>
            {over && <p role="alert" className="mt-2 text-xs text-warning">Quantidade acima do disponível; a confirmação será recusada se o estoque não bastar.</p>}
          </li>
        );
      })}
    </ul>
  );
}
