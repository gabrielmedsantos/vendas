'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { ExternalLink, Monitor, Smartphone, Trash2 } from 'lucide-react';
import { ProductPicker } from '@/components/ops/product-picker';
import { FlyerStudio } from '@/components/flyer/flyer-studio';
import { CatalogView } from '@/components/storefront/catalog-view';
import { Badge, Button, Card, cx, ErrorState, Field, FormError, Input, LoadingBlock, NoPermission, PageHeader, Tabs, Textarea } from '@/components/ui';
import { useToast } from '@/components/toast';
import { api, ApiError } from '@/lib/client/api';
import { brl, dateTimeBR, STATUS_LABEL } from '@/lib/client/format';
import { useCan, useMe } from '@/lib/client/session';

interface Admin { catalog: null | { id: string; slug: string; title: string; description: string | null; theme: { accentColor?: string }; contactWhatsapp: string | null; showPrices: boolean; published: boolean; acceptOrders: boolean }; items: { variantId: string; name: string; sku: string; label: string; retailPriceCents: string; status: string; imageId?: string | null }[] }
interface Order { id: string; number: string; contactName: string; contactPhone: string; notes: string | null; status: string; totalCents: string; reservationExpiresAt: string | null; createdAt: string; items: { description: string; quantity: number; unitPriceCents: string }[] }

export default function CatalogAdmin() {
  const can = useCan();
  const me = useMe();
  const qc = useQueryClient();
  const toast = useToast();
  const [tab, setTab] = useState<'setup' | 'flyer' | 'orders' | 'analytics'>('setup');
  const q = useQuery({ queryKey: ['catalog'], queryFn: () => api<Admin>('catalog'), enabled: can('catalog.manage') });
  const orders = useQuery({ queryKey: ['catalog-orders'], queryFn: () => api<Order[]>('catalog/orders'), enabled: tab === 'orders' });
  const analytics = useQuery({ queryKey: ['catalog-analytics'], queryFn: () => api<{ byKind: { kind: string; n: number }[]; topProducts: { name: string; views: number }[]; note: string }>('catalog/analytics'), enabled: tab === 'analytics', retry: false });
  const [f, setF] = useState({ slug: '', title: '', description: '', accentColor: '#8a62ff', contactWhatsapp: '', showPrices: true, acceptOrders: false });
  const [items, setItems] = useState<Admin['items']>([]);
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop');
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    if (q.data) {
      const c = q.data.catalog;
      setF({ slug: c?.slug ?? (me.data?.current?.slug ?? ''), title: c?.title ?? me.data?.current?.name ?? '', description: c?.description ?? '', accentColor: c?.theme?.accentColor ?? '#8a62ff', contactWhatsapp: c?.contactWhatsapp ?? '', showPrices: c?.showPrices ?? true, acceptOrders: c?.acceptOrders ?? false });
      setItems(q.data.items);
    }
  }, [q.data, me.data]);
  if (!can('catalog.manage')) return <NoPermission />;
  if (q.isLoading) return <LoadingBlock />;
  if (q.error) return <ErrorState error={q.error} />;
  const c = q.data!.catalog;
  const save = async () => {
    setError(null);
    try {
      await api('catalog', { method: 'PUT', body: f });
      await api('catalog/items', { method: 'PUT', body: { variantIds: items.map((i) => i.variantId) } });
      await qc.invalidateQueries({ queryKey: ['catalog'] }); toast('Catálogo salvo.');
    } catch (e) { setError(e); }
  };
  return (
    <div>
      <PageHeader title="Catálogo online" description="Vitrine pública com produtos escolhidos. Nunca mostra custo, identificadores de unidade, clientes ou fornecedores." actions={<>
        {c && <Badge tone={c.published ? 'success' : 'neutral'}>{c.published ? 'Publicado' : 'Não publicado'}</Badge>}
        {c?.published && <a className="flex items-center gap-1 text-sm text-primary-soft" href={`/c/${c.slug}`} target="_blank" rel="noopener"><ExternalLink className="size-4" />Abrir</a>}
        {c && <Button variant={c.published ? 'danger' : 'primary'} onClick={async () => { try { await api('catalog/publish', { body: { published: !c.published } }); qc.invalidateQueries({ queryKey: ['catalog'] }); toast(c.published ? 'Catálogo despublicado.' : 'Catálogo publicado.'); } catch (e) { setError(e); } }}>{c.published ? 'Despublicar' : 'Publicar'}</Button>}
      </>} />
      <div className="mb-4"><Tabs value={tab} onChange={setTab} options={[{ value: 'setup', label: 'Configuração' }, { value: 'flyer', label: 'Encarte digital' }, { value: 'orders', label: 'Pedidos recebidos' }, { value: 'analytics', label: 'Analytics' }]} /></div>
      {tab === 'flyer' && <FlyerStudio />}
      {tab === 'setup' && (
        <div className="grid gap-4 xl:grid-cols-2">
          <div className="flex flex-col gap-4">
            <Card title="Identidade">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Endereço" htmlFor="ct-s" help={`/c/${f.slug || '...'}`}><Input id="ct-s" value={f.slug} onChange={(e) => setF({ ...f, slug: e.target.value.toLowerCase() })} /></Field>
                <Field label="Título" htmlFor="ct-t"><Input id="ct-t" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
                <Field label="Cor de destaque" htmlFor="ct-c"><Input id="ct-c" type="color" value={f.accentColor} onChange={(e) => setF({ ...f, accentColor: e.target.value })} className="h-10 p-1" /></Field>
                <Field label="WhatsApp (com DDD)" htmlFor="ct-w"><Input id="ct-w" inputMode="tel" value={f.contactWhatsapp} onChange={(e) => setF({ ...f, contactWhatsapp: e.target.value.replace(/[^\d+]/g, '') })} placeholder="5511999999999" /></Field>
                <div className="sm:col-span-2"><Field label="Descrição" htmlFor="ct-d"><Textarea id="ct-d" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field></div>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-[var(--color-primary)]" checked={f.showPrices} onChange={(e) => setF({ ...f, showPrices: e.target.checked })} />Mostrar preços</label>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-[var(--color-primary)]" checked={f.acceptOrders} onChange={(e) => setF({ ...f, acceptOrders: e.target.checked })} />Receber pedidos pelo site</label>
              </div>
            </Card>
            <Card title="Produtos no catálogo" description={`${items.length} item(ns)`}>
              <ProductPicker onPick={(v) => setItems((s) => (s.some((x) => x.variantId === v.variantId) ? s : [...s, { variantId: v.variantId, name: v.name, sku: v.sku, label: v.label, retailPriceCents: v.retailPriceCents, status: 'active' }]))} />
              <ul className="mt-3 flex flex-col gap-2">{items.map((i) => (
                <li key={i.variantId} className="flex items-center justify-between rounded-xl border border-line bg-bg px-3 py-2 text-sm"><span>{i.name}{i.label ? ` · ${i.label}` : ''} <span className="text-xs text-muted">{i.sku}</span></span><span className="flex items-center gap-2"><span className="tabular">{brl(i.retailPriceCents)}</span><button aria-label={`Remover ${i.name}`} onClick={() => setItems(items.filter((x) => x.variantId !== i.variantId))} className="text-muted hover:text-danger-soft"><Trash2 className="size-4" /></button></span></li>
              ))}</ul>
            </Card>
            <FormError error={error} />
            <div className="flex justify-end"><Button onClick={save}>Salvar catálogo</Button></div>
          </div>
          <Card title="Prévia" action={<div className="flex gap-1"><Button size="sm" variant={device === 'desktop' ? 'primary' : 'secondary'} onClick={() => setDevice('desktop')}><Monitor className="size-3.5" />Desktop</Button><Button size="sm" variant={device === 'mobile' ? 'primary' : 'secondary'} onClick={() => setDevice('mobile')}><Smartphone className="size-3.5" />Celular</Button></div>}>
            <div className={cx('mx-auto h-[640px] overflow-y-auto rounded-2xl border border-line-strong', device === 'mobile' ? 'w-[375px] max-w-full' : 'w-full')}>
              <CatalogView preview data={{ slug: f.slug, title: f.title || 'Catálogo', description: f.description || null, storeName: me.data?.current?.name ?? '', accentColor: f.accentColor, contactWhatsapp: f.contactWhatsapp || null, showPrices: f.showPrices, acceptOrders: f.acceptOrders, items: items.map((i) => ({ variantId: i.variantId, name: i.name, description: null, brand: null, label: i.label, category: null, priceCents: f.showPrices ? i.retailPriceCents : null, available: true, imageIds: i.imageId ? [i.imageId] : [] })) }} />
            </div>
          </Card>
        </div>
      )}
      {tab === 'orders' && (
        <Card title="Pedidos recebidos" description="Pedido do site fica pendente: verifique disponibilidade, reserve por prazo limitado e converta em venda na tela de vendas. Clique no WhatsApp não é venda.">
          {orders.isLoading ? <LoadingBlock /> : orders.data?.length ? (
            <ul className="flex flex-col gap-3">{orders.data.map((o) => (
              <li key={o.id} className="rounded-xl border border-line bg-bg p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium">#{o.number} · {o.contactName} · {o.contactPhone}</span><span className="flex items-center gap-2"><Badge tone={o.status === 'pending' ? 'warning' : o.status === 'reserved' ? 'info' : 'neutral'}>{STATUS_LABEL[o.status] ?? o.status}</Badge><span className="tabular">{brl(o.totalCents)}</span></span></div>
                <ul className="mt-1 text-xs text-muted">{o.items.map((i, k) => <li key={k}>{i.quantity}× {i.description} · {brl(i.unitPriceCents)}</li>)}</ul>
                <p className="mt-1 text-xs text-muted">{dateTimeBR(o.createdAt)}{o.reservationExpiresAt ? ` · reserva até ${dateTimeBR(o.reservationExpiresAt)}` : ''}{o.notes ? ` · ${o.notes}` : ''}</p>
                {['pending', 'reserved'].includes(o.status) && (
                  <div className="mt-2 flex gap-2">
                    {o.status === 'pending' && <Button size="sm" onClick={async () => { try { await api(`catalog/orders/${o.id}/reserve`, { body: { hours: 24 } }); orders.refetch(); toast('Itens reservados por 24 h.'); } catch (e) { alert(e instanceof ApiError ? e.message : 'Falha'); } }}>Reservar 24 h</Button>}
                    <Button size="sm" variant="secondary" onClick={async () => { await api(`catalog/orders/${o.id}/close`, { body: { status: 'converted' } }); orders.refetch(); toast('Pedido marcado como convertido. Registre a venda em Vendas.'); }}>Converter</Button>
                    <Button size="sm" variant="quiet" onClick={async () => { await api(`catalog/orders/${o.id}/close`, { body: { status: 'canceled' } }); orders.refetch(); }}>Cancelar</Button>
                  </div>
                )}
              </li>
            ))}</ul>
          ) : <p className="text-sm text-muted">Nenhum pedido recebido.</p>}
        </Card>
      )}
      {tab === 'analytics' && (
        <Card title="Analytics do catálogo (30 dias)">
          {analytics.error ? <ErrorState error={analytics.error} /> : analytics.isLoading ? <LoadingBlock /> : analytics.data && (
            <div className="flex flex-col gap-4 text-sm">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{['view', 'product_view', 'contact_click', 'order_request'].map((k) => (
                <div key={k} className="rounded-xl border border-line bg-bg p-3"><p className="text-xs text-muted">{({ view: 'Visitas', product_view: 'Produtos vistos', contact_click: 'Cliques no WhatsApp', order_request: 'Pedidos enviados' } as Record<string, string>)[k]}</p><p className="text-lg font-semibold">{analytics.data!.byKind.find((b) => b.kind === k)?.n ?? 0}</p></div>
              ))}</div>
              <ul>{analytics.data.topProducts.map((t) => <li key={t.name} className="flex justify-between"><span>{t.name}</span><span className="tabular text-muted">{t.views}</span></li>)}</ul>
              <p className="text-xs text-muted">{analytics.data.note}</p>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
