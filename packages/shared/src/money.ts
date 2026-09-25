/**
 * Dinheiro em centavos inteiros (bigint). Nunca usar ponto flutuante binário
 * para valores monetários. Na API, valores trafegam como string de inteiros.
 */
export type Cents = bigint;

const CENTS_RE = /^-?\d{1,18}$/;

/** Converte string/number inteiro em centavos, rejeitando frações e notação científica. */
export function toCents(value: string | number | bigint): Cents {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new RangeError('Valor em centavos deve ser inteiro seguro');
    return BigInt(value);
  }
  const trimmed = value.trim();
  if (!CENTS_RE.test(trimmed)) throw new RangeError('Valor em centavos inválido');
  return BigInt(trimmed);
}

export function centsToString(value: Cents): string {
  return value.toString();
}

/**
 * Converte texto digitado em reais ("1.234,56", "1234.56", "1234") para centavos.
 * Aceita no máximo 2 casas decimais; não usa float.
 */
export function parseBRL(input: string): Cents {
  let s = input.trim().replace(/^R\$\s*/, '').replace(/\s/g, '');
  let negative = false;
  if (s.startsWith('-')) {
    negative = true;
    s = s.slice(1);
  }
  if (s === '') throw new RangeError('Valor vazio');
  let intPart: string;
  let fracPart = '';
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma > -1 && lastComma > lastDot) {
    intPart = s.slice(0, lastComma).replace(/\./g, '');
    fracPart = s.slice(lastComma + 1);
  } else if (lastDot > -1 && lastComma === -1 && s.length - lastDot - 1 <= 2 && s.split('.').length === 2) {
    intPart = s.slice(0, lastDot);
    fracPart = s.slice(lastDot + 1);
  } else {
    intPart = s.replace(/[.,]/g, '');
  }
  if (!/^\d+$/.test(intPart || '0') || !/^\d{0,2}$/.test(fracPart)) throw new RangeError('Valor inválido');
  const cents = BigInt(intPart || '0') * 100n + BigInt((fracPart + '00').slice(0, 2));
  return negative ? -cents : cents;
}

/** Formata centavos como BRL pt-BR sem passar por float. */
export function formatBRL(value: Cents | string, opts: { sign?: boolean } = {}): string {
  const v = typeof value === 'string' ? toCents(value) : value;
  const neg = v < 0n;
  const abs = neg ? -v : v;
  const reais = abs / 100n;
  const cents = abs % 100n;
  const intStr = reais.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const body = `R$ ${intStr},${cents.toString().padStart(2, '0')}`;
  if (neg) return `-${body}`;
  return opts.sign && v > 0n ? `+${body}` : body;
}

/** Divisão inteira com arredondamento half-up (afastando de zero no meio). */
export function divRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) throw new RangeError('Divisão por zero');
  const neg = numerator < 0n !== denominator < 0n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  const q = n / d;
  const r = n % d;
  const rounded = r * 2n >= d ? q + 1n : q;
  return neg ? -rounded : rounded;
}

/** Aplica basis points (10000 = 100%) com half-up. */
export function applyBps(amount: Cents, bps: number): Cents {
  if (!Number.isInteger(bps)) throw new RangeError('bps deve ser inteiro');
  return divRoundHalfUp(amount * BigInt(bps), 10000n);
}

export function sumCents(values: Iterable<Cents>): Cents {
  let total = 0n;
  for (const v of values) total += v;
  return total;
}

export function minCents(a: Cents, b: Cents): Cents {
  return a < b ? a : b;
}

export function maxCents(a: Cents, b: Cents): Cents {
  return a > b ? a : b;
}

export function absCents(a: Cents): Cents {
  return a < 0n ? -a : a;
}

/** Margem em basis points: result/revenue*10000, ou null quando não há base. */
export function ratioBps(numerator: Cents, denominator: Cents): number | null {
  if (denominator <= 0n) return null;
  return Number(divRoundHalfUp(numerator * 10000n, denominator));
}

export function formatBps(bps: number | null): string {
  if (bps === null) return 'sem base';
  const neg = bps < 0;
  const abs = Math.abs(bps);
  const int = Math.floor(abs / 100);
  const frac = abs % 100;
  return `${neg ? '-' : ''}${int},${frac.toString().padStart(2, '0')}%`;
}
