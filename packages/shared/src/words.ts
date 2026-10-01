/** Valor por extenso em português (recibos): 123456 centavos → "mil duzentos e trinta e quatro reais e cinquenta e seis centavos". */

const UNITS = ['zero', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove', 'dez', 'onze', 'doze', 'treze', 'quatorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove'];
const TENS = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
const HUNDREDS = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos', 'setecentos', 'oitocentos', 'novecentos'];

/** 0 < n < 1000. */
function upTo999(n: number): string {
  if (n === 100) return 'cem';
  const parts: string[] = [];
  const h = Math.floor(n / 100);
  const rest = n % 100;
  if (h) parts.push(HUNDREDS[h]!);
  if (rest) {
    if (rest < 20) parts.push(UNITS[rest]!);
    else parts.push(TENS[Math.floor(rest / 10)]! + (rest % 10 ? ` e ${UNITS[rest % 10]}` : ''));
  }
  return parts.join(' e ');
}

const SCALES: [bigint, string, string][] = [
  [1_000_000_000n, 'bilhão', 'bilhões'],
  [1_000_000n, 'milhão', 'milhões'],
  [1_000n, 'mil', 'mil'],
];

export function integerInWords(value: bigint): string {
  if (value < 0n) return `menos ${integerInWords(-value)}`;
  if (value === 0n) return 'zero';
  if (value >= 1_000_000_000_000n) return value.toString();
  const groups: { n: number; scale?: [string, string] }[] = [];
  let rest = value;
  for (const [size, one, many] of SCALES) {
    const g = Number(rest / size);
    rest %= size;
    if (g) groups.push({ n: g, scale: [one, many] });
  }
  if (rest) groups.push({ n: Number(rest) });
  return groups
    .map((g, i) => {
      const word = g.scale ? (g.scale[0] === 'mil' ? (g.n === 1 ? 'mil' : `${upTo999(g.n)} mil`) : `${upTo999(g.n)} ${g.n === 1 ? g.scale[0] : g.scale[1]}`) : upTo999(g.n);
      // "e" antes do último grupo quando ele é menor que 100 ou centena redonda (mil e cem, dois mil e cinco, dois milhões e quinhentos mil).
      const last = i === groups.length - 1 && i > 0;
      const joinE = last && (g.n < 100 || g.n % 100 === 0);
      return i === 0 ? word : `${joinE ? 'e ' : ''}${word}`;
    })
    .join(' ');
}

export function moneyInWords(cents: bigint): string {
  const neg = cents < 0n;
  const abs = neg ? -cents : cents;
  const reais = abs / 100n;
  const cent = abs % 100n;
  const parts: string[] = [];
  if (reais > 0n) {
    const exactMillions = reais >= 1_000_000n && reais % 1_000_000n === 0n;
    parts.push(`${integerInWords(reais)}${exactMillions ? ' de' : ''} ${reais === 1n ? 'real' : 'reais'}`);
  }
  if (cent > 0n) parts.push(`${integerInWords(cent)} ${cent === 1n ? 'centavo' : 'centavos'}`);
  const text = parts.length ? parts.join(' e ') : 'zero real';
  return neg ? `menos ${text}` : text;
}
