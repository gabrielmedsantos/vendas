/**
 * Recorte de produto para o encarte (sem IA, sem rede): remove fundo liso ligado às bordas
 * (branco, cinza ou cor única, típico de foto de produto) e calcula a área útil para cortar margens.
 * Opera sobre pixels RGBA (ImageData.data) e altera o alfa no próprio buffer.
 */

export interface CutoutBox { x: number; y: number; w: number; h: number }
export interface CutoutResult {
  /** removed = fundo liso removido; alpha = imagem já tinha transparência; none = fundo complexo, mantida. */
  mode: 'removed' | 'alpha' | 'none';
  /** Área com conteúdo (para cortar as margens); null = usar a imagem inteira. */
  box: CutoutBox | null;
}

export interface CutoutOptions {
  /** Distância RGB até a cor do fundo abaixo da qual o pixel é fundo. */
  tolerance?: number;
  /** Faixa acima da tolerância com transparência parcial (borda suave). */
  feather?: number;
  /** Fração mínima da borda com a mesma cor para considerar o fundo liso. */
  uniformity?: number;
}

const dist = (px: Uint8ClampedArray, i: number, r: number, g: number, b: number) => {
  const dr = px[i]! - r, dg = px[i + 1]! - g, db = px[i + 2]! - b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
};

function alphaBox(px: Uint8ClampedArray, w: number, h: number, min = 16): CutoutBox | null {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (px[(y * w + x) * 4 + 3]! > min) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

export function removeUniformBackground(px: Uint8ClampedArray, w: number, h: number, opts: CutoutOptions = {}): CutoutResult {
  const tol = opts.tolerance ?? 24;
  const feather = opts.feather ?? 22;
  const uniformity = opts.uniformity ?? 0.7;
  if (w < 3 || h < 3 || px.length !== w * h * 4) return { mode: 'none', box: null };

  // Pixels da borda.
  const border: number[] = [];
  for (let x = 0; x < w; x++) border.push(x, (h - 1) * w + x);
  for (let y = 1; y < h - 1; y++) border.push(y * w, y * w + w - 1);

  // Já transparente (PNG recortado): só corta as margens.
  const transparentBorder = border.filter((p) => px[p * 4 + 3]! < 128).length;
  if (transparentBorder / border.length > 0.5) {
    const box = alphaBox(px, w, h);
    return { mode: 'alpha', box };
  }

  // Cor do fundo = mediana por canal da borda; fundo liso se a maior parte da borda estiver perto dela.
  const med = (c: number) => { const v = border.map((p) => px[p * 4 + c]!).sort((a, b) => a - b); return v[v.length >> 1]!; };
  const [r, g, b] = [med(0), med(1), med(2)];
  const near = border.filter((p) => dist(px, p * 4, r, g, b) < tol).length;
  if (near / border.length < uniformity) return { mode: 'none', box: null };

  // Preenchimento a partir da borda: só o fundo conectado às bordas sai (partes claras dentro do produto ficam).
  const bg = new Uint8Array(w * h);
  const queue = new Int32Array(w * h);
  let head = 0, tail = 0;
  for (const p of border) if (!bg[p] && dist(px, p * 4, r, g, b) < tol) { bg[p] = 1; queue[tail++] = p; }
  while (head < tail) {
    const p = queue[head++]!;
    const x = p % w, y = (p - x) / w;
    const next = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1];
    for (const q of next) if (q >= 0 && !bg[q] && dist(px, q * 4, r, g, b) < tol) { bg[q] = 1; queue[tail++] = q; }
  }
  const removed = tail / (w * h);
  // Quase tudo "fundo" (produto da mesma cor do fundo) ou quase nada: não mexe.
  if (removed > 0.97 || removed < 0.02) return { mode: 'none', box: null };

  for (let p = 0; p < w * h; p++) {
    if (bg[p]) { px[p * 4 + 3] = 0; continue; }
    // Borda suave: pixel do produto encostado no fundo e com cor parecida fica semitransparente.
    const x = p % w;
    const touches = (x > 0 && bg[p - 1]) || (x < w - 1 && bg[p + 1]) || (p >= w && bg[p - w]) || (p + w < w * h && bg[p + w]);
    if (touches) {
      const d = dist(px, p * 4, r, g, b);
      if (d < tol + feather) px[p * 4 + 3] = Math.round((px[p * 4 + 3]! * (d - tol)) / feather) || 0;
    }
  }
  return { mode: 'removed', box: alphaBox(px, w, h) };
}
