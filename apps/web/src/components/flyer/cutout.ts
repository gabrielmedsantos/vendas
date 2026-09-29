import { removeUniformBackground } from '@gct/shared';

const cache = new Map<string, Promise<string>>();

/**
 * Foto pronta para o encarte: fundo liso removido e margens cortadas (PNG em data URL).
 * Fundo complexo: devolve a foto original. Tudo roda no navegador; nada é enviado a terceiros.
 */
export function productCutout(src: string, maxSide = 900): Promise<string> {
  const hit = cache.get(src);
  if (hit) return hit;
  const job = (async () => {
    const img = new Image();
    img.decoding = 'async';
    img.src = src;
    await img.decode();
    const k = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(3, Math.round(img.naturalWidth * k));
    const h = Math.max(3, Math.round(img.naturalHeight * k));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return src;
    ctx.drawImage(img, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h);
    const r = removeUniformBackground(data.data, w, h);
    if (r.mode === 'none' || !r.box) return src;
    ctx.putImageData(data, 0, 0);
    const pad = Math.round(Math.max(r.box.w, r.box.h) * 0.02);
    const x = Math.max(0, r.box.x - pad), y = Math.max(0, r.box.y - pad);
    const cw = Math.min(w - x, r.box.w + pad * 2), ch = Math.min(h - y, r.box.h + pad * 2);
    const out = document.createElement('canvas');
    out.width = cw;
    out.height = ch;
    out.getContext('2d')!.drawImage(canvas, x, y, cw, ch, 0, 0, cw, ch);
    return out.toDataURL('image/png');
  })().catch(() => src);
  cache.set(src, job);
  return job;
}
