import { applyBps, toCents } from './money';

/** Encarte digital: cálculos puros (preço dividido, preço no cartão, paginação, cores). */

export interface FlyerSettings {
  title: string;
  subtitle: string;
  /** Texto do rodapé (ex.: entrega, contato). */
  footer: string;
  /** Ex.: "Ofertas válidas de 01/10 a 31/10". Vazio = não mostra. */
  validity: string;
  /** Acréscimo do preço no cartão em basis points (0 = mostra só "em até Nx"). */
  cardSurchargeBps: number;
  /** Parcelas mencionadas no cartão (0 = não menciona cartão). */
  cardInstallments: number;
  /** Ordem escolhida dos produtos (ids); produtos novos entram no fim. */
  order?: string[];
  /** Produtos em destaque na capa (ids). */
  featured?: string[];
  /** Texto falado no vídeo (vazio = sem narração). */
  narration?: string;
  /** Voz da narração. */
  voice?: NarrationVoice;
}

export type NarrationVoice = 'pf_dora' | 'pm_alex' | 'pm_santa';
export const NARRATION_VOICES: { id: NarrationVoice; label: string }[] = [
  { id: 'pf_dora', label: 'Feminina (Dora)' },
  { id: 'pm_alex', label: 'Masculina (Alex)' },
  { id: 'pm_santa', label: 'Masculina (Santa)' },
];

/** Narração sugerida a partir dos padrões da loja (garantia e parcelas). */
export function defaultNarration(company: string, warrantyMonths: number, cardInstallments: number): string {
  const parts = [`Compre na ${company.trim() || 'nossa loja'} com os melhores preços`];
  if (warrantyMonths > 0) parts.push(`com ${warrantyMonths} ${warrantyMonths === 1 ? 'mês' : 'meses'} de garantia`);
  if (cardInstallments > 1) parts.push(`parcelado em até ${cardInstallments} vezes no cartão`);
  return `${parts.join(', ')}.`;
}

export const FLYER_DEFAULTS: FlyerSettings = {
  title: 'Mega Ofertas',
  subtitle: 'Preços que você nunca viu!',
  footer: '',
  validity: '',
  cardSurchargeBps: 0,
  cardInstallments: 12,
};

export interface BrandColors {
  /** Fundo principal do encarte. */
  primary: string;
  /** Faixas e selos de preço. */
  secondary: string;
  /** Título e números de destaque. */
  accent: string;
}

export const BRAND_DEFAULTS: BrandColors = { primary: '#1d3fbf', secondary: '#e3262f', accent: '#ffd400' };

/** "R$ 1.599,90" → { int: '1.599', dec: '90' } sem ponto flutuante. */
export function splitPrice(cents: string | bigint): { int: string; dec: string } {
  const v = typeof cents === 'bigint' ? cents : toCents(cents);
  const abs = v < 0n ? -v : v;
  return { int: (abs / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.'), dec: (abs % 100n).toString().padStart(2, '0') };
}

/** Preço no cartão = à vista + acréscimo (arredondado ao centavo, half-up). */
export function cardPrice(cents: string | bigint, surchargeBps: number): bigint {
  const v = typeof cents === 'bigint' ? cents : toCents(cents);
  return v + applyBps(v, Math.max(0, Math.trunc(surchargeBps)));
}

/** "11,14" → 1114 bps; aceita até 2 casas decimais, sem float. Inválido → null. */
export function parsePercentBps(input: string): number | null {
  const m = /^\s*(\d{1,3})(?:[.,](\d{1,2}))?\s*%?\s*$/.exec(input);
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
}

/** 1114 → "11,14"; 1000 → "10". */
export function formatPercentBps(bps: number): string {
  const i = Math.trunc(bps / 100);
  const d = Math.abs(bps % 100);
  return d ? `${i},${String(d).padStart(2, '0').replace(/0$/, '')}` : String(i);
}

export interface FlyerPage<T> { first: boolean; featured: T[]; items: T[] }

/** Capacidade: 1ª página = 2 destaques + 3 itens; demais = 9 itens (3×3). */
export const FLYER_FIRST_FEATURED = 2;
export const FLYER_FIRST_ITEMS = 3;
export const FLYER_PAGE_ITEMS = 9;

/**
 * Distribui produtos nas páginas. Destaques escolhidos vão para a 1ª página (máx. 2);
 * sem escolha, os 2 primeiros viram destaque. A ordem dos demais é preservada.
 */
export function paginateFlyer<T>(items: T[], isFeatured: (t: T) => boolean = () => false): FlyerPage<T>[] {
  if (items.length === 0) return [];
  let featured = items.filter(isFeatured).slice(0, FLYER_FIRST_FEATURED);
  if (featured.length === 0) featured = items.slice(0, Math.min(FLYER_FIRST_FEATURED, items.length));
  const rest = items.filter((t) => !featured.includes(t));
  const pages: FlyerPage<T>[] = [{ first: true, featured, items: rest.slice(0, FLYER_FIRST_ITEMS) }];
  for (let i = FLYER_FIRST_ITEMS; i < rest.length; i += FLYER_PAGE_ITEMS) pages.push({ first: false, featured: [], items: rest.slice(i, i + FLYER_PAGE_ITEMS) });
  return pages;
}

// ------------------------------------------------------------------ cores

export const HEX_COLOR = /^#[0-9a-f]{6}$/i;

export function hexToRgb(hex: string): [number, number, number] {
  const h = HEX_COLOR.test(hex) ? hex.slice(1) : '000000';
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

export function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0')).join('')}`;
}

/** Luminância relativa (WCAG). */
export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m) as [number, number];
  return (x + 0.05) / (y + 0.05);
}

/** Texto legível sobre a cor: branco ou quase-preto, o de maior contraste. */
export function readableOn(bg: string): string {
  return contrastRatio(bg, '#ffffff') >= contrastRatio(bg, '#111111') ? '#ffffff' : '#111111';
}

/** Mistura com preto (amount < 0) ou branco (amount > 0), amount em [-1, 1]. */
export function shade(hex: string, amount: number): string {
  const [r, g, b] = hexToRgb(hex);
  const t = amount < 0 ? 0 : 255;
  const k = Math.abs(amount);
  return rgbToHex(r + (t - r) * k, g + (t - g) * k, b + (t - b) * k);
}

function hsl(hex: string): { h: number; s: number; l: number } {
  const [r, g, b] = hexToRgb(hex).map((c) => c / 255) as [number, number, number];
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? ((g - b) / d + (g < b ? 6 : 0)) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: h * 60, s, l };
}

/**
 * Escolhe as cores do encarte a partir das cores dominantes da logo (mais frequentes primeiro).
 * Cores quase brancas/pretas/cinzas são ignoradas; faltando cor, completa com o padrão.
 * primary: a cor da marca mais escura o bastante para texto branco (fundo);
 * accent: a mais clara/viva (título); secondary: outra cor distinta (selos de preço).
 */
export function paletteFromColors(colors: string[]): BrandColors {
  const vivid = colors.filter((c) => HEX_COLOR.test(c)).filter((c) => { const x = hsl(c); return x.s >= 0.25 && x.l >= 0.12 && x.l <= 0.9; });
  const distinct: string[] = [];
  for (const c of vivid) if (distinct.every((d) => Math.min(Math.abs(hsl(d).h - hsl(c).h), 360 - Math.abs(hsl(d).h - hsl(c).h)) >= 25)) distinct.push(c);
  if (distinct.length === 0) return { ...BRAND_DEFAULTS };
  const byDark = [...distinct].sort((a, b) => luminance(a) - luminance(b));
  let primary = byDark[0]!;
  // Fundo precisa sustentar texto branco (≥ 4,5:1); escurece até atingir.
  for (let k = 0.1; contrastRatio(primary, '#ffffff') < 4.5 && k <= 0.8; k += 0.1) primary = shade(byDark[0]!, -k);
  const others = distinct.filter((c) => c !== byDark[0]);
  const accent = others.length ? [...others].sort((a, b) => luminance(b) - luminance(a))[0]! : BRAND_DEFAULTS.accent;
  const secondary = others.find((c) => c !== accent) ?? (accent === BRAND_DEFAULTS.accent ? BRAND_DEFAULTS.secondary : shade(accent, -0.35));
  return { primary, secondary, accent };
}

/** Aplica a ordem salva: ids salvos que ainda existem primeiro (na ordem salva), depois os novos na ordem original. */
export function applyOrder(ids: string[], saved: string[] | undefined | null): string[] {
  const exists = new Set(ids);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of saved ?? []) if (exists.has(id) && !seen.has(id)) { out.push(id); seen.add(id); }
  for (const id of ids) if (!seen.has(id)) out.push(id);
  return out;
}

/** Move o item da posição `from` para `to` (nova lista). */
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || from >= list.length) return list;
  const out = [...list];
  const [it] = out.splice(from, 1);
  out.splice(Math.max(0, Math.min(to, out.length)), 0, it!);
  return out;
}
