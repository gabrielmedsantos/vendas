import { AppError, allocateLargestRemainder, invalid, sumCents, type Cents } from '@gct/shared';

export interface SaleLineInput {
  quantity: number;
  unitPriceCents: Cents;
  /** desconto direto na linha (valor total da linha, não unitário) */
  discountCents?: Cents;
}

export interface SaleLineComputed {
  quantity: number;
  unitPriceCents: Cents;
  grossCents: Cents;
  lineDiscountCents: Cents;
  /** parcela rateada do desconto geral */
  orderDiscountShareCents: Cents;
  /** parcela rateada do frete cobrado */
  shippingShareCents: Cents;
  /** total comercial final da linha = bruto − descontos + frete */
  totalCents: Cents;
}

export interface SaleTotals {
  lines: SaleLineComputed[];
  subtotalCents: Cents;
  discountCents: Cents;
  shippingCents: Cents;
  totalCents: Cents;
}

/**
 * Subtotal = Σ qtd × preço. Total = subtotal − descontos + frete cobrado.
 * Desconto geral e frete são rateados entre linhas (maior resto) para
 * permitir devolução parcial pelos valores históricos.
 */
export function computeSaleTotals(
  lines: SaleLineInput[],
  orderDiscountCents: Cents = 0n,
  shippingCents: Cents = 0n,
): SaleTotals {
  if (lines.length === 0) throw invalid('Adicione ao menos um item.');
  if (orderDiscountCents < 0n || shippingCents < 0n) throw invalid('Desconto e frete não podem ser negativos.');
  const base = lines.map((l, i) => {
    if (!Number.isInteger(l.quantity) || l.quantity <= 0) throw invalid(`Quantidade inválida no item ${i + 1}.`);
    if (l.unitPriceCents < 0n) throw invalid(`Preço inválido no item ${i + 1}.`);
    const gross = l.unitPriceCents * BigInt(l.quantity);
    const disc = l.discountCents ?? 0n;
    if (disc < 0n || disc > gross) throw invalid(`Desconto inválido no item ${i + 1}.`);
    return { ...l, gross, disc, net: gross - disc };
  });
  const netSum = sumCents(base.map((b) => b.net));
  if (orderDiscountCents > netSum) throw invalid('Desconto maior que o valor dos itens.');
  const discShares = allocateLargestRemainder(orderDiscountCents, base.map((b) => b.net));
  const shipShares = allocateLargestRemainder(shippingCents, base.map((b) => b.net));
  const computed: SaleLineComputed[] = base.map((b, i) => ({
    quantity: b.quantity,
    unitPriceCents: b.unitPriceCents,
    grossCents: b.gross,
    lineDiscountCents: b.disc,
    orderDiscountShareCents: discShares[i]!,
    shippingShareCents: shipShares[i]!,
    totalCents: b.net - discShares[i]! + shipShares[i]!,
  }));
  const subtotal = sumCents(base.map((b) => b.gross));
  const discount = sumCents(base.map((b) => b.disc)) + orderDiscountCents;
  return {
    lines: computed,
    subtotalCents: subtotal,
    discountCents: discount,
    shippingCents,
    totalCents: subtotal - discount + shippingCents,
  };
}

export type PaymentKind =
  | 'cash'
  | 'pix'
  | 'debit'
  | 'credit'
  | 'bank_transfer'
  | 'store_credit'
  | 'installment'
  | 'trade_offset';

export interface PaymentPart {
  kind: PaymentKind;
  amountCents: Cents;
}

/** Pagamentos, créditos e compensações precisam compor exatamente o total. */
export function assertPaymentsCoverTotal(total: Cents, parts: PaymentPart[]): void {
  if (parts.some((p) => p.amountCents <= 0n)) throw invalid('Cada forma de pagamento precisa de valor positivo.');
  const sum = sumCents(parts.map((p) => p.amountCents));
  if (sum !== total) {
    throw new AppError(
      'validation_failed',
      `Pagamentos somam ${sum} centavos, mas o total é ${total} centavos. Ajuste antes de confirmar.`,
    );
  }
}

/** Margem projetada/realizada de uma linha (quando há permissão para ver custo). */
export function grossProfit(revenue: Cents, cost: Cents): Cents {
  return revenue - cost;
}

/** Verifica limite de desconto (bps sobre bruto). */
export function discountExceedsLimit(subtotal: Cents, discount: Cents, limitBps: number): boolean {
  if (subtotal <= 0n) return false;
  return discount * 10000n > subtotal * BigInt(limitBps);
}
