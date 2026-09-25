'use client';

import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Plus, Search, Users } from 'lucide-react';
import { useDebounced } from '@/components/ops/hooks';
import { emptyParty, PartyModal, partyToApi } from '@/components/ops/party-form';
import { Badge, Button, Card, EmptyState, ErrorState, Input, LoadingBlock, PageHeader, Pager, Table, Tabs, Td, Th } from '@/components/ui';
import { useToast } from '@/components/toast';
import { api, qs } from '@/lib/client/api';
import { brl } from '@/lib/client/format';
import { useCan } from '@/lib/client/session';

interface Row { id: string; personType: string; name: string; tradeName: string | null; email: string | null; phone: string | null; city: string | null; state: string | null; isCustomer: boolean; isSupplier: boolean; status: string; document?: string | null; receivableCents: string; storeCreditCents: string }

export default function PartiesPage() {
  const can = useCan();
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const [role, setRole] = useState('all');
  const [status, setStatus] = useState('active');
  const [term, setTerm] = useState('');
  const [cursor, setCursor] = useState<string | undefined>();
  const [creating, setCreating] = useState(false);
  const q = useDebounced(term, 250);
  const list = useQuery({ queryKey: ['parties', role, status, q, cursor], queryFn: () => api<{ data: Row[]; meta: { cursor: string | null; hasMore: boolean; total: number } }>(`parties${qs({ role, status, q, cursor })}`) });
  return (
    <div>
      <PageHeader title="Clientes e fornecedores" description="Uma ficha por pessoa: a mesma pessoa pode comprar, vender e trocar." actions={can('parties.manage') && <Button onClick={() => setCreating(true)}><Plus className="size-4" />Novo cadastro</Button>} />
      <Card>
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            <Tabs value={role} onChange={(v) => { setRole(v); setCursor(undefined); }} options={[{ value: 'all', label: 'Todos' }, { value: 'customer', label: 'Clientes' }, { value: 'supplier', label: 'Fornecedores' }]} />
            <Tabs value={status} onChange={(v) => { setStatus(v); setCursor(undefined); }} options={[{ value: 'active', label: 'Ativos' }, { value: 'archived', label: 'Arquivados' }]} />
          </div>
          <div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" /><Input value={term} onChange={(e) => { setTerm(e.target.value); setCursor(undefined); }} placeholder="Buscar por nome, e-mail, telefone ou documento" className="pl-9" aria-label="Buscar pessoas" /></div>
        </div>
        <div className="mt-4">
          {list.isLoading && <LoadingBlock />}
          {list.error && <ErrorState error={list.error} retry={() => list.refetch()} />}
          {list.data && list.data.data.length === 0 && <EmptyState icon={<Users className="size-5" />} title={q ? 'Ninguém encontrado com essa busca' : 'Nenhum cadastro ainda'} description="Cadastre clientes para vender a prazo e trocar; fornecedores para registrar compras." action={!q && can('parties.manage') ? <Button onClick={() => setCreating(true)}>Novo cadastro</Button> : undefined} />}
          {list.data && list.data.data.length > 0 && (
            <>
              <Table>
                <thead><tr><Th>Nome</Th>{list.data.data[0]?.document !== undefined && <Th>Documento</Th>}<Th>Contato</Th><Th>Cidade/UF</Th><Th>Papéis</Th><Th right>A receber</Th><Th right>Crédito da loja</Th></tr></thead>
                <tbody>{list.data.data.map((p) => (
                  <tr key={p.id} className="hover:bg-surface-2">
                    <Td><Link className="font-medium hover:text-primary-soft" href={`/app/pessoas/${p.id}`}>{p.name}</Link>{p.tradeName && <div className="text-xs text-muted">{p.tradeName}</div>}</Td>
                    {p.document !== undefined && <Td className="text-muted">{p.document ?? '—'}</Td>}
                    <Td className="text-xs">{p.phone ?? ''}{p.email ? <div className="text-muted">{p.email}</div> : null}</Td>
                    <Td className="text-muted">{[p.city, p.state].filter(Boolean).join('/') || '—'}</Td>
                    <Td><span className="flex gap-1">{p.isCustomer && <Badge tone="info">Cliente</Badge>}{p.isSupplier && <Badge tone="primary">Fornecedor</Badge>}</span></Td>
                    <Td right>{p.receivableCents !== '0' ? brl(p.receivableCents) : '—'}</Td>
                    <Td right>{p.storeCreditCents !== '0' ? brl(p.storeCreditCents) : '—'}</Td>
                  </tr>
                ))}</tbody>
              </Table>
              <Pager hasMore={list.data.meta.hasMore} cursor={list.data.meta.cursor} onNext={setCursor} onFirst={() => setCursor(undefined)} isFirst={!cursor} total={list.data.meta.total} />
            </>
          )}
        </div>
      </Card>
      {creating && <PartyModal open title="Novo cadastro" initial={{ ...emptyParty(), isSupplier: role === 'supplier', isCustomer: role !== 'supplier' }} onClose={() => setCreating(false)} onSubmit={async (v) => {
        const r = await api<{ id: string }>('parties', { body: partyToApi(v) });
        await qc.invalidateQueries({ queryKey: ['parties'] });
        toast('Cadastro criado.');
        router.push(`/app/pessoas/${r.id}`);
      }} />}
    </div>
  );
}
