'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Download, FileDown, ImageOff, ImagePlus, Palette, Share2, Star, Trash2, Wand2 } from 'lucide-react';
import {
  BRAND_DEFAULTS, FLYER_DEFAULTS, HEX_COLOR, formatPercentBps, listingDefaults, paginateFlyer, paletteFromColors, parsePercentBps,
  type BrandColors, type FlyerSettings, type ListingDefaults,
} from '@gct/shared';
import { Button, Card, EmptyState, ErrorState, Field, FormError, Input, LinkButton, LoadingBlock, Select } from '@/components/ui';
import { useToast } from '@/components/toast';
import { api, ApiError } from '@/lib/client/api';
import { brl } from '@/lib/client/format';
import { useCan } from '@/lib/client/session';
import { FlyerPageView, PAGE_H, PAGE_W, themeFrom, type FlyerItem } from './flyer-page';
import { dominantColors } from './logo-colors';

interface Tenant {
  name: string; phone: string | null; address: Record<string, string>;
  settings: { brandLogoId?: string; brandColors?: BrandColors | null; flyer?: FlyerSettings | null; listing?: ListingDefaults | null };
}
interface Product extends FlyerItem { categoryName: string | null; available: number }

const PREVIEW_SCALE = 0.42;

function defaultFooter(t: Tenant): string {
  const delivery = listingDefaults(t.settings.listing, t.address.city).delivery;
  return [delivery, t.phone ? `WhatsApp ${t.phone}` : ''].filter(Boolean).join(' • ');
}

function slug(s: string) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'encarte';
}

/** Encarte digital: produtos com estoque, cores da identidade visual e exportação em imagem/PDF. */
export function FlyerStudio() {
  const can = useCan();
  const qc = useQueryClient();
  const toast = useToast();
  const tenant = useQuery({ queryKey: ['tenant'], queryFn: () => api<Tenant>('tenant') });
  const products = useQuery({ queryKey: ['flyer-products'], queryFn: () => api<Product[]>('flyer/products') });

  const [s, setS] = useState<FlyerSettings | null>(null);
  const [surcharge, setSurcharge] = useState('');
  const [colors, setColors] = useState<BrandColors>(BRAND_DEFAULTS);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [featured, setFeatured] = useState<Set<string>>(new Set());
  const [onlyPhoto, setOnlyPhoto] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState<'' | 'png' | 'pdf' | 'share' | 'logo' | 'save'>('');
  const pageRefs = useRef<(HTMLDivElement | null)[]>([]);
  const logoInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!tenant.data || s) return;
    const f = { ...FLYER_DEFAULTS, footer: defaultFooter(tenant.data), ...(tenant.data.settings.flyer ?? {}) };
    setS(f);
    setSurcharge(f.cardSurchargeBps ? formatPercentBps(f.cardSurchargeBps) : '');
    setColors(tenant.data.settings.brandColors ?? BRAND_DEFAULTS);
  }, [tenant.data, s]);
  useEffect(() => {
    if (products.data) setSelected(new Set(products.data.map((p) => p.id)));
  }, [products.data]);

  const logoId = tenant.data?.settings.brandLogoId;
  const logoUrl = logoId ? `/api/v1/attachments/${logoId}` : null;
  const theme = useMemo(() => themeFrom(colors), [colors]);
  const chosen = useMemo(() => (products.data ?? []).filter((p) => selected.has(p.id) && (!onlyPhoto || p.imageId)), [products.data, selected, onlyPhoto]);
  const pages = useMemo(() => paginateFlyer(chosen, (p) => featured.has(p.id)), [chosen, featured]);

  if (tenant.isLoading || products.isLoading || (tenant.data && !s)) return <LoadingBlock rows={6} />;
  if (tenant.error || products.error) return <ErrorState error={tenant.error ?? products.error} retry={() => { tenant.refetch(); products.refetch(); }} />;
  const list = products.data!;
  if (list.length === 0) {
    return <Card><EmptyState icon={<ImageOff className="size-5" />} title="Nenhum produto disponível em estoque" description="O encarte usa produtos ativos com preço e saldo disponível. Registre uma compra ou ajuste o estoque." action={<LinkButton href="/app/compras/nova">Registrar compra</LinkButton>} /></Card>;
  }
  const settings = s!;
  const set = <K extends keyof FlyerSettings>(k: K, v: FlyerSettings[K]) => setS({ ...settings, [k]: v });
  const surchargeOk = surcharge.trim() === '' || parsePercentBps(surcharge) !== null;
  const colorsOk = HEX_COLOR.test(colors.primary) && HEX_COLOR.test(colors.secondary) && HEX_COLOR.test(colors.accent);

  const colorsFromLogo = async (url: string) => {
    try { setColors(paletteFromColors(await dominantColors(url))); toast('Cores tiradas da logo. Ajuste se quiser.'); } catch { toast('Não foi possível ler as cores da logo.'); }
  };

  const uploadLogo = async (file: File | undefined) => {
    if (!file) return;
    setBusy('logo'); setError(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/v1/tenant/logo', { method: 'POST', body: fd, credentials: 'same-origin' });
      if (!res.ok) { const e = (await res.json()).error; throw new ApiError(res.status, e.code, e.message, e.fields, e.requestId); }
      const { id } = (await res.json()) as { id: string };
      await qc.invalidateQueries({ queryKey: ['tenant'] });
      await colorsFromLogo(`/api/v1/attachments/${id}`);
    } catch (e) { setError(e); } finally { setBusy(''); if (logoInput.current) logoInput.current.value = ''; }
  };

  const save = async () => {
    setBusy('save'); setError(null);
    try {
      await api('tenant', { method: 'PUT', body: { settings: { brandColors: colors, flyer: { ...settings, cardSurchargeBps: parsePercentBps(surcharge) ?? 0 } } } });
      await qc.invalidateQueries({ queryKey: ['tenant'] });
      toast('Identidade visual e textos salvos.');
    } catch (e) { setError(e); } finally { setBusy(''); }
  };

  const render = async (kind: 'png' | 'jpeg') => {
    const { domToPng, domToJpeg } = await import('modern-screenshot');
    const out: string[] = [];
    for (const node of pageRefs.current.slice(0, pages.length)) {
      if (!node) continue;
      const opts = { width: PAGE_W, height: PAGE_H, scale: 1, quality: 0.92, style: { transform: 'none' } };
      out.push(kind === 'png' ? await domToPng(node, opts) : await domToJpeg(node, opts));
    }
    if (out.length !== pages.length) throw new Error('Nem todas as páginas foram geradas.');
    return out;
  };
  const name = slug(settings.title || tenant.data!.name);
  const download = (href: string, file: string) => { const a = document.createElement('a'); a.href = href; a.download = file; document.body.appendChild(a); a.click(); a.remove(); };

  const run = async (kind: 'png' | 'pdf' | 'share') => {
    setBusy(kind); setError(null);
    try {
      if (kind === 'png') {
        const imgs = await render('png');
        imgs.forEach((u, i) => download(u, `${name}-${i + 1}.png`));
        toast(`${imgs.length} ${imgs.length === 1 ? 'imagem baixada' : 'imagens baixadas'}.`);
      } else if (kind === 'pdf') {
        const imgs = await render('jpeg');
        const { jsPDF } = await import('jspdf');
        const pdf = new jsPDF({ unit: 'px', format: [PAGE_W, PAGE_H], hotfixes: ['px_scaling'], compress: true });
        imgs.forEach((u, i) => { if (i) pdf.addPage([PAGE_W, PAGE_H]); pdf.addImage(u, 'JPEG', 0, 0, PAGE_W, PAGE_H); });
        pdf.save(`${name}.pdf`);
        toast('PDF do encarte baixado.');
      } else {
        const imgs = await render('png');
        const files = await Promise.all(imgs.map(async (u, i) => new File([await (await fetch(u)).blob()], `${name}-${i + 1}.png`, { type: 'image/png' })));
        if (!navigator.canShare?.({ files })) { files.forEach((f, i) => download(imgs[i]!, f.name)); toast('Compartilhamento indisponível aqui; imagens baixadas.'); return; }
        await navigator.share({ files, title: settings.title });
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError(e instanceof ApiError ? e : new Error(`Não foi possível gerar o encarte: ${(e as Error).message}`));
    } finally { setBusy(''); }
  };

  const toggle = (setFn: typeof setSelected, id: string) => setFn((cur) => { const n = new Set(cur); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <div className="grid gap-4 2xl:grid-cols-[420px_1fr]">
      <div className="flex flex-col gap-4">
        <Card title="Identidade visual" description="O encarte usa a logo e as cores da sua marca.">
          <div className="flex items-center gap-3">
            <div className="flex h-16 w-32 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-line bg-white p-2">
              {logoUrl ? <img src={logoUrl} alt="Logo da empresa" className="max-h-full max-w-full object-contain" /> : <span className="text-xs text-neutral-500">Sem logo</span>}
            </div>
            {can('settings.manage') ? (
              <div className="flex flex-wrap gap-2">
                <input ref={logoInput} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" id="logo-input" onChange={(e) => uploadLogo(e.target.files?.[0])} />
                <Button size="sm" variant="secondary" loading={busy === 'logo'} onClick={() => logoInput.current?.click()}><ImagePlus className="size-4" />{logoUrl ? 'Trocar logo' : 'Enviar logo'}</Button>
                {logoUrl && <Button size="sm" variant="quiet" onClick={() => colorsFromLogo(logoUrl)}><Wand2 className="size-4" />Cores da logo</Button>}
                {logoUrl && <Button size="sm" variant="quiet" aria-label="Remover logo" onClick={async () => { try { await api('tenant/logo', { method: 'DELETE' }); await qc.invalidateQueries({ queryKey: ['tenant'] }); } catch (e) { setError(e); } }}><Trash2 className="size-4" /></Button>}
              </div>
            ) : <p className="text-sm text-muted">Só quem gerencia a empresa troca a logo.</p>}
          </div>
          <p className="mt-2 text-xs text-muted">PNG com fundo transparente fica melhor. Ao enviar, as cores são tiradas da logo automaticamente.</p>
          <div className="mt-3 grid grid-cols-3 gap-2">
            {([['primary', 'Cor do fundo'], ['secondary', 'Cor do preço'], ['accent', 'Cor do título']] as const).map(([k, label]) => (
              <Field key={k} label={label} htmlFor={`cor-${k}`}>
                <div className="flex items-center gap-2">
                  <input id={`cor-${k}`} type="color" value={HEX_COLOR.test(colors[k]) ? colors[k] : '#000000'} onChange={(e) => setColors({ ...colors, [k]: e.target.value })} className="h-9 w-10 shrink-0 cursor-pointer rounded-lg border border-line bg-transparent" />
                  <Input aria-label={`${label} (hex)`} value={colors[k]} maxLength={7} onChange={(e) => setColors({ ...colors, [k]: e.target.value })} />
                </div>
              </Field>
            ))}
          </div>
        </Card>

        <Card title="Textos">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Título" htmlFor="enc-title"><Input id="enc-title" maxLength={40} value={settings.title} onChange={(e) => set('title', e.target.value)} /></Field>
            <Field label="Chamada" htmlFor="enc-sub"><Input id="enc-sub" maxLength={60} value={settings.subtitle} onChange={(e) => set('subtitle', e.target.value)} /></Field>
            <div className="sm:col-span-2"><Field label="Rodapé" htmlFor="enc-foot" help="Entrega, WhatsApp, endereço."><Input id="enc-foot" maxLength={160} value={settings.footer} onChange={(e) => set('footer', e.target.value)} /></Field></div>
            <div className="sm:col-span-2"><Field label="Validade das ofertas" htmlFor="enc-val" help="Ex.: Ofertas válidas de 01/10 a 31/10 ou enquanto durar o estoque."><Input id="enc-val" maxLength={80} value={settings.validity} onChange={(e) => set('validity', e.target.value)} /></Field></div>
            <Field label="Cartão" htmlFor="enc-card">
              <Select id="enc-card" value={String(settings.cardInstallments)} onChange={(e) => set('cardInstallments', Number(e.target.value))}>
                <option value="0">Não mencionar</option><option value="1">Aceita cartão</option>
                {[2, 3, 6, 10, 12, 18].map((n) => <option key={n} value={n}>Em até {n}x</option>)}
              </Select>
            </Field>
            <Field label="Acréscimo no cartão (%)" htmlFor="enc-sur" error={surchargeOk ? undefined : 'Use um número, ex.: 11,14'} help="Vazio: mostra só as parcelas. Com valor: mostra “ou R$ X no cartão”.">
              <Input id="enc-sur" inputMode="decimal" placeholder="0" value={surcharge} invalid={!surchargeOk} onChange={(e) => { setSurcharge(e.target.value); const b = parsePercentBps(e.target.value); set('cardSurchargeBps', b ?? 0); }} />
            </Field>
          </div>
          {can('settings.manage') && (
            <div className="mt-3 flex justify-end"><Button variant="secondary" loading={busy === 'save'} disabled={!colorsOk || !surchargeOk} onClick={save}><Palette className="size-4" />Salvar identidade e textos</Button></div>
          )}
        </Card>

        <Card title={`Produtos (${chosen.length} de ${list.length})`} description="Produtos ativos com estoque disponível. A estrela coloca o produto em destaque na capa (até 2)." action={
          <div className="flex gap-1">
            <Button size="sm" variant="quiet" onClick={() => setSelected(new Set(list.map((p) => p.id)))}>Todos</Button>
            <Button size="sm" variant="quiet" onClick={() => setSelected(new Set())}>Nenhum</Button>
          </div>
        }>
          <label className="mb-2 flex items-center gap-2 text-sm"><input type="checkbox" checked={onlyPhoto} onChange={(e) => setOnlyPhoto(e.target.checked)} />Somente produtos com foto</label>
          <ul className="flex max-h-[28rem] flex-col divide-y divide-line overflow-y-auto">
            {list.map((p) => (
              <li key={p.id} className="flex items-center gap-3 py-2">
                <input type="checkbox" aria-label={`Incluir ${p.name}`} checked={selected.has(p.id)} onChange={() => toggle(setSelected, p.id)} />
                <span className="size-10 shrink-0 overflow-hidden rounded-lg border border-line bg-bg">
                  {p.imageId ? <img src={`/api/v1/attachments/${p.imageId}`} alt="" className="size-full object-cover" loading="lazy" /> : <span className="flex size-full items-center justify-center text-muted"><ImageOff className="size-4" /></span>}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{p.name}</span>
                  <span className="block text-xs text-muted">{brl(p.retailPriceCents)} · {p.available} em estoque{p.categoryName ? ` · ${p.categoryName}` : ''}</span>
                </span>
                <button type="button" aria-label={featured.has(p.id) ? `Tirar ${p.name} do destaque` : `Destacar ${p.name}`} aria-pressed={featured.has(p.id)} onClick={() => toggle(setFeatured, p.id)} className="rounded-lg p-1.5 hover:bg-surface-2">
                  <Star className={featured.has(p.id) ? 'size-4 fill-warning text-warning' : 'size-4 text-muted'} />
                </button>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card title={`Prévia · ${pages.length} ${pages.length === 1 ? 'página' : 'páginas'}`} description="1080×1350 px, formato de post e status." action={
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" loading={busy === 'share'} disabled={!pages.length || !!busy} onClick={() => run('share')}><Share2 className="size-4" />Compartilhar</Button>
          <Button size="sm" variant="secondary" loading={busy === 'png'} disabled={!pages.length || !!busy} onClick={() => run('png')}><Download className="size-4" />Imagens</Button>
          <Button size="sm" loading={busy === 'pdf'} disabled={!pages.length || !!busy} onClick={() => run('pdf')}><FileDown className="size-4" />PDF</Button>
        </div>
      }>
        <FormError error={error} />
        {pages.length === 0 ? <p className="text-sm text-muted">Selecione ao menos um produto.</p> : (
          <div className="flex flex-wrap gap-4" data-testid="flyer-preview">
            {pages.map((pg, i) => (
              <div key={i} style={{ width: PAGE_W * PREVIEW_SCALE, height: PAGE_H * PREVIEW_SCALE }} className="shrink-0 overflow-hidden rounded-xl shadow-lg">
                <div style={{ transform: `scale(${PREVIEW_SCALE})`, transformOrigin: 'top left', width: PAGE_W, height: PAGE_H }}>
                  <FlyerPageView ref={(el) => { pageRefs.current[i] = el; }} page={pg} index={i} total={pages.length} theme={theme} settings={settings} logoUrl={logoUrl} companyName={tenant.data!.name} />
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
