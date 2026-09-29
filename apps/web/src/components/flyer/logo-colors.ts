import { rgbToHex } from '@gct/shared';

/** Cores dominantes de uma imagem (mais frequentes primeiro), ignorando pixels transparentes. */
export async function dominantColors(src: string, max = 8): Promise<string[]> {
  const img = new Image();
  img.decoding = 'async';
  img.src = src;
  await img.decode();
  const size = 96;
  const canvas = document.createElement('canvas');
  const ratio = Math.min(size / img.naturalWidth, size / img.naturalHeight, 1);
  canvas.width = Math.max(1, Math.round(img.naturalWidth * ratio));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * ratio));
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return [];
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  // Agrupa em "baldes" de 4 bits por canal; cada balde guarda a média real das cores.
  const buckets = new Map<number, { n: number; r: number; g: number; b: number }>();
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3]! < 200) continue;
    const r = data[i]!, g = data[i + 1]!, b = data[i + 2]!;
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const cur = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    cur.n++; cur.r += r; cur.g += g; cur.b += b;
    buckets.set(key, cur);
  }
  return [...buckets.values()].sort((a, b) => b.n - a.n).slice(0, max * 4).map((x) => rgbToHex(x.r / x.n, x.g / x.n, x.b / x.n));
}
