'use client';

import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { Archive, History, Megaphone, ShoppingBag, ShoppingCart, SlidersHorizontal } from 'lucide-react';
import { AdjustModal } from '@/components/products/adjust-modal';
import { ListingModal } from '@/components/products/listing-modal';
import { ProductPhotos } from '@/components/products/photos';
import { ProductForm, toApi, type ProductFormValue } from '@/components/products/product-form';
import { Badge, Button, Card, ErrorState, LinkButton, LoadingBlock, PageHeader, Table, Tabs, Td, Th } from '@/components/ui';
import { useToast } from '@/components/toast';
import { api } from '@/lib/client/api';
import { brl, dateBR, dateTimeBR, KIND_LABEL, STATUS_LABEL, CONDITION_LABEL } from '@/lib/client/format';
import { useCan } from '@/lib/client/session';

interface Product {
  id: string; kind: 'physical' | 'service'; tracking: 'quantity' | 'serialized' | 'none'; name: string; description: string | null; brand: string | null; categoryId: string | null; categoryName: string | null;
  status: 'active' | 'inactive' | 'archived'; conditionDefault: string | null; warrantyDays: number; identifierKinds: string[]; version: number;
  variants: { id: string; sku: string; barcode: string | null; label: string; retailPriceCents: string; wholesalePriceCents: string | null; wholesaleMinQty: number | null; suggestedPriceCents: string | null; minStock: number; onHand: number; reserved: number; inspection: number }[];
  units: { id: string; internalCode: string; status: string; condition: string | null; batteryHealthPct: number | null; identifiers: { kind: string; value: string }[]; costCents?: string | null; createdAt: string }[];
  images: { attachmentId: string }[];
  lots?: { id: string; sourceType: string; status: string; receivedAt: string; qtyReceived: number; qtyRemaining: number; costRemainingCents: string }[];
  canSeeCost: boolean;
}

export default function ProductPage() {
  const { id } = useParams<{ id: string }>();
  const [tab, setTab] = useState<'overview' | 'history' | 'edit'>('overview');
  const [adjust, setAdjust] = useState(false);
  const [listing, setListing] = useState(false);
  const can = useCan();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['product', id], queryFn: () => api<Product>(`products/${id}`) });
  const history = useQuery({ queryKey: ['product-history', id], queryFn: () => api<{ id: string; createdAt: string; direction: string; kind: string; bucket: string; quantity: number; physicalAfter: number; reason: string | null; sku: string; internalCode: string | null; costCents?: string }[]>(`products/${id}/history`), enabled: tab === 'history' });
  if (q.isLoading) return <LoadingBlock rows={6} />;
  if (q.error) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  const p = q.data!;
  const initial: ProductFormValue = {
    kind: p.kind, tracking: p.tracking, name: p.name, description: p.description ?? '', brand: p.brand ?? '', categoryId: p.categoryId ?? '', status: p.status === 'archived' ? 'inactive' : p.status,
    conditionDefault: p.conditionDefault ?? '', warrantyDays: String(p.warrantyDays), identifierKinds: p.identifierKinds, version: p.version,
    variants: p.variants.map((v) => ({ id: v.id, sku: v.sku, barcode: v.barcode ?? '', label: v.label, retailPriceCents: v.retailPriceCents, wholesalePriceCents: v.wholesalePriceCents ?? '', wholesaleMinQty: v.wholesaleMinQty ? String(v.wholesaleMinQty) : '', suggestedPriceCents: v.suggestedPriceCents ?? '', minStock: String(v.minStock) })),
  };
  return (
    <div>
      <PageHeader
        title={p.name}
        description={[p.brand, p.categoryName, p.kind === 'service' ? 'Serviço' : p.tracking === 'serialized' ? 'Controle por unidade' : 'Controle por quantidade'].filter(Boolean).join(' · ')}
        actions={<>
          <Badge tone={p.status === 'active' ? 'success' : 'neutral'}>{STATUS_LABEL[p.status]}</Badge>
          {can('sales.create') && p.status === 'active' && <LinkButton href={`/app/vendas/nova?variante=${p.variants[0]?.id}`}><ShoppingCart className="size-4" />Vender</LinkButton>}
          {p.status === 'active' && <Button variant="secondary" onClick={() => setListing(true)}><Megaphone className="size-4" />Anunciar</Button>}
          {can('purchases.manage') && p.kind === 'physical' && <LinkButton variant="secondary" href={`/app/compras/nova?variante=${p.variants[0]?.id}`}><ShoppingBag className="size-4" />Entrada por compra</LinkButton>}
          {can('inventory.adjust') && p.kind === 'physical' && <Button variant="secondary" onClick={() => setAdjust(true)}><SlidersHorizontal className="size-4" />Ajustar</Button>}
          {can('products.manage') && p.status !== 'archived' && (
            <Button variant="quiet" onClick={async () => {
              try { await api(`products/${id}/status`, { body: { status: 'archived' } }); qc.invalidateQueries(); toast('Produto arquivado.'); } catch (e) { alert((e as Error).message); }
            }}><Archive className="size-4" />Arquivar</Button>
          )}
        </>}
      />
      <div className="mb-4"><Tabs value={tab} onChange={setTab} options={[{ value: 'overview', label: 'Visão geral' }, { value: 'history', label: 'Histórico de estoque' }, ...(can('products.manage') ? [{ value: 'edit' as const, label: 'Editar cadastro' }] : [])]} /></div>
      {tab === 'overview' && (
        <div className="flex flex-col gap-4">
          <Card title="Variações e saldo">
            <Table>
              <thead><tr><Th>SKU</Th><Th>Variação</Th><Th right>Varejo</Th><Th right>Atacado</Th><Th right>Disponível</Th><Th right>Reservado</Th><Th right>Inspeção</Th><Th right>Mínimo</Th></tr></thead>
              <tbody>{p.variants.map((v) => (
                <tr key={v.id}><Td>{v.sku}</Td><Td>{v.label || '—'}</Td><Td right>{brl(v.retailPriceCents)}</Td><Td right>{v.wholesalePriceCents ? `${brl(v.wholesalePriceCents)} (≥${v.wholesaleMinQty ?? 1})` : '—'}</Td><Td right>{v.onHand - v.reserved}</Td><Td right>{v.reserved}</Td><Td right>{v.inspection}</Td><Td right>{v.minStock}</Td></tr>
              ))}</tbody>
            </Table>
          </Card>
          {p.tracking === 'serialized' && (
            <Card title="Unidades em estoque" description="Cada unidade tem identidade e custo próprios.">
              {p.units.length === 0 ? <p className="text-sm text-muted">Nenhuma unidade em estoque.</p> : (
                <Table>
                  <thead><tr><Th>Código</Th><Th>Identificadores</Th><Th>Condição</Th><Th>Situação</Th>{p.canSeeCost && <Th right>Custo</Th>}<Th>Entrada</Th></tr></thead>
                  <tbody>{p.units.map((u) => (
                    <tr key={u.id}><Td>{u.internalCode}</Td><Td className="text-xs">{u.identifiers.map((i) => `${i.kind.toUpperCase()}: ${i.value}`).join(' · ') || '—'}</Td><Td>{(u.condition ? CONDITION_LABEL[u.condition] ?? u.condition : '—')}{u.batteryHealthPct !== null && ` · bateria ${u.batteryHealthPct}%`}</Td><Td><Badge tone={u.status === 'available' ? 'success' : u.status === 'inspection' ? 'info' : 'neutral'}>{STATUS_LABEL[u.status]}</Badge></Td>{p.canSeeCost && <Td right>{brl(u.costCents)}</Td>}<Td>{dateBR(u.createdAt)}</Td></tr>
                  ))}</tbody>
                </Table>
              )}
            </Card>
          )}
          {p.lots && p.lots.length > 0 && p.tracking === 'quantity' && (
            <Card title="Lotes (FIFO)" description="Saídas consomem primeiro os lotes mais antigos, ao custo de cada lote.">
              <Table>
                <thead><tr><Th>Entrada</Th><Th>Origem</Th><Th>Situação</Th><Th right>Recebido</Th><Th right>Restante</Th><Th right>Custo restante</Th></tr></thead>
                <tbody>{p.lots.map((l) => (
                  <tr key={l.id}><Td>{dateBR(l.receivedAt)}</Td><Td>{KIND_LABEL[l.sourceType] ?? l.sourceType}</Td><Td>{STATUS_LABEL[l.status]}</Td><Td right>{l.qtyReceived}</Td><Td right>{l.qtyRemaining}</Td><Td right>{brl(l.costRemainingCents)}</Td></tr>
                ))}</tbody>
              </Table>
            </Card>
          )}
          <ProductPhotos productId={p.id} images={p.images} canManage={can('products.manage')} />
          {p.description && <Card title="Descrição"><p className="whitespace-pre-wrap text-sm text-muted">{p.description}</p></Card>}
        </div>
      )}
      {tab === 'history' && (
        <Card title="Movimentos de estoque" action={<History className="size-4 text-muted" />}>
          {history.isLoading ? <LoadingBlock /> : history.data?.length ? (
            <Table>
              <thead><tr><Th>Data</Th><Th>Tipo</Th><Th>SKU / unidade</Th><Th right>Qtd</Th>{p.canSeeCost && <Th right>Custo</Th>}<Th right>Saldo físico</Th><Th>Motivo</Th></tr></thead>
              <tbody>{history.data.map((m) => (
                <tr key={m.id}><Td>{dateTimeBR(m.createdAt)}</Td><Td>{KIND_LABEL[m.kind] ?? m.kind}{m.bucket === 'inspection' && <span className="text-xs text-info"> (inspeção)</span>}</Td><Td>{m.sku}{m.internalCode ? ` · ${m.internalCode}` : ''}</Td><Td right className={m.direction === 'in' ? 'text-success' : 'text-danger-soft'}>{m.direction === 'in' ? '+' : '−'}{m.quantity}</Td>{p.canSeeCost && <Td right>{brl(m.costCents)}</Td>}<Td right>{m.physicalAfter}</Td><Td className="text-xs text-muted">{m.reason ?? ''}</Td></tr>
              ))}</tbody>
            </Table>
          ) : <p className="text-sm text-muted">Sem movimentações.</p>}
        </Card>
      )}
      {tab === 'edit' && (
        <ProductForm initial={initial} locked={false} submitLabel="Salvar alterações" onSubmit={async (v) => {
          await api(`products/${id}`, { method: 'PUT', body: toApi(v) });
          await qc.invalidateQueries();
          toast('Produto atualizado. Vendas anteriores mantêm os valores da época.');
          setTab('overview');
        }} />
      )}
      {adjust && <AdjustModal open={adjust} onClose={() => setAdjust(false)} variants={p.variants} tracking={p.tracking} />}
      {listing && <ListingModal open={listing} onClose={() => setListing(false)} product={p} />}
      <p className="mt-6 text-xs text-muted"><Link href="/app/produtos" className="hover:text-fg">← Voltar para produtos</Link></p>
    </div>
  );
}
