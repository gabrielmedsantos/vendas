import { describe, expect, it } from 'vitest';
import { removeUniformBackground } from '../src';

/** Imagem w×h preenchida com `bg`, com retângulo `fg` em (x,y,rw,rh). */
function img(w: number, h: number, bg: [number, number, number, number], rects: { x: number; y: number; w: number; h: number; c: [number, number, number, number] }[]) {
  const px = new Uint8ClampedArray(w * h * 4);
  for (let p = 0; p < w * h; p++) px.set(bg, p * 4);
  for (const r of rects) for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) px.set(r.c, (y * w + x) * 4);
  return px;
}
const alpha = (px: Uint8ClampedArray, w: number, x: number, y: number) => px[(y * w + x) * 4 + 3];

describe('recorte de produto', () => {
  it('remove fundo branco ligado às bordas e devolve a área do produto', () => {
    const px = img(40, 30, [255, 255, 255, 255], [{ x: 10, y: 5, w: 20, h: 15, c: [20, 20, 20, 255] }]);
    const r = removeUniformBackground(px, 40, 30);
    expect(r.mode).toBe('removed');
    expect(r.box).toEqual({ x: 10, y: 5, w: 20, h: 15 });
    expect(alpha(px, 40, 0, 0)).toBe(0);
    expect(alpha(px, 40, 20, 10)).toBe(255);
  });

  it('parte branca DENTRO do produto não é apagada (não conectada à borda)', () => {
    const px = img(40, 30, [250, 250, 250, 255], [{ x: 10, y: 5, w: 20, h: 15, c: [200, 30, 30, 255] }, { x: 15, y: 9, w: 6, h: 6, c: [250, 250, 250, 255] }]);
    removeUniformBackground(px, 40, 30);
    expect(alpha(px, 40, 17, 11)).toBe(255);
  });

  it('fundo complexo (borda sem cor dominante) fica como está', () => {
    const w = 20, h = 20;
    const px = new Uint8ClampedArray(w * h * 4);
    for (let p = 0; p < w * h; p++) px.set([(p * 37) % 256, (p * 91) % 256, (p * 13) % 256, 255], p * 4);
    const before = px.slice();
    expect(removeUniformBackground(px, w, h)).toEqual({ mode: 'none', box: null });
    expect(px).toEqual(before);
  });

  it('PNG já transparente: só corta margens', () => {
    const px = img(30, 30, [0, 0, 0, 0], [{ x: 3, y: 4, w: 10, h: 12, c: [10, 200, 10, 255] }]);
    expect(removeUniformBackground(px, 30, 30)).toEqual({ mode: 'alpha', box: { x: 3, y: 4, w: 10, h: 12 } });
  });

  it('produto da mesma cor do fundo: não apaga tudo', () => {
    const px = img(30, 30, [255, 255, 255, 255], []);
    expect(removeUniformBackground(px, 30, 30).mode).toBe('none');
  });
});
