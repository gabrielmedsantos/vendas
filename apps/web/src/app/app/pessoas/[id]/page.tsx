'use client';

import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { Archive, Pencil } from 'lucide-react';
import { PartyModal, partyToApi, type PartyFormValue } from '@/components/ops/party-form';
import { Badge, Button, Card, ErrorState, Field, FormError, Input, LoadingBlock, Modal, MoneyInput, PageHeader, Stat, Table, Td, Th } from '@/components/ui';
import { useToast } from '@/components/toast';
import { api } from '@/lib/client/api';
import { brl, dateBR, dateTimeBR, STATUS_LABEL } from '@/lib/client/format';
import { useCan } from '@/lib/client/session';

interface Detail {
  party: { id: string; personType: 'PF' | 'PJ'; name: string; tradeName: string | null; document: string | null; email: string | null; phone: string | null; address: Record<string, string>; city: string | null; state: string | null; isCustomer: boolean; isSupplier: boolean; status: string; notes: string | null; createdAt: string };
  sales: { id: string; number: string; status: string; saleDate: string; totalCents: string; origin: string }[];
  purchases: { id: string; number: string | null; status: string; purchaseDate: string; totalCents: string; origin: string }[];
  trades: { id: string; number: string; status: string; confirmedAt: string; saleTotalCents: string; purchaseTotalCents: string; differenceCents: string }[];
  titles: { id: string; direction: string; description: string; dueDate: string; originalCents: string; balanceCents: string; status: string }[];
  storeCreditCents: string;
  creditEntries: { id: string; kind: string; amountCents: string; balanceAfterCents: string; originType: string; reason: string | null; createdAt: string }[];
}

export default function PartyPage() {
  const { id } = useParams<{ id: string }>();
  const can = useCan();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['party', id], queryFn: () => api<Detail>(`parties/${id}`) });
  const [editing, setEditing] = useState(false);
  const [credit, setCredit] = useState(false);
  const [creditForm, setCreditForm] = useState({ amount: '', sign: '1', reason: '' });
  const [error, setError] = useState<unknown>(null);
  if (q.isLoading) return <LoadingBlock rows={6} />;
  if (q.error) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  const d = q.data!;
  const p = d.party;
  const receivable = d.titles.filter((t) => t.direction === 'receivable').reduce((a, t) => a + BigInt(t.balanceCents), 0n);
  const payable = d.titles.filter((t) => t.direction === 'payable').reduce((a, t) => a + BigInt(t.balanceCents), 0n);
  const initial: PartyFormValue = {
    personType: p.personType, name: p.name, tradeName: p.tradeName ?? '', document: p.document ?? '', email: p.email ?? '', phone: p.phone ?? '', city: p.city ?? '', state: p.state ?? '',
    street: p.address?.street ?? '', number: p.address?.number ?? '', district: p.address?.district ?? '', zip: p.address?.zip ?? '', isCustomer: p.isCustomer, isSupplier: p.isSupplier, notes: p.notes ?? '',
  };
  return (
    <div>
      <PageHeader title={p.name} description={[p.phone, p.email, [p.city, p.state].filter(Boolean).join('/')].filter(Boolean).join(' · ')} actions={<>
        {p.isCustomer && <Badge tone="info">Cliente</Badge>}{p.isSupplier && <Badge tone="primary">Fornecedor</Badge>}
        {p.status === 'archived' && <Badge>Arquivado</Badge>}
        {can('parties.manage') && p.status === 'active' && <Button variant="secondary" onClick={() => setEditing(true)}><Pencil className="size-4" />Editar</Button>}
        {can('parties.manage') && p.status === 'active' && <Button variant="quiet" onClick={async () => { await api(`parties/${id}/status`, { body: { status: 'archived' } }); qc.invalidateQueries(); toast('Cadastro arquivado; histórico mantido.'); }}><Archive className="size-4" />Arquivar</Button>}
      </>} />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Deve à empresa" value={brl(receivable.toString())} tone={receivable > 0n ? 'warning' : 'default'} />
        <Stat label="Empresa deve" value={brl(payable.toString())} />
        <Stat label="Crédito da loja" value={brl(d.storeCreditCents)} tone="primary" hint={can('finance.manage') ? <button className="text-primary-soft hover:underline" onClick={() => setCredit(true)}>Ajustar crédito</button> : undefined} />
        <Stat label="Operações" value={d.sales.length + d.purchases.length} hint={`${d.trades.length} troca(s)`} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Vendas">{d.sales.length ? <Table><thead><tr><Th>Nº</Th><Th>Data</Th><Th>Situação</Th><Th right>Total</Th></tr></thead><tbody>{d.sales.map((s) => <tr key={s.id}><Td><Link className="hover:text-primary-soft" href={`/app/vendas/${s.id}`}>#{s.number}</Link>{s.origin === 'trade' && <span className="ml-1 text-xs text-primary-soft">troca</span>}</Td><Td>{dateBR(s.saleDate)}</Td><Td>{STATUS_LABEL[s.status]}</Td><Td right>{brl(s.totalCents)}</Td></tr>)}</tbody></Table> : <p className="text-sm text-muted">Sem vendas.</p>}</Card>
        <Card title="Compras">{d.purchases.length ? <Table><thead><tr><Th>Nº</Th><Th>Data</Th><Th>Situação</Th><Th right>Total</Th></tr></thead><tbody>{d.purchases.map((s) => <tr key={s.id}><Td><Link className="hover:text-primary-soft" href={`/app/compras/${s.id}`}>{s.number ? `#${s.number}` : 'Rascunho'}</Link></Td><Td>{dateBR(s.purchaseDate)}</Td><Td>{STATUS_LABEL[s.status]}</Td><Td right>{brl(s.totalCents)}</Td></tr>)}</tbody></Table> : <p className="text-sm text-muted">Sem compras.</p>}</Card>
        <Card title="Títulos em aberto">{d.titles.length ? <ul className="flex flex-col gap-2 text-sm">{d.titles.map((t) => <li key={t.id} className="flex justify-between gap-2"><span><span className="block">{t.description}</span><span className="text-xs text-muted">{t.direction === 'receivable' ? 'A receber' : 'A pagar'} · vence {dateBR(t.dueDate)}</span></span><span className="tabular">{brl(t.balanceCents)}</span></li>)}</ul> : <p className="text-sm text-muted">Nada em aberto.</p>}</Card>
        <Card title="Crédito da loja — extrato">{d.creditEntries.length ? <ul className="flex flex-col gap-1 text-sm">{d.creditEntries.map((c) => <li key={c.id} className="flex justify-between gap-2"><span className="text-muted">{dateTimeBR(c.createdAt)} · {c.kind}{c.reason ? ` · ${c.reason}` : ''}</span><span className="tabular">{brl(c.amountCents)}</span></li>)}</ul> : <p className="text-sm text-muted">Sem lançamentos.</p>}</Card>
      </div>
      {p.notes && <Card className="mt-4" title="Observações internas"><p className="whitespace-pre-wrap text-sm text-muted">{p.notes}</p></Card>}
      {editing && <PartyModal open title="Editar cadastro" initial={initial} onClose={() => setEditing(false)} onSubmit={async (v) => { await api(`parties/${id}`, { method: 'PUT', body: partyToApi(v) }); await qc.invalidateQueries(); toast('Cadastro atualizado.'); setEditing(false); }} />}
      <Modal open={credit} onClose={() => setCredit(false)} title="Ajustar crédito da loja" footer={<>
        <Button variant="secondary" onClick={() => setCredit(false)}>Cancelar</Button>
        <Button onClick={async () => {
          setError(null);
          try { await api(`parties/${id}/store-credit`, { body: { amountCents: (creditForm.sign === '-1' ? '-' : '') + creditForm.amount, reason: creditForm.reason } }); await qc.invalidateQueries(); toast('Crédito ajustado.'); setCredit(false); } catch (e) { setError(e); }
        }}>Registrar ajuste</Button>
      </>}>
        <div className="flex flex-col gap-3">
          <p className="text-xs text-muted">Ajuste manual autorizado, com trilha. Crédito é obrigação da empresa, não receita.</p>
          <div className="grid grid-cols-2 gap-2">
            <select aria-label="Sentido" className="h-10 rounded-xl border border-line bg-bg px-3 text-sm" value={creditForm.sign} onChange={(e) => setCreditForm({ ...creditForm, sign: e.target.value })}><option value="1">Conceder</option><option value="-1">Retirar</option></select>
            <MoneyInput value={creditForm.amount} onChange={(c) => setCreditForm({ ...creditForm, amount: c })} ariaLabel="Valor" />
          </div>
          <Field label="Motivo" htmlFor="cr-reason" required><Input id="cr-reason" value={creditForm.reason} onChange={(e) => setCreditForm({ ...creditForm, reason: e.target.value })} /></Field>
          <FormError error={error} />
        </div>
      </Modal>
    </div>
  );
}
