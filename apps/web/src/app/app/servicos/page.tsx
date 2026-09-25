'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Plus, Search, Wrench } from 'lucide-react';
import { useDebounced } from '@/components/ops/hooks';
import { PartyPicker, type PickedParty } from '@/components/ops/party-picker';
import { useToast } from '@/components/toast';
import { Badge, Button, Card, EmptyState, ErrorState, Field, FormError, Input, LoadingBlock, Modal, MoneyInput, PageHeader, Pager, Table, Tabs, Td, Textarea, Th } from '@/components/ui';
import { api, qs } from '@/lib/client/api';
import { brl, dateBR, dateTimeBR } from '@/lib/client/format';
import { useCan } from '@/lib/client/session';

type Status = 'open' | 'in_progress' | 'done' | 'delivered' | 'canceled';
interface Row { id: string; number: string; title: string; status: Status; priceCents: string; dueDate: string | null; partyName: string | null; saleId: string | null; updatedAt: string }
interface Detail extends Row { description: string | null; partyId: string | null; saleNumber: string | null; history: { action: string; data: { from?: string; to?: string; note?: string | null }; createdAt: string }[] }

const LABEL: Record<Status, string> = { open: 'Aberta', in_progress: 'Em andamento', done: 'Pronta', delivered: 'Entregue', canceled: 'Cancelada' };
const TONE: Record<Status, 'neutral' | 'info' | 'success' | 'warning' | 'danger'> = { open: 'neutral', in_progress: 'info', done: 'success', delivered: 'success', canceled: 'danger' };
const NEXT: Record<Status, { to: Status; label: string }[]> = {
  open: [{ to: 'in_progress', label: 'Iniciar' }],
  in_progress: [{ to: 'done', label: 'Marcar pronta' }, { to: 'open', label: 'Voltar para aberta' }],
  done: [{ to: 'delivered', label: 'Entregar ao cliente' }, { to: 'in_progress', label: 'Reabrir' }],
  delivered: [],
  canceled: [],
};

function Editor({ open, onClose, current }: { open: boolean; onClose: () => void; current?: Detail | null }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [title, setTitle] = useState(current?.title ?? '');
  const [description, setDescription] = useState(current?.description ?? '');
  const [price, setPrice] = useState(current?.priceCents ?? '0');
  const [due, setDue] = useState(current?.dueDate ?? '');
  const [party, setParty] = useState<PickedParty | null>(current?.partyId ? { id: current.partyId, name: current.partyName ?? '' } : null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Modal open={open} onClose={onClose} title={current ? `Ordem de serviço nº ${current.number}` : 'Nova ordem de serviço'} footer={
      <>
        <Button variant="secondary" onClick={onClose}>Cancelar</Button>
        <Button loading={busy} onClick={async () => {
          setBusy(true); setError(null);
          const body = { title, description: description || null, priceCents: price || '0', dueDate: due || null, partyId: party?.id ?? null, saleId: current?.saleId ?? null };
          try {
            if (current) await api(`service-orders/${current.id}`, { method: 'PUT', body });
            else await api('service-orders', { body });
            toast(current ? 'Ordem atualizada.' : 'Ordem de serviço criada.');
            await qc.invalidateQueries({ queryKey: ['service-orders'] });
            onClose();
          } catch (e) { setError(e); } finally { setBusy(false); }
        }}>Salvar</Button>
      </>
    }>
      <div className="flex flex-col gap-3">
        <Field label="Serviço" htmlFor="so-title" required><Input id="so-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} placeholder="Ex.: Troca de bateria" /></Field>
        <PartyPicker value={party} onChange={setParty} role="customer" />
        <Field label="Descrição e condição do aparelho" htmlFor="so-desc"><Textarea id="so-desc" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={4000} /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Valor combinado" htmlFor="so-price" help="Cobrança é feita por uma venda do serviço."><MoneyInput id="so-price" value={price} onChange={setPrice} /></Field>
          <Field label="Previsão de entrega" htmlFor="so-due"><Input id="so-due" type="date" value={due} onChange={(e) => setDue(e.target.value)} /></Field>
        </div>
        <FormError error={error} />
      </div>
    </Modal>
  );
}

function DetailModal({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const can = useCan();
  const d = useQuery({ queryKey: ['service-orders', id], queryFn: () => api<Detail>(`service-orders/${id}`) });
  const [edit, setEdit] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [error, setError] = useState<unknown>(null);
  const move = async (to: Status, note?: string) => {
    setError(null);
    try {
      await api(`service-orders/${id}/status`, { body: { status: to, note } });
      toast(`Ordem: ${LABEL[to].toLowerCase()}.`);
      await qc.invalidateQueries({ queryKey: ['service-orders'] });
    } catch (e) { setError(e); }
  };
  const o = d.data;
  return (
    <Modal open onClose={onClose} wide title={o ? `Ordem de serviço nº ${o.number}` : 'Ordem de serviço'}>
      {d.isLoading ? <LoadingBlock rows={3} /> : d.error ? <ErrorState error={d.error} /> : o && (
        <div className="flex flex-col gap-4 text-sm">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="text-base font-medium">{o.title}</p>
              <p className="text-muted">{o.partyName ?? 'Sem cliente'} · {brl(o.priceCents)}{o.dueDate ? ` · previsão ${dateBR(o.dueDate)}` : ''}</p>
            </div>
            <Badge tone={TONE[o.status]}>{LABEL[o.status]}</Badge>
          </div>
          {o.description && <p className="whitespace-pre-wrap rounded-xl border border-line bg-bg p-3">{o.description}</p>}
          {can('sales.create') && (
            <div className="flex flex-wrap gap-2">
              {NEXT[o.status].map((n) => <Button key={n.to} size="sm" variant={n.to === 'done' || n.to === 'delivered' || n.to === 'in_progress' ? 'primary' : 'secondary'} onClick={() => move(n.to)}>{n.label}</Button>)}
              {o.status !== 'delivered' && o.status !== 'canceled' && <Button size="sm" variant="secondary" onClick={() => setEdit(true)}>Editar</Button>}
            </div>
          )}
          {can('sales.create') && (o.status === 'open' || o.status === 'in_progress') && (
            <div className="flex flex-wrap items-end gap-2">
              <Field label="Motivo do cancelamento" htmlFor="so-cancel"><Input id="so-cancel" value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} maxLength={500} /></Field>
              <Button size="sm" variant="danger" disabled={cancelReason.trim().length < 3} onClick={() => move('canceled', cancelReason.trim())}>Cancelar ordem</Button>
            </div>
          )}
          <FormError error={error} />
          <div>
            <p className="mb-2 font-medium">Histórico</p>
            <ol className="flex flex-col gap-1 text-xs text-muted">
              {o.history.map((h, i) => (
                <li key={i}>{dateTimeBR(h.createdAt)} · {h.action === 'service_order.created' ? 'Criada' : h.action === 'service_order.updated' ? 'Editada' : `${LABEL[h.data.from as Status] ?? h.data.from} → ${LABEL[h.data.to as Status] ?? h.data.to}${h.data.note ? ` (${h.data.note})` : ''}`}</li>
              ))}
            </ol>
          </div>
          {edit && <Editor open onClose={() => { setEdit(false); d.refetch(); }} current={o} />}
        </div>
      )}
    </Modal>
  );
}

export default function ServiceOrdersPage() {
  const can = useCan();
  const [status, setStatus] = useState<'' | Status>('');
  const [term, setTerm] = useState('');
  const [cursor, setCursor] = useState<string | undefined>();
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const q = useDebounced(term, 250);
  const list = useQuery({ queryKey: ['service-orders', status, q, cursor], queryFn: () => api<{ data: Row[]; meta: { cursor: string | null; hasMore: boolean } }>(`service-orders${qs({ status: status || undefined, q, cursor })}`) });
  return (
    <div>
      <PageHeader title="Serviços" description="Ordens de serviço simples: recebimento do aparelho, andamento e entrega. A cobrança é feita por uma venda do serviço." actions={can('sales.create') && <Button onClick={() => setCreating(true)}><Plus className="size-4" />Nova ordem</Button>} />
      <Card>
        <div className="flex flex-col gap-3">
          <Tabs value={status} onChange={(v) => { setStatus(v); setCursor(undefined); }} options={[{ value: '', label: 'Todas' }, { value: 'open', label: 'Abertas' }, { value: 'in_progress', label: 'Em andamento' }, { value: 'done', label: 'Prontas' }, { value: 'delivered', label: 'Entregues' }]} />
          <div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" /><Input value={term} onChange={(e) => { setTerm(e.target.value); setCursor(undefined); }} placeholder="Buscar por serviço ou cliente" className="pl-9" aria-label="Buscar ordens" /></div>
        </div>
        <div className="mt-4">
          {list.isLoading && <LoadingBlock />}
          {list.error && <ErrorState error={list.error} retry={() => list.refetch()} />}
          {list.data && list.data.data.length === 0 && <EmptyState icon={<Wrench className="size-5" />} title={q || status ? 'Nenhuma ordem encontrada' : 'Nenhuma ordem de serviço ainda'} description="Registre aqui consertos, preparos e atendimentos que não são venda de produto." action={!q && can('sales.create') ? <Button onClick={() => setCreating(true)}>Criar primeira ordem</Button> : undefined} />}
          {list.data && list.data.data.length > 0 && (
            <>
              <Table>
                <thead><tr><Th>Nº</Th><Th>Serviço</Th><Th>Cliente</Th><Th>Previsão</Th><Th right>Valor</Th><Th>Situação</Th></tr></thead>
                <tbody>{list.data.data.map((o) => (
                  <tr key={o.id} className="cursor-pointer hover:bg-surface-2" onClick={() => setOpenId(o.id)}>
                    <Td><button className="font-medium hover:text-primary-soft" onClick={() => setOpenId(o.id)}>#{o.number}</button></Td>
                    <Td>{o.title}</Td><Td>{o.partyName ?? <span className="text-muted">—</span>}</Td><Td>{dateBR(o.dueDate)}</Td><Td right>{brl(o.priceCents)}</Td>
                    <Td><Badge tone={TONE[o.status]}>{LABEL[o.status]}</Badge></Td>
                  </tr>
                ))}</tbody>
              </Table>
              <Pager hasMore={list.data.meta.hasMore} cursor={list.data.meta.cursor} onNext={setCursor} onFirst={() => setCursor(undefined)} isFirst={!cursor} />
            </>
          )}
        </div>
      </Card>
      {creating && <Editor open onClose={() => setCreating(false)} />}
      {openId && <DetailModal id={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}
