'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { UserPlus, X } from 'lucide-react';
import { api, qs } from '@/lib/client/api';
import { brl } from '@/lib/client/format';
import { Button, Field, FormError, Input, Modal, Select } from '@/components/ui';
import { useDebounced } from './hooks';

export interface PickedParty { id: string; name: string; phone?: string | null; storeCreditCents?: string; receivableCents?: string }

export function PartyPicker({ value, onChange, role = 'all', label = 'Cliente', required }: { value: PickedParty | null; onChange: (p: PickedParty | null) => void; role?: 'customer' | 'supplier' | 'all'; label?: string; required?: boolean }) {
  const [term, setTerm] = useState('');
  const [creating, setCreating] = useState(false);
  const t = useDebounced(term.trim(), 200);
  const q = useQuery({
    queryKey: ['parties-search', t, role],
    queryFn: () => api<{ data: PickedParty[] }>(`parties${qs({ q: t, role, limit: 8 })}`),
    enabled: t.length >= 2,
  });
  if (value) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-xl border border-line bg-bg px-3 py-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{value.name}</p>
          <p className="text-xs text-muted">
            {value.phone ?? ''}
            {value.storeCreditCents && value.storeCreditCents !== '0' ? ` · crédito da loja ${brl(value.storeCreditCents)}` : ''}
            {value.receivableCents && value.receivableCents !== '0' ? ` · deve ${brl(value.receivableCents)}` : ''}
          </p>
        </div>
        <button type="button" onClick={() => onChange(null)} className="rounded-lg p-1 text-muted hover:text-fg" aria-label={`Remover ${label.toLowerCase()}`}><X className="size-4" /></button>
      </div>
    );
  }
  return (
    <div className="relative">
      <div className="flex gap-2">
        <Input value={term} onChange={(e) => setTerm(e.target.value)} placeholder={`Buscar ${label.toLowerCase()} por nome, telefone ou documento${required ? '' : ' (opcional)'}`} aria-label={label} />
        <Button type="button" variant="secondary" onClick={() => setCreating(true)} aria-label={`Cadastrar ${label.toLowerCase()}`}><UserPlus className="size-4" /></Button>
      </div>
      {t.length >= 2 && (
        <div className="absolute inset-x-0 top-full z-20 mt-1 max-h-72 overflow-y-auto rounded-xl border border-line bg-surface-2 p-1 shadow-2xl">
          {q.data?.data.map((p) => (
            <button key={p.id} type="button" className="flex w-full flex-col rounded-lg px-3 py-2 text-left text-sm hover:bg-surface-3" onClick={() => { onChange(p); setTerm(''); }}>
              <span className="font-medium">{p.name}</span>
              <span className="text-xs text-muted">{p.phone ?? ''}</span>
            </button>
          ))}
          {q.data && q.data.data.length === 0 && (
            <button type="button" className="w-full rounded-lg px-3 py-2 text-left text-sm text-primary-soft hover:bg-surface-3" onClick={() => setCreating(true)}>
              + Cadastrar “{t}”
            </button>
          )}
        </div>
      )}
      <QuickParty open={creating} initialName={term} role={role} onClose={() => setCreating(false)} onCreated={(p) => { onChange(p); setTerm(''); setCreating(false); }} />
    </div>
  );
}

export function QuickParty({ open, onClose, onCreated, initialName = '', role }: { open: boolean; onClose: () => void; onCreated: (p: PickedParty) => void; initialName?: string; role: 'customer' | 'supplier' | 'all' }) {
  const [form, setForm] = useState({ name: initialName, phone: '', document: '', personType: 'PF' });
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const qc = useQueryClient();
  return (
    <Modal open={open} onClose={onClose} title="Cadastro rápido" footer={<>
      <Button variant="secondary" onClick={onClose}>Cancelar</Button>
      <Button loading={loading} onClick={async () => {
        setLoading(true);
        setError(null);
        try {
          const r = await api<{ id: string; name: string }>('parties', { body: { name: form.name || initialName, phone: form.phone || null, document: form.document || null, personType: form.personType, isCustomer: role !== 'supplier', isSupplier: role !== 'customer' } });
          qc.invalidateQueries({ queryKey: ['parties'] });
          onCreated({ id: r.id, name: r.name, phone: form.phone });
        } catch (e) { setError(e); } finally { setLoading(false); }
      }}>Salvar</Button>
    </>}>
      <div className="flex flex-col gap-3">
        <Field label="Nome" required htmlFor="qp-name"><Input id="qp-name" defaultValue={initialName} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Tipo" htmlFor="qp-type"><Select id="qp-type" value={form.personType} onChange={(e) => setForm({ ...form, personType: e.target.value })}><option value="PF">Pessoa física</option><option value="PJ">Pessoa jurídica</option></Select></Field>
          <Field label="Telefone" htmlFor="qp-phone"><Input id="qp-phone" inputMode="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
        </div>
        <Field label={form.personType === 'PF' ? 'CPF' : 'CNPJ'} htmlFor="qp-doc" help="Obrigatório para identificar quem vende itens usados à loja."><Input id="qp-doc" inputMode="numeric" value={form.document} onChange={(e) => setForm({ ...form, document: e.target.value })} /></Field>
        <FormError error={error} />
      </div>
    </Modal>
  );
}
