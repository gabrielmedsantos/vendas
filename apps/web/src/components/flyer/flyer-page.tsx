'use client';

import { forwardRef, useEffect, useState, type CSSProperties } from 'react';
import { productCutout } from './cutout';
import { cardPrice, formatBRL, readableOn, shade, splitPrice, type BrandColors, type FlyerPage as Page, type FlyerSettings } from '@gct/shared';

export const PAGE_W = 1080;
export const PAGE_H = 1350;

export interface FlyerItem {
  id: string;
  name: string;
  brand: string | null;
  description: string | null;
  retailPriceCents: string;
  imageId: string | null;
}

export interface FlyerTheme {
  bg: string; bgDark: string; wave: string; title: string; titleEdge: string; card: string; ink: string; muted: string; priceBg: string; priceInk: string; footerInk: string;
}

export function themeFrom(c: BrandColors): FlyerTheme {
  return {
    bg: c.primary,
    bgDark: shade(c.primary, -0.45),
    wave: shade(c.primary, 0.18),
    title: c.accent,
    titleEdge: shade(c.primary, -0.65),
    card: '#ffffff',
    ink: '#14151f',
    muted: '#4b5063',
    priceBg: c.secondary,
    priceInk: readableOn(c.secondary),
    footerInk: readableOn(shade(c.primary, -0.45)),
  };
}

/** Até 3 tópicos curtos tirados da descrição (linhas ou frases). */
function bullets(desc: string | null): string[] {
  if (!desc) return [];
  return desc.split(/\r?\n|;|•/).map((s) => s.replace(/^[-–*\s]+/, '').trim()).filter((s) => s.length > 1 && s.length <= 42).slice(0, 3);
}

function Price({ cents, t, size, s }: { cents: string; t: FlyerTheme; size: number; s: FlyerSettings }) {
  const p = splitPrice(cents);
  const card = s.cardInstallments > 0
    ? s.cardSurchargeBps > 0
      ? `ou ${formatBRL(cardPrice(cents, s.cardSurchargeBps)).replace(' ', ' ')} no cartão`
      : s.cardInstallments > 1 ? `em até ${s.cardInstallments}x no cartão` : 'aceitamos cartão'
    : '';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: size * 0.05, background: t.priceBg, color: t.priceInk, borderRadius: size * 0.32, padding: `${size * 0.1}px ${size * 0.22}px ${size * 0.06}px`, transform: 'rotate(-3deg)', boxShadow: `0 ${size * 0.08}px 0 ${shade(t.priceBg, -0.35)}` }}>
        <span style={{ fontSize: size * 0.3, fontWeight: 900, marginTop: size * 0.12 }}>R$</span>
        <span style={{ fontSize: size, fontWeight: 900, lineHeight: 0.95, letterSpacing: -size * 0.04 }}>{p.int}</span>
        <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
          <span style={{ fontSize: size * 0.42, fontWeight: 900, lineHeight: 1 }}>,{p.dec}</span>
          <span style={{ fontSize: Math.max(12, size * 0.17), fontWeight: 700, marginTop: size * 0.03 }}>à vista</span>
        </span>
      </div>
      {card && <span style={{ fontSize: Math.max(16, size * 0.2), color: t.muted, fontWeight: 600, marginTop: size * 0.14 }}>{card}</span>}
    </div>
  );
}

type CardSize = 'wide' | 'big' | 'medium' | 'small';
const PRICE_SIZE: Record<CardSize, number> = { wide: 110, big: 96, medium: 72, small: 58 };

/** Foto do produto; com `cutout`, usa a versão sem fundo liso e sem margens. */
function Photo({ it, cutout, big }: { it: FlyerItem; cutout: boolean; big?: boolean }) {
  const url = it.imageId ? `/api/v1/attachments/${it.imageId}` : null;
  const [src, setSrc] = useState<string | null>(url && !cutout ? url : null);
  useEffect(() => {
    if (!url) return;
    if (!cutout) { setSrc(url); return; }
    let alive = true;
    productCutout(url).then((u) => { if (alive) setSrc(u); });
    return () => { alive = false; };
  }, [url, cutout]);
  if (!url) return <div style={{ width: '62%', aspectRatio: '1', borderRadius: 24, background: '#eef0f6', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9aa0b4', fontSize: big ? 28 : 18, fontWeight: 700, textAlign: 'center', padding: 12 }}>{it.brand ?? 'Foto em breve'}</div>;
  if (!src) return null;
  return <img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain', filter: cutout ? 'drop-shadow(0 14px 14px rgba(0,0,0,.28))' : undefined }} />;
}

/** Nome sobre a foto: contorno branco garante leitura mesmo encostando no produto. */
function Name({ it, t, size }: { it: FlyerItem; t: FlyerTheme; size: CardSize }) {
  const long = it.name.length > (size === 'small' ? 30 : 42);
  const fs = { wide: long ? 46 : 56, big: long ? 36 : 44, medium: long ? 26 : 32, small: long ? 21 : 25 }[size];
  const b = size === 'wide' ? bullets(it.description) : [];
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: fs, fontWeight: 900, color: t.ink, lineHeight: 1.02, letterSpacing: -0.5, WebkitTextStroke: `${Math.max(4, fs * 0.16)}px #fff`, paintOrder: 'stroke fill', display: '-webkit-box', WebkitLineClamp: size === 'wide' ? 3 : 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{it.name}</div>
      {it.brand && <div style={{ fontSize: Math.max(14, fs * 0.42), color: t.muted, fontWeight: 700, marginTop: 4 }}>{it.brand}</div>}
      {b.length > 0 && <ul style={{ margin: '8px 0 0', padding: 0, listStyle: 'none', fontSize: Math.max(17, fs * 0.42), color: t.muted, fontWeight: 600, lineHeight: 1.3 }}>{b.map((x) => <li key={x}>• {x}</li>)}</ul>}
    </div>
  );
}

/**
 * Card no estilo encarte: a foto ocupa quase todo o card; nome e selo de preço ficam por cima,
 * no rodapé do card. `wide` = foto à esquerda, texto e preço à direita.
 */
function Card({ it, t, s, size, cutout }: { it: FlyerItem; t: FlyerTheme; s: FlyerSettings; size: CardSize; cutout: boolean }) {
  const r = { wide: 44, big: 40, medium: 34, small: 30 }[size];
  const pad = { wide: 28, big: 22, medium: 16, small: 14 }[size];
  const box: CSSProperties = { position: 'relative', background: t.card, borderRadius: r, overflow: 'hidden', boxShadow: `0 10px 0 ${t.bgDark}`, minHeight: 0, minWidth: 0 };
  if (size === 'wide') {
    return (
      <div style={{ ...box, display: 'flex', gap: 24, padding: pad }}>
        <div style={{ flex: '0 0 56%', minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Photo it={it} cutout={cutout} big /></div>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 28 }}>
          <Name it={it} t={t} size="wide" />
          <Price cents={it.retailPriceCents} t={t} size={PRICE_SIZE.wide} s={s} />
        </div>
      </div>
    );
  }
  // Foto ocupa o card até a faixa do nome; o selo de preço fica por cima da parte de baixo da foto.
  const nameZone = { big: '19%', medium: '24%', small: '25%' }[size];
  return (
    <div style={box}>
      <div style={{ position: 'absolute', top: pad, left: pad, right: pad, bottom: nameZone, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Photo it={it} cutout={cutout} big={size === 'big'} /></div>
      <div style={{ position: 'absolute', left: pad, right: pad, bottom: pad * 0.8, display: 'flex', flexDirection: 'column', gap: size === 'small' ? 4 : 8 }}>
        <div style={{ alignSelf: 'flex-end' }}><Price cents={it.retailPriceCents} t={t} size={PRICE_SIZE[size]} s={s} /></div>
        <Name it={it} t={t} size={size} />
      </div>
    </div>
  );
}

/** Grade de uma página interna conforme a quantidade: poucos produtos ganham cards maiores. */
function gridFor(n: number): { cols: number; rows: number; size: CardSize } {
  if (n <= 3) return { cols: 1, rows: Math.max(n, 1), size: 'wide' };
  if (n === 4) return { cols: 2, rows: 2, size: 'big' };
  if (n <= 6) return { cols: 2, rows: 3, size: 'medium' };
  return { cols: 3, rows: 3, size: 'small' };
}

function Waves({ color }: { color: string }) {
  const paths = Array.from({ length: 14 }, (_, i) => {
    const y = i * 110 - 60;
    return <path key={i} d={`M -40 ${y} C 200 ${y - 70}, 420 ${y + 90}, 640 ${y} S 1000 ${y - 60}, 1140 ${y + 20}`} stroke={color} strokeWidth="22" fill="none" strokeLinecap="round" opacity="0.35" />;
  });
  return <svg width={PAGE_W} height={PAGE_H} viewBox={`0 0 ${PAGE_W} ${PAGE_H}`} style={{ position: 'absolute', inset: 0 }} aria-hidden>{paths}</svg>;
}

function Title({ text, t, size }: { text: string; t: FlyerTheme; size: number }) {
  const depth = Array.from({ length: 8 }, (_, i) => `${0}px ${i + 1}px 0 ${t.titleEdge}`).join(', ');
  return (
    <div style={{ fontSize: size, fontWeight: 900, fontStyle: 'italic', lineHeight: 0.88, letterSpacing: -size * 0.03, color: t.title, textTransform: 'uppercase', textAlign: 'center', WebkitTextStroke: `${Math.max(3, size * 0.045)}px ${t.titleEdge}`, paintOrder: 'stroke fill', textShadow: `${depth}, 0 ${size * 0.14}px ${size * 0.2}px rgba(0,0,0,.35)` }}>
      {text}
    </div>
  );
}

export interface FlyerPageProps {
  page: Page<FlyerItem>;
  index: number;
  total: number;
  theme: FlyerTheme;
  settings: FlyerSettings;
  logoUrl: string | null;
  companyName: string;
  /** Remove fundo liso e margens das fotos. */
  cutout?: boolean;
}

/** Uma página do encarte em 1080×1350 (4:5, formato de post e status). */
export const FlyerPageView = forwardRef<HTMLDivElement, FlyerPageProps>(function FlyerPageView({ page, index, total, theme: t, settings: s, logoUrl, companyName, cutout = true }, ref) {
  const title = s.title.trim() || companyName;
  const titleSize = page.first ? (title.length <= 10 ? 150 : title.length <= 16 ? 118 : 92) : 64;
  const logo = (h: number) => logoUrl
    ? <div style={{ background: '#fff', borderRadius: h * 0.3, padding: h * 0.14, height: h, display: 'flex', alignItems: 'center', boxShadow: `0 6px 0 ${t.bgDark}` }}><img src={logoUrl} alt="" style={{ height: '100%', maxWidth: h * 2.6, objectFit: 'contain' }} /></div>
    : <div style={{ background: '#fff', color: t.bg, borderRadius: h * 0.3, padding: `0 ${h * 0.24}px`, height: h, maxWidth: 360, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', fontWeight: 900, lineHeight: 1.05, fontSize: Math.min(h * 0.3, Math.max(18, 520 / Math.max(companyName.length, 1))), boxShadow: `0 6px 0 ${t.bgDark}`, overflow: 'hidden' }}>{companyName}</div>;
  return (
    <div ref={ref} style={{ width: PAGE_W, height: PAGE_H, position: 'relative', overflow: 'hidden', background: `radial-gradient(ellipse at 50% 18%, ${shade(t.bg, 0.12)} 0%, ${t.bg} 45%, ${t.bgDark} 100%)`, fontFamily: "'Inter Variable', Inter, system-ui, sans-serif", display: 'flex', flexDirection: 'column' }}>
      <Waves color={t.wave} />
      <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', flex: 1, padding: '36px 40px 0', gap: 24, minHeight: 0 }}>
        {page.first ? (
          <div style={{ display: 'grid', gridTemplateColumns: '240px 1fr 240px', alignItems: 'center', height: 290 }}>
            <div style={{ color: t.title, fontSize: 40, fontWeight: 900, fontStyle: 'italic', lineHeight: 1.02, transform: 'rotate(-6deg)', textShadow: `0 4px 0 ${t.titleEdge}` }}>{s.subtitle}</div>
            <Title text={title} t={t} size={titleSize} />
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>{logo(110)}</div>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 110 }}>
            <Title text={title} t={t} size={titleSize} />
            {logo(90)}
          </div>
        )}
        {page.featured.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${page.featured.length}, minmax(0, 1fr))`, gap: 24, height: page.items.length ? 520 : 860 }}>
            {page.featured.map((it) => <Card key={it.id} it={it} t={t} s={s} size={page.featured.length === 1 ? 'wide' : 'big'} cutout={cutout} />)}
          </div>
        )}
        {page.first && page.items.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.max(page.items.length, 1)}, minmax(0, 1fr))`, height: 340, gap: 22 }}>
            {page.items.map((it) => <Card key={it.id} it={it} t={t} s={s} size={page.items.length === 1 ? 'big' : page.items.length === 2 ? 'medium' : 'small'} cutout={cutout} />)}
          </div>
        )}
        {!page.first && page.items.length > 0 && (() => {
          const g = gridFor(page.items.length);
          return (
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${g.cols}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${g.rows}, minmax(0, 1fr))`, gap: 22, flex: 1, minHeight: 0 }}>
              {page.items.map((it) => <Card key={it.id} it={it} t={t} s={s} size={g.size} cutout={cutout} />)}
            </div>
          );
        })()}
      </div>
      <div style={{ position: 'relative', marginTop: 24, background: t.bgDark, color: t.footerInk, height: 84, padding: '0 40px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 24, fontSize: 24, fontWeight: 700 }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.footer}</span>
        <span style={{ display: 'flex', gap: 24, whiteSpace: 'nowrap', fontWeight: 600, fontSize: 20, opacity: 0.9 }}>
          {s.validity && <span>{s.validity}</span>}
          {total > 1 && <span>{index + 1}/{total}</span>}
        </span>
      </div>
    </div>
  );
});
