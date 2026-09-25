'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Barcode, Search } from 'lucide-react';
import { api, qs } from '@/lib/client/api';
import { brl } from '@/lib/client/format';
import { Badge, Input } from '@/components/ui';
import { useDebounced } from './hooks';

export interface PickedVariant {
  variantId: string;
  productId: string;
  name: string;
  sku: string;
  label: string;
  kind: string;
  tracking: string;
  retailPriceCents: string;
  wholesalePriceCents: string | null;
  wholesaleMinQty: number | null;
  available: number;
  unitCostCents?: string | null;
  unitId?: string;
  unitCode?: string;
  unitCostCentsSpecific?: string | null;
}

interface SearchResult {
  variants: Omit<PickedVariant, 'unitId' | 'unitCode'>[];
  units: { unitId: string; variantId: string; internalCode: string; status: string; name: string; sku: string; retailPriceCents: string; condition: string | null; costCents?: string | null; matched: string }[];
}

/** Busca rápida por nome, SKU, código de barras ou IMEI/série. */
export function ProductPicker({ onPick, placeholder = 'Buscar produto, SKU, código de barras ou IMEI…', includeInactive }: { onPick: (v: PickedVariant) => void; placeholder?: string; includeInactive?: boolean }) {
  const [term, setTerm] = useState('');
  const t = useDebounced(term.trim(), 200);
  const q = useQuery({
    queryKey: ['search', t, includeInactive],
    queryFn: () => api<SearchResult>(`products/search${qs({ q: t, inactive: includeInactive ? 1 : undefined })}`),
    enabled: t.length >= 2,
  });
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
      <Input value={term} onChange={(e) => setTerm(e.target.value)} placeholder={placeholder} className="pl-9" aria-label="Buscar produto" />
      {t.length >= 2 && (
        <div className="absolute inset-x-0 top-full z-20 mt-1 max-h-80 overflow-y-auto rounded-xl border border-line bg-surface-2 p-1 shadow-2xl">
          {q.isLoading && <p className="px-3 py-2 text-sm text-muted">Buscando…</p>}
          {q.data && q.data.units.map((u) => (
            <button
              key={u.unitId}
              type="button"
              disabled={u.status !== 'available'}
              onClick={() => {
                const v = q.data!.variants.find((x) => x.variantId === u.variantId);
                onPick({
                  variantId: u.variantId, productId: v?.productId ?? '', name: u.name, sku: u.sku, label: '', kind: 'physical', tracking: 'serialized',
                  retailPriceCents: u.retailPriceCents, wholesalePriceCents: null, wholesaleMinQty: null, available: 1, unitId: u.unitId, unitCode: u.internalCode, unitCostCentsSpecific: u.costCents ?? null,
                });
                setTerm('');
              }}
              className="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-surface-3 disabled:opacity-50"
            >
              <span className="flex min-w-0 items-center gap-2"><Barcode className="size-4 text-primary-soft" /><span className="truncate">{u.name} · {u.internalCode} · {u.matched}</span></span>
              <Badge tone={u.status === 'available' ? 'success' : 'neutral'}>{u.status === 'available' ? 'Disponível' : 'Indisponível'}</Badge>
            </button>
          ))}
          {q.data && q.data.variants.map((v) => (
            <button key={v.variantId} type="button" onClick={() => { onPick(v); setTerm(''); }} className="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-surface-3">
              <span className="min-w-0">
                <span className="block truncate font-medium">{v.name}{v.label ? ` · ${v.label}` : ''}</span>
                <span className="block text-xs text-muted">{v.sku} · {v.kind === 'service' ? 'serviço' : `${v.available} disponível(is)`}{v.tracking === 'serialized' ? ' · por unidade' : ''}</span>
              </span>
              <span className="tabular text-sm">{brl(v.retailPriceCents)}</span>
            </button>
          ))}
          {q.data && q.data.variants.length === 0 && q.data.units.length === 0 && <p className="px-3 py-3 text-sm text-muted">Nenhum produto encontrado.</p>}
        </div>
      )}
    </div>
  );
}
