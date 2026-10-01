import { describe, expect, it } from 'vitest';
import { integerInWords, moneyInWords } from '../src';

describe('valor por extenso', () => {
  it('números', () => {
    const cases: [bigint, string][] = [
      [1n, 'um'], [15n, 'quinze'], [21n, 'vinte e um'], [100n, 'cem'], [101n, 'cento e um'], [110n, 'cento e dez'], [999n, 'novecentos e noventa e nove'],
      [1000n, 'mil'], [1001n, 'mil e um'], [1100n, 'mil e cem'], [1200n, 'mil e duzentos'], [1250n, 'mil duzentos e cinquenta'], [2005n, 'dois mil e cinco'],
      [21000n, 'vinte e um mil'], [100000n, 'cem mil'], [1000000n, 'um milhão'], [2500000n, 'dois milhões e quinhentos mil'], [1100000n, 'um milhão e cem mil'], [1234000n, 'um milhão duzentos e trinta e quatro mil'], [1000001n, 'um milhão e um'],
    ];
    for (const [n, w] of cases) expect(integerInWords(n), String(n)).toBe(w);
  });
  it('dinheiro', () => {
    expect(moneyInWords(6000n)).toBe('sessenta reais');
    expect(moneyInWords(100n)).toBe('um real');
    expect(moneyInWords(1n)).toBe('um centavo');
    expect(moneyInWords(123456n)).toBe('mil duzentos e trinta e quatro reais e cinquenta e seis centavos');
    expect(moneyInWords(189900n)).toBe('mil oitocentos e noventa e nove reais');
    expect(moneyInWords(100000000n)).toBe('um milhão de reais');
    expect(moneyInWords(0n)).toBe('zero real');
  });
});
