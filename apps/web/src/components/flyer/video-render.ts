import {
  cardPrice, cardProgress, easeInCubic, easeOutBack, easeOutCubic, formatBRL, sceneAt, seeded, shade, splitPrice,
  VIDEO_H, VIDEO_W, type FlyerSettings,
} from '@gct/shared';
import type { FlyerItem, FlyerTheme } from './flyer-page';

/** Tudo que o desenho precisa, já carregado (imagens decodificadas). */
export interface VideoData {
  pages: FlyerItem[][];
  images: Map<string, HTMLImageElement>; // chave: id do produto
  logo: HTMLImageElement | null;
  theme: FlyerTheme;
  settings: FlyerSettings;
  companyName: string;
  /** Duração do final (s), estendida quando há narração longa. */
  outro?: number;
}

const FONT = "'Inter Variable', Inter, system-ui, sans-serif";
const W = VIDEO_W;
const H = VIDEO_H;
const HEADER_H = 430;
const FOOTER_H = 110;
const GRID = { x: 48, y: HEADER_H + 20, gap: 30, cols: 2, rows: 3 };

type Ctx = CanvasRenderingContext2D;

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function font(ctx: Ctx, size: number, weight = 900, italic = false) {
  ctx.font = `${italic ? 'italic ' : ''}${weight} ${size}px ${FONT}`;
}

/** Quebra em até `lines` linhas; a última recebe reticências se sobrar texto. */
function wrap(ctx: Ctx, text: string, maxW: number, lines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let cur = '';
  for (let i = 0; i < words.length; i++) {
    const next = cur ? `${cur} ${words[i]}` : words[i]!;
    if (ctx.measureText(next).width <= maxW) { cur = next; continue; }
    if (cur) out.push(cur);
    cur = words[i]!;
    if (out.length === lines - 1) {
      const full = words.slice(i).join(' ');
      if (ctx.measureText(full).width <= maxW) { out.push(full); return out; }
      let rest = full;
      while (rest.length > 1 && ctx.measureText(`${rest}…`).width > maxW) rest = rest.slice(0, -1);
      out.push(rest.length < words.slice(i).join(' ').length ? `${rest.trimEnd()}…` : rest);
      return out;
    }
  }
  if (cur) out.push(cur);
  return out.slice(0, lines);
}

function background(ctx: Ctx, t: FlyerTheme, time: number) {
  const g = ctx.createRadialGradient(W / 2, H * 0.18, 60, W / 2, H * 0.4, H * 0.9);
  g.addColorStop(0, shade(t.bg, 0.14));
  g.addColorStop(0.45, t.bg);
  g.addColorStop(1, t.bgDark);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  // Ondas em movimento lento.
  ctx.save();
  ctx.globalAlpha = 0.3;
  ctx.strokeStyle = t.wave;
  ctx.lineWidth = 22;
  ctx.lineCap = 'round';
  const shift = (time * 60) % 220;
  for (let i = -1; i < 20; i++) {
    const y = i * 110 - 60 + shift * 0.5;
    ctx.beginPath();
    ctx.moveTo(-60, y);
    ctx.bezierCurveTo(260, y - 80, 520, y + 100, 780, y);
    ctx.bezierCurveTo(900, y - 40, 1040, y - 60, 1160, y + 20);
    ctx.stroke();
  }
  ctx.restore();
}

function title(ctx: Ctx, text: string, t: FlyerTheme, cx: number, cy: number, size: number, maxW: number) {
  font(ctx, size, 900, true);
  const lines = wrap(ctx, text.toUpperCase(), maxW, 2);
  const lh = size * 0.9;
  const y0 = cy - ((lines.length - 1) * lh) / 2;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  lines.forEach((line, i) => {
    const y = y0 + i * lh;
    // Profundidade 3D + contorno + preenchimento.
    ctx.fillStyle = t.titleEdge;
    for (let d = 10; d > 0; d--) ctx.fillText(line, cx, y + d);
    ctx.lineWidth = size * 0.09;
    ctx.strokeStyle = t.titleEdge;
    ctx.strokeText(line, cx, y);
    ctx.fillStyle = t.title;
    ctx.fillText(line, cx, y);
  });
}

function logoPill(ctx: Ctx, data: VideoData, x: number, y: number, h: number, align: 'right' | 'center') {
  const { logo, theme: t, companyName } = data;
  let w: number;
  if (logo) w = Math.min(h * 2.8, (logo.naturalWidth / logo.naturalHeight) * (h - h * 0.28) + h * 0.28);
  else { font(ctx, h * 0.3, 900); w = Math.min(420, ctx.measureText(companyName).width + h * 0.5); }
  const left = align === 'right' ? x - w : x - w / 2;
  ctx.fillStyle = t.bgDark;
  roundRect(ctx, left, y + 7, w, h, h * 0.3); ctx.fill();
  ctx.fillStyle = '#fff';
  roundRect(ctx, left, y, w, h, h * 0.3); ctx.fill();
  if (logo) {
    const pad = h * 0.14;
    const ih = h - pad * 2;
    const iw = Math.min(w - pad * 2, (logo.naturalWidth / logo.naturalHeight) * ih);
    ctx.drawImage(logo, left + (w - iw) / 2, y + pad, iw, ih);
  } else {
    ctx.fillStyle = t.bg;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    font(ctx, h * 0.3, 900);
    ctx.fillText(companyName, left + w / 2, y + h / 2, w - h * 0.3);
  }
}

/** Largura da pílula da logo (para o título ocupar o resto do cabeçalho). */
function logoWidth(ctx: Ctx, data: VideoData, h: number): number {
  if (data.logo) return Math.min(h * 2.8, (data.logo.naturalWidth / data.logo.naturalHeight) * (h - h * 0.28) + h * 0.28);
  font(ctx, h * 0.3, 900);
  return Math.min(420, ctx.measureText(data.companyName).width + h * 0.5);
}

/** Maior tamanho de título (até `max`) em que a palavra mais larga cabe na largura livre. */
function fitTitle(ctx: Ctx, text: string, maxW: number, max: number): number {
  font(ctx, 100, 900, true);
  const widest = Math.max(...text.toUpperCase().split(/\s+/).map((w) => ctx.measureText(w).width), 1);
  return Math.max(56, Math.min(max, (maxW / widest) * 100 * 0.9));
}

function header(ctx: Ctx, data: VideoData, appear: number) {
  const s = data.settings;
  const text = s.title.trim() || data.companyName;
  const k = easeOutBack(appear);
  const lw = logoWidth(ctx, data, 110);
  const avail = W - 44 - lw - 36 - 44;
  const size = fitTitle(ctx, text, avail, 150);
  ctx.save();
  ctx.translate(44 + avail / 2, 175);
  ctx.scale(k, k);
  ctx.rotate((1 - easeOutCubic(appear)) * -0.25);
  title(ctx, text, data.theme, 0, 0, size, avail);
  ctx.restore();
  // Logo e chamada entram depois do título.
  const a2 = easeOutCubic((appear - 0.35) / 0.65);
  ctx.save();
  ctx.globalAlpha = a2;
  logoPill(ctx, data, W - 44 + (1 - a2) * 200, 70, 110, 'right');
  if (s.subtitle) {
    font(ctx, 46, 800, true);
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(s.subtitle, W / 2, 370 + (1 - a2) * 40, W - 120);
  }
  ctx.restore();
}

function price(ctx: Ctx, cents: string, t: FlyerTheme, s: FlyerSettings, right: number, bottom: number, size: number) {
  const p = splitPrice(cents);
  const small = size * 0.3, dec = size * 0.42, tiny = Math.max(16, size * 0.17);
  font(ctx, size, 900); const wInt = ctx.measureText(p.int).width;
  font(ctx, small, 900); const wRs = ctx.measureText('R$').width;
  font(ctx, dec, 900); const wDec = ctx.measureText(`,${p.dec}`).width;
  const padX = size * 0.2;
  const w = padX * 2 + wRs + size * 0.05 + wInt + size * 0.04 + wDec;
  const h = size * 1.12;
  const x = right - w, y = bottom - h;
  ctx.fillStyle = shade(t.priceBg, -0.35);
  roundRect(ctx, x, y + size * 0.08, w, h, size * 0.3); ctx.fill();
  ctx.fillStyle = t.priceBg;
  roundRect(ctx, x, y, w, h, size * 0.3); ctx.fill();
  ctx.fillStyle = t.priceInk;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  const base = y + h * 0.82;
  let cx = x + padX;
  font(ctx, small, 900); ctx.fillText('R$', cx, y + h * 0.45); cx += wRs + size * 0.05;
  font(ctx, size, 900); ctx.fillText(p.int, cx, base); cx += wInt + size * 0.04;
  font(ctx, dec, 900); ctx.fillText(`,${p.dec}`, cx, y + h * 0.5);
  font(ctx, tiny, 700); ctx.fillText('à vista', cx, y + h * 0.78);
  // Linha do cartão abaixo do selo.
  const card = s.cardInstallments > 0
    ? s.cardSurchargeBps > 0 ? `ou ${formatBRL(cardPrice(cents, s.cardSurchargeBps)).replace(' ', ' ')} no cartão` : s.cardInstallments > 1 ? `em até ${s.cardInstallments}x no cartão` : 'aceitamos cartão'
    : '';
  if (card) {
    font(ctx, Math.max(18, size * 0.24), 600);
    ctx.fillStyle = t.muted;
    ctx.textAlign = 'right';
    ctx.fillText(card, right, bottom + size * 0.38);
  }
}

function card(ctx: Ctx, data: VideoData, item: FlyerItem, x: number, y: number, w: number, h: number, appear: number, priceAppear: number) {
  const t = data.theme;
  if (appear <= 0) return;
  const k = easeOutBack(appear);
  ctx.save();
  ctx.translate(x + w / 2, y + h / 2);
  ctx.scale(k, k);
  ctx.rotate((1 - easeOutCubic(appear)) * 0.12);
  ctx.globalAlpha = Math.min(1, appear * 2);
  ctx.translate(-w / 2, -h / 2);
  ctx.fillStyle = t.bgDark;
  roundRect(ctx, 0, 10, w, h, 38); ctx.fill();
  ctx.fillStyle = t.card;
  roundRect(ctx, 0, 0, w, h, 38); ctx.fill();
  // Foto (recortada) ocupando o topo do card.
  const img = data.images.get(item.id);
  const pad = 22;
  const boxH = h * 0.64;
  if (img) {
    const r = Math.min((w - pad * 2) / img.naturalWidth, (boxH - pad) / img.naturalHeight);
    const iw = img.naturalWidth * r, ih = img.naturalHeight * r;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.28)';
    ctx.shadowBlur = 22;
    ctx.shadowOffsetY = 14;
    ctx.drawImage(img, (w - iw) / 2, pad + (boxH - pad - ih) / 2, iw, ih);
    ctx.restore();
  } else {
    ctx.fillStyle = '#eef0f6';
    roundRect(ctx, w * 0.2, pad, w * 0.6, boxH - pad * 1.5, 24); ctx.fill();
    font(ctx, 26, 700); ctx.fillStyle = '#9aa0b4'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(item.brand ?? 'Foto em breve', w / 2, boxH / 2, w * 0.55);
  }
  // Selo de preço por cima da foto (entra com pulo).
  if (priceAppear > 0) {
    const pk = easeOutBack(priceAppear, 2.4);
    ctx.save();
    const right = w - 18, bottom = h * 0.74;
    ctx.translate(right, bottom);
    ctx.rotate(-0.05);
    ctx.scale(pk, pk);
    price(ctx, item.retailPriceCents, t, data.settings, 0, 0, 66);
    ctx.restore();
  }
  // Nome embaixo, com contorno branco.
  font(ctx, 30, 900);
  const lines = wrap(ctx, item.name, w - 40, 2);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.lineJoin = 'round';
  lines.forEach((l, i) => {
    const ly = h - 24 - (lines.length - 1 - i) * 34;
    ctx.lineWidth = 8; ctx.strokeStyle = '#fff'; ctx.strokeText(l, 20, ly);
    ctx.fillStyle = t.ink; ctx.fillText(l, 20, ly);
  });
  ctx.restore();
}

function footer(ctx: Ctx, data: VideoData, page: number, pages: number) {
  const t = data.theme;
  ctx.fillStyle = t.bgDark;
  ctx.fillRect(0, H - FOOTER_H, W, FOOTER_H);
  ctx.fillStyle = t.footerInk;
  ctx.textBaseline = 'middle';
  font(ctx, 30, 700);
  ctx.textAlign = 'left';
  ctx.fillText(data.settings.footer, 44, H - FOOTER_H / 2, W - 360);
  font(ctx, 26, 600);
  ctx.textAlign = 'right';
  const right = [data.settings.validity, pages > 1 && page >= 0 ? `${page + 1}/${pages}` : ''].filter(Boolean).join('   ');
  ctx.fillText(right, W - 44, H - FOOTER_H / 2, 320);
}

function grid(ctx: Ctx, data: VideoData, items: FlyerItem[], progress: (i: number) => [number, number], exitK: number) {
  const n = items.length;
  const cols = n <= 2 ? 1 : 2;
  const rows = Math.ceil(n / cols);
  const areaH = H - GRID.y - FOOTER_H - 40;
  const cw = (W - GRID.x * 2 - GRID.gap * (cols - 1)) / cols;
  const ch = Math.min((areaH - GRID.gap * (rows - 1)) / rows, n <= 2 ? 620 : 9999);
  const top = GRID.y + (areaH - (ch * rows + GRID.gap * (rows - 1))) / 2;
  items.forEach((it, i) => {
    const c = i % cols, r = Math.floor(i / cols);
    const [a, pa] = progress(i);
    ctx.save();
    if (exitK > 0) { ctx.globalAlpha = 1 - exitK; }
    card(ctx, data, it, GRID.x + c * (cw + GRID.gap), top + r * (ch + GRID.gap) + exitK * 120, cw, ch, a, pa);
    ctx.restore();
  });
}

/** Faixa diagonal na cor do título varrendo a tela na troca de página. */
function wipe(ctx: Ctx, t: FlyerTheme, p: number) {
  const x = -W * 1.2 + easeInCubic(p) * W * 2.8;
  ctx.save();
  ctx.fillStyle = t.title;
  ctx.beginPath();
  ctx.moveTo(x, 0); ctx.lineTo(x + W * 0.7, 0); ctx.lineTo(x + W * 0.3, H); ctx.lineTo(x - W * 0.4, H);
  ctx.closePath(); ctx.fill();
  ctx.restore();
}

function sparkles(ctx: Ctx, t: FlyerTheme, time: number, amount: number) {
  const rnd = seeded(42);
  ctx.save();
  for (let i = 0; i < 70; i++) {
    const x = rnd() * W, y0 = rnd() * H, sp = 60 + rnd() * 160, ph = rnd() * 6.28, sz = 3 + rnd() * 9;
    const y = (y0 - time * sp + H) % H;
    const a = amount * (0.4 + 0.6 * Math.abs(Math.sin(time * 4 + ph)));
    ctx.globalAlpha = a;
    ctx.fillStyle = i % 3 === 0 ? t.title : '#ffffff';
    ctx.beginPath();
    ctx.moveTo(x, y - sz * 2); ctx.lineTo(x + sz * 0.5, y); ctx.lineTo(x, y + sz * 2); ctx.lineTo(x - sz * 0.5, y); ctx.closePath();
    ctx.moveTo(x - sz * 2, y); ctx.lineTo(x, y + sz * 0.5); ctx.lineTo(x + sz * 2, y); ctx.lineTo(x, y - sz * 0.5); ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

/** Desenha o quadro do instante `time` (segundos). Determinístico: mesmo tempo, mesmo quadro. */
export function drawVideoFrame(ctx: Ctx, data: VideoData, time: number) {
  const n = data.pages.length;
  const sc = sceneAt(time, n, data.outro);
  background(ctx, data.theme, time);
  if (sc.kind === 'intro') {
    header(ctx, data, sc.p);
    footer(ctx, data, -1, n);
    return;
  }
  if (sc.kind === 'page') {
    header(ctx, data, 1);
    const items = data.pages[sc.page]!;
    const enterT = sc.pageT;
    const exitK = sc.phase === 'exit' ? easeInCubic(sc.p) : 0;
    grid(ctx, data, items, (i) => [cardProgress(enterT, i), cardProgress(enterT - 0.3, i, 0.4)], exitK);
    footer(ctx, data, sc.page, n);
    if (sc.phase === 'exit') wipe(ctx, data.theme, sc.p);
    return;
  }
  // Final: logo grande, chamada e brilhos.
  const k = easeOutBack(sc.t / 0.7);
  sparkles(ctx, data.theme, time, Math.min(1, sc.t / 0.4));
  ctx.save();
  ctx.translate(W / 2, H * 0.36);
  ctx.scale(k, k);
  logoPill(ctx, data, 0, -120, 240, 'center');
  ctx.restore();
  const a = easeOutCubic((sc.t - 0.35) / 0.6);
  ctx.save();
  ctx.globalAlpha = a;
  title(ctx, data.settings.title.trim() || data.companyName, data.theme, W / 2, H * 0.55 + (1 - a) * 60, 110, W - 140);
  font(ctx, 44, 800);
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const lines = wrap(ctx, data.settings.footer || 'Chama no WhatsApp!', W - 160, 3);
  lines.forEach((l, i) => ctx.fillText(l, W / 2, H * 0.68 + i * 58));
  if (data.settings.validity) { font(ctx, 34, 600); ctx.fillText(data.settings.validity, W / 2, H * 0.68 + lines.length * 58 + 30); }
  ctx.restore();
}
