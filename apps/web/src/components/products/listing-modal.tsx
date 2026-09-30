'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, Copy, Download, Shuffle } from 'lucide-react';
import { buildListing, listingDefaults, type ListingDefaults } from '@gct/shared';
import { Button, ErrorState, Field, FormError, Input, LoadingBlock, Modal, MoneyInput, Select, Textarea } from '@/components/ui';
import { useToast } from '@/components/toast';
import { api } from '@/lib/client/api';
import { useCan } from '@/lib/client/session';

export interface ListingProduct {
  name: string; brand: string | null; description: string | null; conditionDefault: string | null; warrantyDays: number;
  variants: { id: string; label: string; retailPriceCents: string }[];
  images: { attachmentId: string }[];
}
interface Tenant { address: Record<string, string>; settings: { listing?: ListingDefaults | null } }

/** Gera título, descrição curta e completa para Marketplace/OLX/WhatsApp. Publicar continua manual, na conta do usuário. */
export function ListingModal({ product, open, onClose }: { product: ListingProduct; open: boolean; onClose: () => void }) {
  const can = useCan();
  const qc = useQueryClient();
  const toast = useToast();
  const t = useQuery({ queryKey: ['tenant'], queryFn: () => api<Tenant>('tenant'), enabled: open });
  const [o, setO] = useState<ListingDefaults & { variantId: string; priceCents: string; conditionNotes: string } | null>(null);
  const [saving, setSaving] = useState(false);
  // Versão do texto: 0 = clássica; cada clique em "Gerar outra versão" muda título, frases, emojis e ordem.
  const [version, setVersion] = useState(0);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (!open || !t.data || o) return;
    const d = listingDefaults(t.data.settings.listing, t.data.address.city);
    const v = product.variants[0];
    setO({
      ...d,
      condition: product.conditionDefault === 'new' ? 'new' : product.conditionDefault === 'used' || product.conditionDefault === 'refurbished' ? 'semi_new' : d.condition,
      warrantyMonths: product.warrantyDays > 0 ? Math.max(1, Math.round(product.warrantyDays / 30)) : d.warrantyMonths,
      variantId: v?.id ?? '', priceCents: v?.retailPriceCents ?? '0', conditionNotes: '',
    });
  }, [open, t.data, o, product]);

  const variant = product.variants.find((v) => v.id === o?.variantId);
  const out = useMemo(() => (o ? buildListing({ ...o, name: product.name, brand: product.brand, description: product.description, variantLabel: variant?.label, version }) : null), [o, product, variant, version]);

  const copy = async (text: string, what: string) => {
    try { await navigator.clipboard.writeText(text); toast(`${what} copiado.`); } catch { toast('Não foi possível copiar; selecione o texto e copie.'); }
  };
  const set = <K extends keyof NonNullable<typeof o>>(k: K, v: NonNullable<typeof o>[K]) => setO((cur) => (cur ? { ...cur, [k]: v } : cur));

  return (
    <Modal open={open} onClose={onClose} title="Gerar anúncio" wide footer={<Button variant="secondary" onClick={onClose}>Fechar</Button>}>
      {t.isLoading && <LoadingBlock />}
      {t.error && <ErrorState error={t.error} retry={() => t.refetch()} />}
      {o && out && (
        <div className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            {product.variants.length > 1 && (
              <Field label="Variação" htmlFor="an-var">
                <Select id="an-var" value={o.variantId} onChange={(e) => { const v = product.variants.find((x) => x.id === e.target.value); setO({ ...o, variantId: e.target.value, priceCents: v?.retailPriceCents ?? o.priceCents }); }}>
                  {product.variants.map((v) => <option key={v.id} value={v.id}>{v.label || 'Padrão'}</option>)}
                </Select>
              </Field>
            )}
            <Field label="Preço no anúncio" htmlFor="an-price"><MoneyInput id="an-price" value={o.priceCents} onChange={(c) => set('priceCents', c || '0')} /></Field>
            <Field label="O produto é novo ou seminovo?" htmlFor="an-cond">
              <Select id="an-cond" value={o.condition} onChange={(e) => set('condition', e.target.value as ListingDefaults['condition'])}>
                <option value="new">Novo</option><option value="semi_new">Seminovo</option>
              </Select>
            </Field>
            {o.condition === 'semi_new' && (
              <Field label="Estado do seminovo" htmlFor="an-notes" help="Ex.: bateria 89%, sem marcas, com caixa e cabo.">
                <Input id="an-notes" maxLength={160} value={o.conditionNotes} onChange={(e) => set('conditionNotes', e.target.value)} />
              </Field>
            )}
            <Field label="Garantia da loja" htmlFor="an-war">
              <Select id="an-war" value={String(o.warrantyMonths)} onChange={(e) => set('warrantyMonths', Number(e.target.value))}>
                <option value="0">Não mencionar garantia</option>
                {[1, 2, 3, 6, 12].map((m) => <option key={m} value={m}>{m} {m === 1 ? 'mês' : 'meses'}</option>)}
              </Select>
            </Field>
            <Field label="Cartão" htmlFor="an-card">
              <Select id="an-card" value={String(o.cardInstallments)} onChange={(e) => set('cardInstallments', Number(e.target.value))}>
                <option value="0">Não aceita cartão</option><option value="1">Cartão à vista</option>
                {[2, 3, 6, 10, 12, 18].map((n) => <option key={n} value={n}>Em até {n}x</option>)}
              </Select>
            </Field>
            <Field label="Entrega" htmlFor="an-del" help="Deixe vazio para não mencionar."><Input id="an-del" maxLength={160} value={o.delivery} onChange={(e) => set('delivery', e.target.value)} /></Field>
            <div className="sm:col-span-2"><Field label="Frase de confiança" htmlFor="an-hl" help="Deixe vazio para não mostrar."><Input id="an-hl" maxLength={160} value={o.highlight} onChange={(e) => set('highlight', e.target.value)} /></Field></div>
            <div className="sm:col-span-2"><Field label="Observação no fim (opcional)" htmlFor="an-extra"><Input id="an-extra" maxLength={500} value={o.extra} onChange={(e) => set('extra', e.target.value)} /></Field></div>
          </div>
          {can('settings.manage') && (
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
              <Button variant="quiet" loading={saving} onClick={async () => {
                setSaving(true); setError(null);
                try {
                  await api('tenant', { method: 'PUT', body: { settings: { listing: { condition: o.condition, warrantyMonths: o.warrantyMonths, delivery: o.delivery, cardInstallments: o.cardInstallments, extra: o.extra, highlight: o.highlight } } } });
                  await qc.invalidateQueries({ queryKey: ['tenant'] });
                  toast('Padrão de anúncio salvo para a empresa.');
                } catch (e) { setError(e); } finally { setSaving(false); }
              }}>Salvar estas opções como padrão</Button>
              <span>Condição, garantia, cartão, entrega, frase de confiança e observação.</span>
            </div>
          )}
          <FormError error={error} />

          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface-2/50 p-3">
            <div className="mr-auto">
              <p className="text-sm font-semibold">Versão {version + 1}{version === 0 ? ' · clássica' : ''}</p>
              <p className="text-xs text-muted">Varie o texto entre anúncios: o Marketplace não gosta de textos repetidos.</p>
            </div>
            <Button variant="secondary" disabled={version === 0} onClick={() => setVersion((v) => Math.max(0, v - 1))} aria-label="Versão anterior"><ChevronLeft className="size-4" />Anterior</Button>
            <Button onClick={() => setVersion((v) => v + 1)}><Shuffle className="size-4" />Gerar outra versão</Button>
          </div>
          <Field label="Título" htmlFor="an-title">
            <div className="flex gap-2"><Input id="an-title" readOnly value={out.title} /><Button variant="secondary" aria-label="Copiar título" onClick={() => copy(out.title, 'Título')}><Copy className="size-4" /></Button></div>
          </Field>
          <div className="grid gap-3 lg:grid-cols-2">
            <div>
              <div className="mb-1 flex items-center justify-between"><label htmlFor="an-short" className="text-sm font-medium">Descrição curta</label><Button variant="secondary" onClick={() => copy(out.short, 'Descrição curta')}><Copy className="size-4" />Copiar</Button></div>
              <Textarea id="an-short" readOnly rows={12} value={out.short} />
            </div>
            <div>
              <div className="mb-1 flex items-center justify-between"><label htmlFor="an-full" className="text-sm font-medium">Descrição completa</label><Button variant="secondary" onClick={() => copy(out.full, 'Descrição completa')}><Copy className="size-4" />Copiar</Button></div>
              <Textarea id="an-full" readOnly rows={12} value={out.full} />
            </div>
          </div>
          <div>
            <p className="mb-2 text-sm font-medium">Fotos</p>
            {product.images.length === 0 ? <p className="text-sm text-muted">Sem fotos. Adicione fotos no produto para usar no anúncio.</p> : (
              <div className="flex flex-wrap gap-2">
                {product.images.map((im, n) => (
                  <a key={im.attachmentId} href={`/api/v1/attachments/${im.attachmentId}`} download={`foto-${n + 1}`} className="group relative size-20 overflow-hidden rounded-lg border border-line" aria-label={`Baixar foto ${n + 1}`}>
                    <img src={`/api/v1/attachments/${im.attachmentId}`} alt="" className="size-full object-cover" loading="lazy" />
                    <span className="absolute inset-0 hidden items-center justify-center bg-black/50 group-hover:flex"><Download className="size-4 text-white" /></span>
                  </a>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
