'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { ImageOff, Package, Plus, Search, PackagePlus } from 'lucide-react';
import { useDebounced } from '@/components/ops/hooks';
import { useCategories } from '@/components/ops/hooks';
import { Badge, Button, Card, EmptyState, ErrorState, Input, LinkButton, LoadingBlock, PageHeader, Pager, Select, Stat, Table, Td, Th, cx } from '@/components/ui';
import { api, qs } from '@/lib/client/api';
import { brl, pct, STATUS_LABEL } from '@/lib/client/format';
import { StockEntryModal } from '@/components/products/stock-entry-modal';
import { useCan } from '@/lib/client/session';

interface Row {
  id: string; name: string; brand: string | null; kind: string; tracking: string; status: string; categoryName: string | null; sku: string; variantCount: number;
  retailPriceCents: string; wholesalePriceCents: string | null; onHand: number; reserved: number; inspection: number; minStock: number; imageId: string | null; unitCostCents?: string | null; marginBps?: number | null; stockCostCents?: string | null;
}
interface Resp { data: Row[]; meta: { cursor: string | null; hasMore: boolean; total: number }; summary: { itemsInStock: number; productsInStock: number; potentialSaleCents: string; stockCostCents?: string; potentialMarginCents?: string } }

const FILTERS = [
  { v: '', l: 'Todos' },
  { v: 'out_of_stock', l: 'Sem estoque' },
  { v: 'low_stock', l: 'Estoque baixo' },
  { v: 'never_sold', l: 'Nunca vendido' },
  { v: 'with_stock', l: 'Com estoque' },
];

function Products() {
  const params = useSearchParams();
  const can = useCan();
  const [entry, setEntry] = useState<string | null>(null);
  const [term, setTerm] = useState('');
  const [filter, setFilter] = useState(params.get('filter') ?? '');
  const [status, setStatus] = useState('active');
  const [categoryId, setCategoryId] = useState('');
  const [sort, setSort] = useState('name');
  const [cursor, setCursor] = useState<string | undefined>();
  const q = useDebounced(term, 250);
  const cats = useCategories();
  const list = useQuery({
    queryKey: ['products', q, filter, status, categoryId, sort, cursor],
    queryFn: () => api<Resp>(`products${qs({ q, filter, status, categoryId, sort, cursor })}`),
  });
  const reset = () => setCursor(undefined);
  const s = list.data?.summary;
  const showCost = can('costs.view');
  return (
    <div>
      <PageHeader title="Produtos" description="Cadastro, preços e posição de estoque." actions={can('products.manage') && <LinkButton href="/app/produtos/novo"><Plus className="size-4" />Novo produto</LinkButton>} />
      {s && (
        <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {showCost && <Stat label="Estoque a custo" value={brl(s.stockCostCents)} hint={`${s.productsInStock} produto(s) · ${s.itemsInStock} item(ns)`} info="Soma do custo remanescente dos lotes (FIFO) e unidades em estoque." />}
          <Stat label="Potencial de venda (estimativa)" value={brl(s.potentialSaleCents)} hint="preço de varejo × disponível" info="Estimativa pelo preço de varejo atual. Não é lucro realizado." />
          {showCost && <Stat label="Margem potencial (estimativa)" value={brl(s.potentialMarginCents)} hint="venda estimada − custo" />}
          {!showCost && <Stat label="Itens em estoque" value={s.itemsInStock} hint={`${s.productsInStock} produto(s)`} />}
        </div>
      )}
      <Card>
        <div className="flex flex-col gap-3">
          <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto_auto]">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
              <Input value={term} onChange={(e) => { setTerm(e.target.value); reset(); }} placeholder="Buscar por nome, SKU ou código de barras" className="pl-9" aria-label="Buscar produtos" />
            </div>
            <Select aria-label="Categoria" value={categoryId} onChange={(e) => { setCategoryId(e.target.value); reset(); }}>
              <option value="">Todas as categorias</option>
              {cats.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
            <Select aria-label="Situação" value={status} onChange={(e) => { setStatus(e.target.value); reset(); }}>
              <option value="active">Ativos</option>
              <option value="inactive">Inativos</option>
              <option value="archived">Arquivados</option>
              <option value="all">Todos</option>
            </Select>
            <Select aria-label="Ordenar" value={sort} onChange={(e) => { setSort(e.target.value); reset(); }}>
              <option value="name">Nome A–Z</option>
              <option value="-created">Mais recentes</option>
              <option value="-price">Maior preço</option>
              <option value="price">Menor preço</option>
              <option value="stock">Menor estoque</option>
              <option value="-stock">Maior estoque</option>
            </Select>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted">Atalhos:</span>
            {FILTERS.map((f) => (
              <button key={f.v} onClick={() => { setFilter(f.v); reset(); }} aria-pressed={filter === f.v} className={cx('rounded-full border px-3 py-1 text-xs', filter === f.v ? 'border-primary bg-primary/15 text-fg' : 'border-line text-muted hover:text-fg')}>{f.l}</button>
            ))}
          </div>
        </div>
        <div className="mt-4">
          {list.isLoading && <LoadingBlock />}
          {list.error && <ErrorState error={list.error} retry={() => list.refetch()} />}
          {list.data && list.data.data.length === 0 && (
            <EmptyState icon={<Package className="size-5" />} title={q || filter ? 'Nenhum produto encontrado com esses filtros' : 'Nenhum produto cadastrado'} description={q || filter ? 'Ajuste a busca ou os atalhos.' : 'Cadastre produtos para vender, comprar e trocar.'} action={!q && !filter && can('products.manage') ? <LinkButton href="/app/produtos/novo">Cadastrar produto</LinkButton> : undefined} />
          )}
          {list.data && list.data.data.length > 0 && (
            <>
              <Table>
                <thead><tr><Th>Produto</Th><Th>Categoria</Th>{showCost && <Th right>Custo médio</Th>}<Th right>Varejo / atacado</Th>{showCost && <Th right>Margem</Th>}<Th right>Estoque</Th><Th>Situação</Th><Th /></tr></thead>
                <tbody>
                  {list.data.data.map((r) => (
                    <tr key={r.id} className="hover:bg-surface-2">
                      <Td>
                        <div className="flex items-center gap-3">
                          <Link href={`/app/produtos/${r.id}`} tabIndex={-1} aria-hidden className="size-11 shrink-0 overflow-hidden rounded-lg border border-line bg-bg">
                            {r.imageId
                              ? <img src={`/api/v1/attachments/${r.imageId}`} alt="" className="size-full object-cover" loading="lazy" />
                              : <span className="flex size-full items-center justify-center text-muted"><ImageOff className="size-4" /></span>}
                          </Link>
                          <div className="min-w-0">
                            <Link href={`/app/produtos/${r.id}`} className="font-medium hover:text-primary-soft">{r.name}</Link>
                            <div className="text-xs text-muted">{r.sku}{r.variantCount > 1 ? ` · ${r.variantCount} variações` : ''}{r.tracking === 'serialized' ? ' · por unidade' : ''}{r.kind === 'service' ? ' · serviço' : ''}</div>
                          </div>
                        </div>
                      </Td>
                      <Td className="text-muted">{r.categoryName ?? '—'}</Td>
                      {showCost && <Td right>{brl(r.unitCostCents)}</Td>}
                      <Td right>{brl(r.retailPriceCents)}{r.wholesalePriceCents && <div className="text-xs text-muted">{brl(r.wholesalePriceCents)}</div>}</Td>
                      {showCost && <Td right>{pct(r.marginBps)}</Td>}
                      <Td right>
                        {r.kind === 'service' ? '—' : <span className={r.onHand === 0 ? 'text-danger-soft' : r.minStock > 0 && r.onHand <= r.minStock ? 'text-warning' : ''}>{r.onHand - r.reserved}</span>}
                        {r.reserved > 0 && <div className="text-xs text-muted">{r.reserved} reservado(s)</div>}
                        {r.inspection > 0 && <div className="text-xs text-info">{r.inspection} em inspeção</div>}
                      </Td>
                      <Td><Badge tone={r.status === 'active' ? 'success' : 'neutral'}>{STATUS_LABEL[r.status]}</Badge></Td>
                      <Td right>{r.kind === 'physical' && r.status !== 'archived' && (can('purchases.manage') || can('inventory.adjust')) && (
                        <Button size="sm" variant="secondary" onClick={() => setEntry(r.id)} aria-label={`Entrada de estoque: ${r.name}`}><PackagePlus className="size-3.5" />Entrada</Button>
                      )}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
              <Pager hasMore={list.data.meta.hasMore} cursor={list.data.meta.cursor} onNext={setCursor} onFirst={reset} isFirst={!cursor} total={list.data.meta.total} />
            </>
          )}
        </div>
      </Card>
      {entry && <StockEntryModal productId={entry} onClose={() => setEntry(null)} />}
    </div>
  );
}

export default function Page() {
  return <Suspense><Products /></Suspense>;
}
