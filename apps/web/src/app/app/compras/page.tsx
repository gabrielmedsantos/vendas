'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Plus, ShoppingBag } from 'lucide-react';
import { Badge, Card, EmptyState, ErrorState, LinkButton, LoadingBlock, PageHeader, Pager, Table, Tabs, Td, Th } from '@/components/ui';
import { api, qs } from '@/lib/client/api';
import { brl, dateBR, STATUS_LABEL } from '@/lib/client/format';
import { useCan } from '@/lib/client/session';

interface Row { id: string; number: string | null; status: string; origin: string; purchaseDate: string; supplierName: string; totalCents?: string; pendingQty: number }

export default function PurchasesPage() {
  const can = useCan();
  const [status, setStatus] = useState('all');
  const [cursor, setCursor] = useState<string | undefined>();
  const q = useQuery({ queryKey: ['purchases', status, cursor], queryFn: () => api<{ data: Row[]; meta: { cursor: string | null; hasMore: boolean } }>(`purchases${qs({ status, cursor })}`) });
  return (
    <div>
      <PageHeader title="Compras" description="Entradas de mercadoria com custo de aquisição, recebimento parcial e contas a pagar." actions={can('purchases.manage') && <LinkButton href="/app/compras/nova"><Plus className="size-4" />Nova compra</LinkButton>} />
      <div className="mb-3"><Tabs value={status} onChange={(v) => { setStatus(v); setCursor(undefined); }} options={[{ value: 'all', label: 'Todas' }, { value: 'draft', label: 'Rascunhos' }, { value: 'approved', label: 'A receber' }, { value: 'partially_received', label: 'Parciais' }, { value: 'received', label: 'Recebidas' }, { value: 'canceled', label: 'Canceladas' }]} /></div>
      <Card>
        {q.isLoading && <LoadingBlock />}
        {q.error && <ErrorState error={q.error} retry={() => q.refetch()} />}
        {q.data && q.data.data.length === 0 && <EmptyState icon={<ShoppingBag className="size-5" />} title="Nenhuma compra" description="Registre compras de fornecedores ou de clientes (usados). O custo real entra no estoque." action={can('purchases.manage') ? <LinkButton href="/app/compras/nova">Registrar compra</LinkButton> : undefined} />}
        {q.data && q.data.data.length > 0 && (
          <>
            <Table>
              <thead><tr><Th>Nº</Th><Th>Data</Th><Th>Fornecedor / pessoa</Th><Th>Origem</Th><Th>Situação</Th><Th right>Pendente</Th>{q.data.data[0]?.totalCents !== undefined && <Th right>Total</Th>}</tr></thead>
              <tbody>{q.data.data.map((r) => (
                <tr key={r.id} className="hover:bg-surface-2">
                  <Td><Link className="font-medium hover:text-primary-soft" href={`/app/compras/${r.id}`}>{r.number ? `#${r.number}` : 'Rascunho'}</Link></Td>
                  <Td>{dateBR(r.purchaseDate)}</Td><Td>{r.supplierName}</Td>
                  <Td>{r.origin === 'trade' ? <Badge tone="primary">Troca</Badge> : 'Compra'}</Td>
                  <Td><Badge tone={r.status === 'received' ? 'success' : r.status === 'canceled' ? 'neutral' : r.status === 'draft' ? 'neutral' : 'warning'}>{STATUS_LABEL[r.status]}</Badge></Td>
                  <Td right>{r.pendingQty}</Td>
                  {r.totalCents !== undefined && <Td right>{brl(r.totalCents)}</Td>}
                </tr>
              ))}</tbody>
            </Table>
            <Pager hasMore={q.data.meta.hasMore} cursor={q.data.meta.cursor} onNext={setCursor} onFirst={() => setCursor(undefined)} isFirst={!cursor} />
          </>
        )}
      </Card>
    </div>
  );
}
