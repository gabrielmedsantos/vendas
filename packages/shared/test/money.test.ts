import { describe, expect, it } from 'vitest';
import {
  allocateLargestRemainder,
  applyBps,
  csvSafeCell,
  divRoundHalfUp,
  formatBRL,
  formatBps,
  localRangeToUtc,
  parseBRL,
  ratioBps,
  splitEvenly,
  toCents,
  addMonths,
  effectivePermissions,
} from '../src';

describe('money', () => {
  it('parses BRL input without floats', () => {
    expect(parseBRL('1.234,56')).toBe(123456n);
    expect(parseBRL('R$ 4.000,00')).toBe(400000n);
    expect(parseBRL('1234.5')).toBe(123450n);
    expect(parseBRL('2500')).toBe(250000n);
    expect(parseBRL('0,1')).toBe(10n);
    expect(() => parseBRL('1,234')).toThrow();
    expect(() => parseBRL('abc')).toThrow();
  });
  it('formats BRL', () => {
    expect(formatBRL(123456n)).toBe('R$ 1.234,56');
    expect(formatBRL(-50n)).toBe('-R$ 0,50');
    expect(formatBRL('400000')).toBe('R$ 4.000,00');
  });
  it('rejects fractional cents strings', () => {
    expect(() => toCents('10.5')).toThrow();
    expect(() => toCents(1.5)).toThrow();
    expect(toCents('-300')).toBe(-300n);
  });
  it('rounds half-up', () => {
    expect(divRoundHalfUp(5n, 2n)).toBe(3n);
    expect(divRoundHalfUp(-5n, 2n)).toBe(-3n);
    expect(divRoundHalfUp(4n, 3n)).toBe(1n);
    expect(applyBps(100000n, 299)).toBe(2990n);
    expect(applyBps(333n, 5000)).toBe(167n);
  });
  it('ratio bps returns null without base', () => {
    expect(ratioBps(100n, 0n)).toBeNull();
    expect(ratioBps(100000n, 400000n)).toBe(2500);
    expect(formatBps(2500)).toBe('25,00%');
    expect(formatBps(null)).toBe('sem base');
  });
});

describe('allocation', () => {
  it('largest remainder sums exactly', () => {
    const r = allocateLargestRemainder(100n, [1n, 1n, 1n]);
    expect(r).toEqual([34n, 33n, 33n]);
    expect(r.reduce((a, b) => a + b, 0n)).toBe(100n);
  });
  it('proportional with remainder tie-break by position', () => {
    expect(allocateLargestRemainder(1000n, [300n, 700n])).toEqual([300n, 700n]);
    expect(allocateLargestRemainder(10n, [1n, 2n])).toEqual([3n, 7n]);
    expect(allocateLargestRemainder(-10n, [1n, 1n, 1n])).toEqual([-4n, -3n, -3n]);
  });
  it('zero weights split evenly', () => {
    expect(allocateLargestRemainder(5n, [0n, 0n])).toEqual([3n, 2n]);
  });
  it('split evenly', () => {
    expect(splitEvenly(1000n, 3)).toEqual([334n, 333n, 333n]);
  });
});

describe('dates', () => {
  it('converts local range to UTC using company timezone', () => {
    const { start, end } = localRangeToUtc('2026-09-01', '2026-09-30', 'America/Sao_Paulo');
    expect(start.toISOString()).toBe('2026-09-01T03:00:00.000Z');
    expect(end.toISOString()).toBe('2026-10-01T03:00:00.000Z');
  });
  it('adds months clamping the day', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
  });
});

describe('csv', () => {
  it('neutralizes formulas (T-019)', () => {
    expect(csvSafeCell('=HYPERLINK("http://x","y")')).toBe(`"'=HYPERLINK(""http://x"",""y"")"`);
    expect(csvSafeCell('+5511')).toBe("'+5511");
    expect(csvSafeCell('Texto normal')).toBe('Texto normal');
  });
});

describe('permissions', () => {
  it('seller cannot see costs by default', () => {
    expect(effectivePermissions('seller').has('costs.view')).toBe(false);
    expect(effectivePermissions('seller', ['costs.view']).has('costs.view')).toBe(true);
    expect(effectivePermissions('owner', [], ['costs.view']).has('costs.view')).toBe(true);
  });
});

describe('preço pela margem', () => {
  it('custo 30, margem 50% → 60; margem estimada volta 50%', async () => {
    const { priceForMarginBps, marginBpsOf } = await import('../src');
    expect(priceForMarginBps(3000n, 5000)).toBe(6000n);
    expect(marginBpsOf(6000n, 3000n)).toBe(5000);
    // Arredonda para cima: custo 10, margem 33,33% → 15,00 (14,9993…)
    expect(priceForMarginBps(1000n, 3333)).toBe(1500n);
    expect(marginBpsOf(1500n, 1000n)).toBeGreaterThanOrEqual(3333);
    expect(priceForMarginBps(1000n, 10000)).toBeNull();
    expect(marginBpsOf(0n, 100n)).toBeNull();
    expect(marginBpsOf(1000n, 1500n)).toBe(-5000);
  });
});
