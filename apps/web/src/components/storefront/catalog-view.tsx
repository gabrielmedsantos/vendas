'use client';

import { useState } from 'react';
import { MessageCircle, Minus, Package, Plus, ShoppingBag, X } from 'lucide-react';
import { formatBRL } from '@gct/shared';

export interface PublicCatalog {
  slug: string; title: string; description: string | null; storeName: string; accentColor: string; contactWhatsapp: string | null; showPrices: boolean; acceptOrders: boolean;
  items: { variantId: string; name: string; description: string | null; brand: string | null; label: string; category: string | null; priceCents: string | null; available: boolean; imageIds: string[] }[];
}

/** Vitrine pública: somente campos públicos. Clique no WhatsApp não é venda. */
export function CatalogView({ data, preview, onEvent, onOrder }: { data: PublicCatalog; preview?: boolean; onEvent?: (kind: string, variantId?: string) => void; onOrder?: (o: { contactName: string; contactPhone: string; notes: string; items: { variantId: string; quantity: number }[] }) => Promise<string> }) {
  const [cart, setCart] = useState<Record<string, number>>({});
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ contactName: '', contactPhone: '', notes: '' });
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const accent = /^#[0-9a-f]{6}$/i.test(data.accentColor) ? data.accentColor : '#8a62ff';
  const count = Object.values(cart).reduce((a, b) => a + b, 0);
  const total = data.items.reduce((a, i) => a + (cart[i.variantId] ? BigInt(i.priceCents ?? '0') * BigInt(cart[i.variantId]!) : 0n), 0n);
  const wa = data.contactWhatsapp ? `https://wa.me/${data.contactWhatsapp.replace(/\D/g, '')}` : null;
  return (
    <div className="min-h-full bg-bg text-fg">
      <header className="px-5 pb-6 pt-8 text-center" style={{ background: `linear-gradient(180deg, ${accent}33, transparent)` }}>
        <div className="mx-auto mb-3 grid size-14 place-items-center rounded-full text-xl font-bold text-white" style={{ background: accent }}>{data.storeName.slice(0, 1).toUpperCase()}</div>
        <h1 className="text-2xl font-semibold">{data.title}</h1>
        <p className="text-sm text-muted">{data.storeName}</p>
        {data.description && <p className="mx-auto mt-2 max-w-xl text-sm text-muted">{data.description}</p>}
        {wa && !preview && <a href={wa} target="_blank" rel="noopener noreferrer" onClick={() => onEvent?.('contact_click')} className="mt-4 inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium text-white" style={{ background: accent }}><MessageCircle className="size-4" />Falar no WhatsApp</a>}
      </header>
      <main className="mx-auto grid max-w-5xl grid-cols-2 gap-3 px-4 pb-28 sm:grid-cols-3 lg:grid-cols-4">
        {data.items.length === 0 && <p className="col-span-full py-10 text-center text-sm text-muted">Nenhum produto publicado.</p>}
        {data.items.map((i) => (
          <article key={i.variantId} className="flex flex-col overflow-hidden rounded-2xl border border-line bg-surface" onMouseEnter={() => onEvent?.('product_view', i.variantId)}>
            <div className="grid aspect-square place-items-center bg-surface-2">
              {i.imageIds[0]
                ? <img src={preview ? `/api/v1/attachments/${i.imageIds[0]}` : `/api/public/catalog/${data.slug}/images/${i.imageIds[0]}`} alt={i.name} className="size-full object-cover" loading="lazy" />
                : <Package className="size-8 text-muted" aria-hidden />}
            </div>
            <div className="flex flex-1 flex-col gap-1 p-3">
              <h2 className="text-sm font-medium leading-tight">{i.name}{i.label ? ` · ${i.label}` : ''}</h2>
              {i.brand && <p className="text-xs text-muted">{i.brand}</p>}
              <div className="mt-auto flex items-center justify-between pt-2">
                {i.priceCents ? <span className="font-semibold tabular">{formatBRL(i.priceCents)}</span> : <span className="text-xs text-muted">Consulte</span>}
                {!i.available && <span className="text-[11px] text-warning">Sob consulta</span>}
              </div>
              {data.acceptOrders && i.available && (
                <div className="mt-2 flex items-center justify-between rounded-xl border border-line">
                  <button aria-label={`Remover ${i.name}`} className="p-2 text-muted disabled:opacity-40" disabled={!cart[i.variantId]} onClick={() => setCart((c) => ({ ...c, [i.variantId]: Math.max(0, (c[i.variantId] ?? 0) - 1) }))}><Minus className="size-3.5" /></button>
                  <span className="text-sm tabular" aria-live="polite">{cart[i.variantId] ?? 0}</span>
                  <button aria-label={`Adicionar ${i.name}`} className="p-2" style={{ color: accent }} onClick={() => setCart((c) => ({ ...c, [i.variantId]: Math.min(20, (c[i.variantId] ?? 0) + 1) }))}><Plus className="size-3.5" /></button>
                </div>
              )}
            </div>
          </article>
        ))}
      </main>
      {count > 0 && !preview && (
        <button onClick={() => { setOpen(true); setMsg(null); setErr(null); }} className="fixed inset-x-4 bottom-4 mx-auto flex max-w-md items-center justify-between rounded-2xl px-5 py-3 font-medium text-white shadow-2xl" style={{ background: accent }}>
          <span className="flex items-center gap-2"><ShoppingBag className="size-4" />{count} item(ns)</span><span className="tabular">{data.showPrices ? formatBRL(total) : 'Ver pedido'}</span>
        </button>
      )}
      {open && (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/60 sm:items-center" role="dialog" aria-modal="true" aria-label="Enviar pedido">
          <div className="w-full max-w-md rounded-t-2xl border border-line bg-surface p-5 sm:rounded-2xl">
            <div className="mb-3 flex items-center justify-between"><h2 className="font-semibold">Solicitar pedido</h2><button aria-label="Fechar" onClick={() => setOpen(false)}><X className="size-4" /></button></div>
            {msg ? <p role="status" className="text-sm text-success">{msg}</p> : (
              <form className="flex flex-col gap-3" onSubmit={async (e) => {
                e.preventDefault(); setErr(null);
                try {
                  const n = await onOrder!({ ...form, items: Object.entries(cart).filter(([, q]) => q > 0).map(([variantId, quantity]) => ({ variantId, quantity })) });
                  setMsg(`Pedido nº ${n} enviado. A loja vai confirmar disponibilidade e forma de pagamento com você. Nada foi cobrado.`);
                  setCart({});
                } catch (x) { setErr((x as Error).message); }
              }}>
                <ul className="text-sm text-muted">{data.items.filter((i) => cart[i.variantId]).map((i) => <li key={i.variantId}>{cart[i.variantId]}× {i.name}</li>)}</ul>
                <label className="flex flex-col gap-1 text-xs text-muted">Seu nome<input required minLength={2} className="h-10 rounded-xl border border-line bg-bg px-3 text-sm text-fg" value={form.contactName} onChange={(e) => setForm({ ...form, contactName: e.target.value })} /></label>
                <label className="flex flex-col gap-1 text-xs text-muted">Telefone / WhatsApp<input required inputMode="tel" className="h-10 rounded-xl border border-line bg-bg px-3 text-sm text-fg" value={form.contactPhone} onChange={(e) => setForm({ ...form, contactPhone: e.target.value })} /></label>
                <label className="flex flex-col gap-1 text-xs text-muted">Observações<input className="h-10 rounded-xl border border-line bg-bg px-3 text-sm text-fg" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></label>
                <p className="text-[11px] text-muted">Usamos seu nome e telefone apenas para responder este pedido.</p>
                {err && <p role="alert" className="text-sm text-danger-soft">{err}</p>}
                <button className="h-10 rounded-xl font-medium text-white" style={{ background: accent }}>Enviar pedido</button>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
