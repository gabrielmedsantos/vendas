import { describe, expect, it } from 'vitest';
import { applyOrder, moveItem, cardPrice, contrastRatio, formatPercentBps, paginateFlyer, paletteFromColors, parsePercentBps, readableOn, splitPrice, BRAND_DEFAULTS } from '../src';

describe('encarte', () => {
  it('divide o preço em reais e centavos sem float', () => {
    expect(splitPrice('2999')).toEqual({ int: '29', dec: '99' });
    expect(splitPrice(159990n)).toEqual({ int: '1.599', dec: '90' });
    expect(splitPrice('5')).toEqual({ int: '0', dec: '05' });
  });

  it('preço no cartão com acréscimo em basis points (14,99 + 11,14% = 16,66)', () => {
    expect(cardPrice('1499', 1114)).toBe(1666n);
    expect(cardPrice('2999', 0)).toBe(2999n);
    expect(parsePercentBps('11,14')).toBe(1114);
    expect(parsePercentBps('10')).toBe(1000);
    expect(parsePercentBps('5,5%')).toBe(550);
    expect(parsePercentBps('abc')).toBeNull();
    expect(formatPercentBps(1114)).toBe('11,14');
    expect(formatPercentBps(550)).toBe('5,5');
    expect(formatPercentBps(1000)).toBe('10');
  });

  it('pagina: 1ª página com 2 destaques + 3; depois 9 por página', () => {
    const items = Array.from({ length: 16 }, (_, i) => i);
    const pages = paginateFlyer(items, (i) => i === 7);
    expect(pages[0]).toEqual({ first: true, featured: [7], items: [0, 1, 2] });
    expect(pages[1]!.items).toEqual([3, 4, 5, 6, 8, 9, 10, 11, 12]);
    expect(pages[2]!.items).toEqual([13, 14, 15]);
    expect(paginateFlyer([1, 2, 3])).toEqual([{ first: true, featured: [1, 2], items: [3] }]);
    expect(paginateFlyer([])).toEqual([]);
  });

  it('paleta da logo: fundo escuro com texto branco legível; título claro; ignora cinzas', () => {
    const p = paletteFromColors(['#ffffff', '#1e40af', '#facc15', '#dc2626', '#777777']);
    expect(contrastRatio(p.primary, '#ffffff')).toBeGreaterThanOrEqual(4.5);
    expect(p.accent).toBe('#facc15');
    expect(p.secondary).toBe('#dc2626');
    expect(paletteFromColors(['#ffffff', '#000000', '#888888'])).toEqual(BRAND_DEFAULTS);
    const one = paletteFromColors(['#22c55e']);
    expect(contrastRatio(one.primary, '#ffffff')).toBeGreaterThanOrEqual(4.5);
    expect(readableOn('#ffd400')).toBe('#111111');
    expect(readableOn('#1d3fbf')).toBe('#ffffff');
  });

  it('ordem escolhida: salva primeiro, novos no fim, removidos somem; mover item', () => {
    expect(applyOrder(['a', 'b', 'c', 'd'], ['c', 'x', 'a'])).toEqual(['c', 'a', 'b', 'd']);
    expect(applyOrder(['a', 'b'], undefined)).toEqual(['a', 'b']);
    expect(moveItem(['a', 'b', 'c', 'd'], 3, 0)).toEqual(['d', 'a', 'b', 'c']);
    expect(moveItem(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a']);
    expect(moveItem(['a', 'b'], 5, 0)).toEqual(['a', 'b']);
  });
});
