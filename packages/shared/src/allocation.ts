/**
 * Rateio pelo método do maior resto: distribui `total` proporcionalmente aos
 * pesos garantindo soma exata. Desempate determinístico pela posição.
 */
export function allocateLargestRemainder(total: bigint, weights: readonly bigint[]): bigint[] {
  if (weights.length === 0) {
    if (total !== 0n) throw new RangeError('Não há itens para ratear o valor');
    return [];
  }
  if (weights.some((w) => w < 0n)) throw new RangeError('Pesos não podem ser negativos');
  const neg = total < 0n;
  const abs = neg ? -total : total;
  const weightSum = weights.reduce((a, b) => a + b, 0n);
  // Sem pesos positivos: divide igualmente.
  const effective = weightSum === 0n ? weights.map(() => 1n) : weights;
  const sum = weightSum === 0n ? BigInt(weights.length) : weightSum;

  const base = effective.map((w) => (abs * w) / sum);
  const remainders = effective.map((w, i) => ({ i, r: (abs * w) % sum }));
  let leftover = abs - base.reduce((a, b) => a + b, 0n);
  remainders.sort((a, b) => (a.r === b.r ? a.i - b.i : a.r > b.r ? -1 : 1));
  for (const { i } of remainders) {
    if (leftover === 0n) break;
    base[i] = base[i]! + 1n;
    leftover -= 1n;
  }
  return neg ? base.map((v) => -v) : base;
}

/** Divide `total` em `n` parcelas iguais com o resto nas primeiras. */
export function splitEvenly(total: bigint, n: number): bigint[] {
  if (!Number.isInteger(n) || n <= 0) throw new RangeError('Número de parcelas inválido');
  return allocateLargestRemainder(
    total,
    Array.from({ length: n }, () => 1n),
  );
}
