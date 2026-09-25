'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/client/api';
import { Select } from '@/components/ui';

interface Unit { id: string; internalCode: string; condition: string | null; batteryHealthPct: number | null; identifiers: { kind: string; value: string }[]; costCents?: string | null }

export function UnitPicker({ variantId, value, onChange, exclude = [] }: { variantId: string; value?: string; onChange: (unitId: string, code: string, cost?: string | null) => void; exclude?: string[] }) {
  const q = useQuery({ queryKey: ['units', variantId], queryFn: () => api<Unit[]>(`variants/${variantId}/units`) });
  const units = (q.data ?? []).filter((u) => !exclude.includes(u.id) || u.id === value);
  return (
    <Select
      aria-label="Unidade"
      value={value ?? ''}
      onChange={(e) => {
        const u = units.find((x) => x.id === e.target.value);
        if (u) onChange(u.id, u.internalCode, u.costCents);
      }}
    >
      <option value="">{q.isLoading ? 'Carregando…' : units.length ? 'Escolha a unidade (IMEI/série)' : 'Nenhuma unidade disponível'}</option>
      {units.map((u) => (
        <option key={u.id} value={u.id}>
          {u.internalCode} · {u.identifiers.map((i) => i.value).join(' / ') || 'sem identificador'}{u.condition ? ` · ${u.condition}` : ''}
        </option>
      ))}
    </Select>
  );
}
