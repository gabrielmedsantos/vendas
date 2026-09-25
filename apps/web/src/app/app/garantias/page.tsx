'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { SaleLink, WarrantyActions, WarrantyBadge, type WarrantyRow, type WarrantyStatus } from '@/components/aftersales/warranty';
import { Card, EmptyState, ErrorState, LoadingBlock, PageHeader, Pager, Table, Tabs, Td, Th } from '@/components/ui';
import { api, qs } from '@/lib/client/api';
import { dateBR } from '@/lib/client/format';

export default function WarrantyPage() {
  const [status, setStatus] = useState<'' | WarrantyStatus>('');
  const [cursor, setCursor] = useState<string | undefined>();
  const list = useQuery({ queryKey: ['warranty-cases', status, cursor], queryFn: () => api<{ data: WarrantyRow[]; meta: { cursor: string | null; hasMore: boolean } }>(`warranty-cases${qs({ status: status || undefined, cursor })}`) });
  return (
    <div>
      <PageHeader title="Garantias" description="Atendimentos de garantia comercial abertos a partir das vendas. Para abrir, acesse a venda e use “Abrir garantia”." />
      <Card>
        <Tabs value={status} onChange={(v) => { setStatus(v); setCursor(undefined); }} options={[{ value: '', label: 'Todas' }, { value: 'open', label: 'Abertas' }, { value: 'in_progress', label: 'Em análise' }, { value: 'resolved', label: 'Resolvidas' }, { value: 'rejected', label: 'Recusadas' }]} />
        <div className="mt-4">
          {list.isLoading && <LoadingBlock />}
          {list.error && <ErrorState error={list.error} retry={() => list.refetch()} />}
          {list.data && list.data.data.length === 0 && <EmptyState icon={<ShieldCheck className="size-5" />} title="Nenhum atendimento de garantia" description="Os casos abertos nas vendas aparecem aqui, com prazo e termos da época da venda." />}
          {list.data && list.data.data.length > 0 && (
            <>
              <Table>
                <thead><tr><Th>Nº</Th><Th>Aberta em</Th><Th>Cliente</Th><Th>Item</Th><Th>Venda</Th><Th>Situação</Th><Th /></tr></thead>
                <tbody>{list.data.data.map((r) => (
                  <tr key={r.id}>
                    <Td className="font-medium">#{r.number}</Td><Td>{dateBR(r.createdAt)}</Td><Td>{r.partyName ?? '—'}</Td>
                    <Td><span className="block">{r.itemDescription ?? '—'}</span><span className="block max-w-72 truncate text-xs text-muted" title={r.description}>{r.description}</span></Td>
                    <Td><SaleLink row={r} /></Td><Td><WarrantyBadge status={r.status} /></Td><Td right><WarrantyActions row={r} /></Td>
                  </tr>
                ))}</tbody>
              </Table>
              <Pager hasMore={list.data.meta.hasMore} cursor={list.data.meta.cursor} onNext={setCursor} onFirst={() => setCursor(undefined)} isFirst={!cursor} />
            </>
          )}
        </div>
      </Card>
    </div>
  );
}
