'use client';

import { useState } from 'react';
import { Button, Field, FormError, Input, Modal, Select, Textarea } from '@/components/ui';

export interface PartyFormValue {
  personType: 'PF' | 'PJ'; name: string; tradeName: string; document: string; email: string; phone: string; city: string; state: string;
  street: string; number: string; district: string; zip: string; isCustomer: boolean; isSupplier: boolean; notes: string;
}

export const emptyParty = (): PartyFormValue => ({ personType: 'PF', name: '', tradeName: '', document: '', email: '', phone: '', city: '', state: '', street: '', number: '', district: '', zip: '', isCustomer: true, isSupplier: false, notes: '' });

export function partyToApi(v: PartyFormValue) {
  return {
    personType: v.personType, name: v.name, tradeName: v.tradeName || null, document: v.document || null, email: v.email || null, phone: v.phone || null,
    city: v.city || null, state: v.state || null, address: { street: v.street || undefined, number: v.number || undefined, district: v.district || undefined, zip: v.zip || undefined },
    isCustomer: v.isCustomer, isSupplier: v.isSupplier, notes: v.notes || null,
  };
}

export function PartyModal({ open, onClose, initial, title, onSubmit }: { open: boolean; onClose: () => void; initial: PartyFormValue; title: string; onSubmit: (v: PartyFormValue) => Promise<void> }) {
  const [v, setV] = useState(initial);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const set = (k: keyof PartyFormValue) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setV({ ...v, [k]: e.target.type === 'checkbox' ? (e.target as HTMLInputElement).checked : e.target.value });
  const fe = (error as { fields?: Record<string, string> } | null)?.fields ?? {};
  return (
    <Modal open={open} onClose={onClose} title={title} wide footer={<>
      <Button variant="secondary" onClick={onClose}>Cancelar</Button>
      <Button loading={loading} onClick={async () => { setLoading(true); setError(null); try { await onSubmit(v); } catch (e) { setError(e); } finally { setLoading(false); } }}>Salvar</Button>
    </>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Tipo" htmlFor="pf-type"><Select id="pf-type" value={v.personType} onChange={set('personType')}><option value="PF">Pessoa física</option><option value="PJ">Pessoa jurídica</option></Select></Field>
        <fieldset className="flex items-end gap-4 text-sm">
          <legend className="sr-only">Papéis</legend>
          <label className="flex items-center gap-2"><input type="checkbox" className="accent-[var(--color-primary)]" checked={v.isCustomer} onChange={set('isCustomer')} />Cliente</label>
          <label className="flex items-center gap-2"><input type="checkbox" className="accent-[var(--color-primary)]" checked={v.isSupplier} onChange={set('isSupplier')} />Fornecedor</label>
        </fieldset>
        <Field label={v.personType === 'PJ' ? 'Razão social' : 'Nome'} htmlFor="pf-name" required error={fe.name}><Input id="pf-name" value={v.name} onChange={set('name')} /></Field>
        {v.personType === 'PJ' && <Field label="Nome fantasia" htmlFor="pf-trade"><Input id="pf-trade" value={v.tradeName} onChange={set('tradeName')} /></Field>}
        <Field label={v.personType === 'PJ' ? 'CNPJ' : 'CPF'} htmlFor="pf-doc" error={fe.document} help="Opcional em venda à vista; recomendado em compra de usados e venda a prazo."><Input id="pf-doc" inputMode="numeric" value={v.document} onChange={set('document')} /></Field>
        <Field label="Telefone / WhatsApp" htmlFor="pf-phone"><Input id="pf-phone" inputMode="tel" value={v.phone} onChange={set('phone')} /></Field>
        <Field label="E-mail" htmlFor="pf-email" error={fe.email}><Input id="pf-email" type="email" value={v.email} onChange={set('email')} /></Field>
        <Field label="Endereço" htmlFor="pf-street"><Input id="pf-street" value={v.street} onChange={set('street')} /></Field>
        <div className="grid grid-cols-3 gap-2">
          <Field label="Número" htmlFor="pf-num"><Input id="pf-num" value={v.number} onChange={set('number')} /></Field>
          <div className="col-span-2"><Field label="Bairro" htmlFor="pf-dist"><Input id="pf-dist" value={v.district} onChange={set('district')} /></Field></div>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div className="col-span-2"><Field label="Cidade" htmlFor="pf-city"><Input id="pf-city" value={v.city} onChange={set('city')} /></Field></div>
          <Field label="UF" htmlFor="pf-uf"><Input id="pf-uf" maxLength={2} value={v.state} onChange={set('state')} /></Field>
        </div>
        <Field label="CEP" htmlFor="pf-zip"><Input id="pf-zip" inputMode="numeric" value={v.zip} onChange={set('zip')} /></Field>
        <div className="sm:col-span-2"><Field label="Observações internas" htmlFor="pf-notes"><Textarea id="pf-notes" value={v.notes} onChange={set('notes')} /></Field></div>
        <div className="sm:col-span-2"><FormError error={error} /></div>
      </div>
    </Modal>
  );
}
