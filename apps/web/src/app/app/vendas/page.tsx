'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Plus, Search, ShoppingCart } from 'lucide-react';
import { useDebounced } from '@/components/ops/hooks';
import { Badge, Card, EmptyState, ErrorState, Input, LinkButton, LoadingBlock, PageHeader, Pager, Table, Tabs, Td, Th } from '@/components/ui';
import { api, qs } from '@/lib/client/api';
import { brl, dateBR, STATUS_LABEL } from '@/lib/client/format';
import { useCan } from '@/lib/client/session';

interface Row { id: string; number: string | null; status: string; origin: string; saleDate: string; validUntil: string | null; totalCents: string; returnedRevenueCents: string; customerName: string | null; channelName: string | null; paymentMethods: string | null; itemsQty: number; costTotalCents?: string; returnedCostCents?: string; tradeId: string | null; wasCanceled?: boolean }

export default function SalesPage() {
  const can = useCan();
  const router = useRouter();
  const [status, setStatus] = useState('all_confirmed');
  const [term, setTerm] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [cursor, setCursor] = useState<string | undefined>();
  const q = useDebounced(term, 250);
  const list = useQuery({ queryKey: ['sales', status, q, from, to, cursor], queryFn: () => api<{ data: Row[]; meta: { cursor: string | null; hasMore: boolean; total: number } }>(`sales${qs({ status, q, from, to, cursor })}`) });
  const reset = () => setCursor(undefined);
  return (
    <div>
      <PageHeader title="Vendas" description="Registre, acompanhe e analise as vendas." actions={can('sales.create') && <LinkButton href="/app/vendas/nova"><Plus className="size-4" />Nova venda</LinkButton>} />
      <Card>
        <div className="flex flex-col gap-3">
          <Tabs value={status} onChange={(v) => { setStatus(v); reset(); }} options={[{ value: 'all_confirmed', label: 'Confirmadas' }, { value: 'draft', label: 'Orçamentos' }, { value: 'returned', label: 'Canceladas e devoluções' }]} />
          <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
            <div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" /><Input value={term} onChange={(e) => { setTerm(e.target.value); reset(); }} placeholder="Buscar por nº, cliente ou produto" className="pl-9" aria-label="Buscar vendas" /></div>
            <Input type="date" aria-label="De" value={from} onChange={(e) => { setFrom(e.target.value); reset(); }} />
            <Input type="date" aria-label="Até" value={to} onChange={(e) => { setTo(e.target.value); reset(); }} />
          </div>
        </div>
        <div className="mt-4">
          {list.isLoading && <LoadingBlock />}
          {list.error && <ErrorState error={list.error} retry={() => list.refetch()} />}
          {list.data && list.data.data.length === 0 && <EmptyState icon={<ShoppingCart className="size-5" />} title={q || from || to ? 'Nenhuma venda encontrada' : 'Nenhuma venda registrada ainda'} action={!q && can('sales.create') ? <LinkButton href="/app/vendas/nova">Registrar primeira venda</LinkButton> : undefined} />}
          {list.data && list.data.data.length > 0 && (
            <>
              <Table>
                <thead><tr><Th>Nº</Th><Th>Data</Th><Th>Cliente</Th><Th>Canal</Th><Th>Pagamento</Th><Th right>Itens</Th><Th right>Total</Th>{list.data.data[0]?.costTotalCents !== undefined && <Th right>Resultado bruto</Th>}<Th>Situação</Th></tr></thead>
                <tbody>{list.data.data.map((s) => (
                  <tr key={s.id} className="cursor-pointer hover:bg-surface-2" onClick={(e) => { if (!(e.target as HTMLElement).closest('a')) router.push(`/app/vendas/${s.id}`); }}>
                    <Td><Link className="font-medium hover:text-primary-soft" href={`/app/vendas/${s.id}`}>{s.number ? `#${s.number}` : 'Orçamento'}</Link></Td>
                    <Td>{dateBR(s.saleDate)}</Td><Td>{s.customerName ?? <span className="text-muted">Consumidor</span>}</Td><Td className="text-muted">{s.channelName ?? '—'}</Td>
                    <Td className="text-xs text-muted">{s.paymentMethods ?? '—'}</Td><Td right>{s.itemsQty}</Td><Td right>{brl(s.totalCents)}</Td>
                    {s.costTotalCents !== undefined && <Td right>{brl((BigInt(s.totalCents) - BigInt(s.returnedRevenueCents) - (BigInt(s.costTotalCents) - BigInt(s.returnedCostCents ?? '0'))).toString())}</Td>}
                    <Td><span className="flex gap-1">{s.origin === 'trade' && <Badge tone="primary">Troca</Badge>}{s.wasCanceled ? <Badge tone="danger">Cancelada</Badge> : <Badge tone={s.status === 'confirmed' ? 'success' : s.status === 'draft' ? 'neutral' : 'warning'}>{STATUS_LABEL[s.status]}</Badge>}</span></Td>
                  </tr>
                ))}</tbody>
              </Table>
              {status === 'all_confirmed' && can('reversals.execute') && <p className="mt-3 text-xs text-muted">Lançou uma venda por engano? Abra a venda e use <strong>Cancelar venda</strong>: o valor é estornado, os itens voltam ao estoque e ela passa para “Canceladas e devoluções”. O registro original fica guardado (não é apagado).</p>}
              <Pager hasMore={list.data.meta.hasMore} cursor={list.data.meta.cursor} onNext={setCursor} onFirst={reset} isFirst={!cursor} total={list.data.meta.total} />
            </>
          )}
        </div>
      </Card>
    </div>
  );
}
