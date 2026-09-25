'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ArrowLeftRight, Plus } from 'lucide-react';
import { Badge, Card, EmptyState, ErrorState, LinkButton, LoadingBlock, PageHeader, Pager, Table, Tabs, Td, Th } from '@/components/ui';
import { api, qs } from '@/lib/client/api';
import { brl, dateBR, STATUS_LABEL } from '@/lib/client/format';
import { useCan } from '@/lib/client/session';

interface Row { id: string; number: string; status: string; confirmedAt: string; partyName: string; saleTotalCents: string; purchaseTotalCents: string; offsetCents: string; differenceCents: string; differencePolicy: string }

export default function TradesPage() {
  const can = useCan();
  const [status, setStatus] = useState('all');
  const [cursor, setCursor] = useState<string | undefined>();
  const q = useQuery({ queryKey: ['trades', status, cursor], queryFn: () => api<{ data: Row[]; meta: { cursor: string | null; hasMore: boolean } }>(`trades${qs({ status, cursor })}`) });
  return (
    <div>
      <PageHeader title="Trocas" description="Cada troca é uma venda + uma compra compensadas; apenas a diferença movimenta dinheiro." actions={can('trades.confirm') && <LinkButton href="/app/trocas/nova"><Plus className="size-4" />Nova troca</LinkButton>} />
      <div className="mb-3"><Tabs value={status} onChange={(v) => { setStatus(v); setCursor(undefined); }} options={[{ value: 'all', label: 'Todas' }, { value: 'confirmed', label: 'Confirmadas' }, { value: 'reversed', label: 'Revertidas' }]} /></div>
      <Card>
        {q.isLoading && <LoadingBlock />}
        {q.error && <ErrorState error={q.error} retry={() => q.refetch()} />}
        {q.data && q.data.data.length === 0 && <EmptyState icon={<ArrowLeftRight className="size-5" />} title="Nenhuma troca registrada" description="Receba um usado como parte do pagamento e cobre ou pague só a diferença." action={can('trades.confirm') ? <LinkButton href="/app/trocas/nova">Fazer uma troca</LinkButton> : undefined} />}
        {q.data && q.data.data.length > 0 && (
          <>
            <Table>
              <thead><tr><Th>Nº</Th><Th>Data</Th><Th>Cliente</Th><Th right>Saída (S)</Th><Th right>Entrada (P)</Th><Th right>Diferença</Th><Th>Destino</Th><Th>Situação</Th></tr></thead>
              <tbody>{q.data.data.map((t) => {
                const d = BigInt(t.differenceCents);
                return (
                  <tr key={t.id} className="hover:bg-surface-2">
                    <Td><Link className="font-medium hover:text-primary-soft" href={`/app/trocas/${t.id}`}>#{t.number}</Link></Td>
                    <Td>{dateBR(t.confirmedAt)}</Td><Td>{t.partyName}</Td><Td right>{brl(t.saleTotalCents)}</Td><Td right>{brl(t.purchaseTotalCents)}</Td>
                    <Td right>{brl((d < 0n ? -d : d).toString())}</Td>
                    <Td className="text-xs">{d > 0n ? 'Cliente pagou' : d < 0n ? (t.differencePolicy === 'store_credit' ? 'Crédito da loja' : 'Empresa paga') : 'Sem diferença'}</Td>
                    <Td><Badge tone={t.status === 'confirmed' ? 'success' : 'neutral'}>{STATUS_LABEL[t.status]}</Badge></Td>
                  </tr>
                );
              })}</tbody>
            </Table>
            <Pager hasMore={q.data.meta.hasMore} cursor={q.data.meta.cursor} onNext={setCursor} onFirst={() => setCursor(undefined)} isFirst={!cursor} />
          </>
        )}
      </Card>
    </div>
  );
}
