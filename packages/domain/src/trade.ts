import { invalid, minCents, sumCents, type Cents } from '@gct/shared';

export type DifferencePolicy = 'receive' | 'pay' | 'store_credit' | 'none';

export interface TradeComputation {
  /** S: total comercial dos itens entregues ao cliente */
  saleTotalCents: Cents;
  /** P: valor acordado dos itens recebidos */
  purchaseTotalCents: Cents;
  /** compensação não monetária = min(S, P) */
  offsetCents: Cents;
  /** D = S − P */
  differenceCents: Cents;
  direction: 'customer_pays' | 'company_pays' | 'even';
  /** valor absoluto da diferença */
  differenceAbsCents: Cents;
}

/**
 * Troca = venda (S) + compra (P) + compensação min(S,P).
 * D > 0: cliente deve D; D < 0: empresa deve −D; D = 0: sem dinheiro.
 */
export function computeTrade(saleTotalCents: Cents, valuations: Cents[]): TradeComputation {
  if (saleTotalCents < 0n) throw invalid('Total de saída inválido.');
  if (valuations.length === 0) throw invalid('Informe ao menos um item recebido do cliente.');
  if (valuations.some((v) => v < 0n)) throw invalid('Avaliação não pode ser negativa.');
  const purchaseTotalCents = sumCents(valuations);
  const differenceCents = saleTotalCents - purchaseTotalCents;
  return {
    saleTotalCents,
    purchaseTotalCents,
    offsetCents: minCents(saleTotalCents, purchaseTotalCents),
    differenceCents,
    direction: differenceCents > 0n ? 'customer_pays' : differenceCents < 0n ? 'company_pays' : 'even',
    differenceAbsCents: differenceCents < 0n ? -differenceCents : differenceCents,
  };
}

/** Valida que a política escolhida é coerente com o sentido da diferença. */
export function assertDifferencePolicy(t: TradeComputation, policy: DifferencePolicy): void {
  if (t.direction === 'even' && policy !== 'none') throw invalid('Troca sem diferença não gera cobrança nem pagamento.');
  if (t.direction === 'customer_pays' && policy !== 'receive')
    throw invalid('Cliente deve a diferença: registre o recebimento ou parcelamento.');
  if (t.direction === 'company_pays' && policy !== 'pay' && policy !== 'store_credit')
    throw invalid('Empresa deve a diferença: escolha pagar ao cliente ou gerar crédito da loja.');
}

export function describeTradeDirection(t: TradeComputation): string {
  if (t.direction === 'even') return 'Sem diferença: nenhum pagamento.';
  if (t.direction === 'customer_pays') return 'Cliente paga a diferença à empresa.';
  return 'Empresa paga a diferença ao cliente.';
}
