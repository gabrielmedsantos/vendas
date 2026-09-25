'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { FileText, ShieldCheck } from 'lucide-react';
import { useToast } from '@/components/toast';
import { Badge, Button, Field, FormError, Modal, Select, Textarea } from '@/components/ui';
import { api, qs } from '@/lib/client/api';
import { dateBR } from '@/lib/client/format';
import { useCan } from '@/lib/client/session';

export type WarrantyStatus = 'open' | 'in_progress' | 'resolved' | 'rejected';
export interface WarrantyRow { id: string; number: string; status: WarrantyStatus; description: string; resolution: string | null; createdAt: string; saleId: string; saleNumber: string | null; partyName: string | null; itemDescription: string | null }
export const WARRANTY_LABEL: Record<WarrantyStatus, string> = { open: 'Aberta', in_progress: 'Em análise', resolved: 'Resolvida', rejected: 'Recusada' };
const TONE: Record<WarrantyStatus, 'neutral' | 'info' | 'success' | 'danger'> = { open: 'neutral', in_progress: 'info', resolved: 'success', rejected: 'danger' };

export function WarrantyBadge({ status }: { status: WarrantyStatus }) {
  return <Badge tone={TONE[status]}>{WARRANTY_LABEL[status]}</Badge>;
}

/** Ações do caso: análise, conclusão com solução/recusa e termo em PDF. */
export function WarrantyActions({ row }: { row: WarrantyRow }) {
  const qc = useQueryClient();
  const toast = useToast();
  const can = useCan();
  const [closing, setClosing] = useState<null | 'resolved' | 'rejected'>(null);
  const [text, setText] = useState('');
  const [error, setError] = useState<unknown>(null);
  const move = async (status: WarrantyStatus, resolution?: string) => {
    setError(null);
    try {
      await api(`warranty-cases/${row.id}/status`, { body: { status, resolution } });
      toast(`Garantia nº ${row.number}: ${WARRANTY_LABEL[status].toLowerCase()}.`);
      setClosing(null);
      setText('');
      await qc.invalidateQueries({ queryKey: ['warranty-cases'] });
    } catch (e) { setError(e); }
  };
  const final = row.status === 'resolved' || row.status === 'rejected';
  return (
    <div className="flex flex-wrap justify-end gap-1">
      {can('sales.create') && row.status === 'open' && <Button size="sm" variant="secondary" onClick={() => move('in_progress')}>Analisar</Button>}
      {can('sales.create') && !final && <Button size="sm" variant="secondary" onClick={() => setClosing('resolved')}>Concluir</Button>}
      <Button size="sm" variant="quiet" onClick={async () => { await api(`warranty-cases/${row.id}/document`, { method: 'POST' }); toast('Termo solicitado; ele aparece na venda em instantes.'); qc.invalidateQueries({ queryKey: ['sale', row.saleId] }); }}><FileText className="size-3.5" />Termo</Button>
      <Modal open={!!closing} onClose={() => setClosing(null)} title={`Concluir garantia nº ${row.number}`} footer={<>
        <Button variant="secondary" onClick={() => setClosing(null)}>Voltar</Button>
        <Button disabled={text.trim().length < 3} onClick={() => move(closing!, text.trim())}>Confirmar</Button>
      </>}>
        <div className="flex flex-col gap-3">
          <Field label="Resultado" htmlFor="wc-result">
            <Select id="wc-result" value={closing ?? 'resolved'} onChange={(e) => setClosing(e.target.value as 'resolved' | 'rejected')}>
              <option value="resolved">Resolvida (reparo, troca ou devolução)</option>
              <option value="rejected">Recusada (fora das condições)</option>
            </Select>
          </Field>
          <Field label={closing === 'rejected' ? 'Motivo da recusa' : 'Solução aplicada'} htmlFor="wc-text" required help="Devolução de dinheiro ou troca de produto deve ser registrada na venda (Registrar devolução).">
            <Textarea id="wc-text" rows={3} value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} />
          </Field>
          <FormError error={error} />
        </div>
      </Modal>
    </div>
  );
}

/** Bloco na venda: casos existentes e abertura de novo caso por item. */
export function SaleWarranty({ saleId, items, canOpen }: { saleId: string; items: { id: string; description: string; productKind: string }[]; canOpen: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const list = useQuery({ queryKey: ['warranty-cases', 'sale', saleId], queryFn: () => api<{ data: WarrantyRow[] }>(`warranty-cases${qs({ saleId })}`) });
  const [open, setOpen] = useState(false);
  const [itemId, setItemId] = useState(items[0]?.id ?? '');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<unknown>(null);
  const rows = list.data?.data ?? [];
  return (
    <div className="flex flex-col gap-2 text-sm">
      {rows.length === 0 ? <p className="text-muted">Nenhum atendimento de garantia.</p> : rows.map((r) => (
        <div key={r.id} className="rounded-xl border border-line bg-bg p-3">
          <div className="flex items-center justify-between gap-2"><span className="font-medium">Nº {r.number} · {r.itemDescription ?? 'Venda'}</span><WarrantyBadge status={r.status} /></div>
          <p className="mt-1 text-xs text-muted">{dateBR(r.createdAt)} · {r.description}</p>
          {r.resolution && <p className="mt-1 text-xs">Resultado: {r.resolution}</p>}
          <div className="mt-2"><WarrantyActions row={r} /></div>
        </div>
      ))}
      {canOpen && <div><Button size="sm" variant="secondary" onClick={() => setOpen(true)}><ShieldCheck className="size-4" />Abrir garantia</Button></div>}
      <Modal open={open} onClose={() => setOpen(false)} title="Abrir atendimento de garantia" footer={<>
        <Button variant="secondary" onClick={() => setOpen(false)}>Cancelar</Button>
        <Button onClick={async () => {
          setError(null);
          try {
            const r = await api<{ number: string }>('warranty-cases', { body: { saleId, saleItemId: itemId || null, description } });
            toast(`Garantia nº ${r.number} aberta.`);
            setOpen(false);
            setDescription('');
            await qc.invalidateQueries({ queryKey: ['warranty-cases'] });
          } catch (e) { setError(e); }
        }}>Abrir</Button>
      </>}>
        <div className="flex flex-col gap-3">
          <Field label="Item" htmlFor="wc-item" help="O prazo é conferido pelo sistema a partir da data da venda.">
            <Select id="wc-item" value={itemId} onChange={(e) => setItemId(e.target.value)}>
              {items.map((i) => <option key={i.id} value={i.id}>{i.description}</option>)}
            </Select>
          </Field>
          <Field label="Problema relatado" htmlFor="wc-desc" required><Textarea id="wc-desc" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={4000} /></Field>
          <FormError error={error} />
        </div>
      </Modal>
    </div>
  );
}

export function SaleLink({ row }: { row: WarrantyRow }) {
  return <Link className="hover:text-primary-soft" href={`/app/vendas/${row.saleId}`}>Venda #{row.saleNumber}</Link>;
}

