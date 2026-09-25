import { allocateLargestRemainder, invalid, sumCents, type Cents } from '@gct/shared';

export interface PurchaseLineInput {
  quantity: number;
  unitCostCents: Cents;
  discountCents?: Cents;
}

export interface PurchaseLineComputed {
  quantity: number;
  unitCostCents: Cents;
  netCents: Cents;
  /** rateio de frete e custos diretamente atribuíveis */
  extraCostShareCents: Cents;
  /** rateio do desconto geral */
  discountShareCents: Cents;
  /** custo de aquisição total da linha (entra no estoque) */
  landedCostCents: Cents;
}

export interface PurchaseTotals {
  lines: PurchaseLineComputed[];
  itemsCents: Cents;
  discountCents: Cents;
  extraCostsCents: Cents;
  /** valor devido ao fornecedor (itens − desconto + frete/custos cobrados pelo fornecedor) */
  totalCents: Cents;
}

/**
 * Custo de aquisição = preço acordado − desconto + frete + custos diretamente
 * atribuíveis. Rateio proporcional ao valor dos itens (maior resto).
 */
export function computePurchaseTotals(
  lines: PurchaseLineInput[],
  orderDiscountCents: Cents = 0n,
  extraCostsCents: Cents = 0n,
): PurchaseTotals {
  if (lines.length === 0) throw invalid('Adicione ao menos um item à compra.');
  if (orderDiscountCents < 0n || extraCostsCents < 0n) throw invalid('Valores não podem ser negativos.');
  const nets = lines.map((l, i) => {
    if (!Number.isInteger(l.quantity) || l.quantity <= 0) throw invalid(`Quantidade inválida no item ${i + 1}.`);
    if (l.unitCostCents < 0n) throw invalid(`Custo inválido no item ${i + 1}.`);
    const gross = l.unitCostCents * BigInt(l.quantity);
    const d = l.discountCents ?? 0n;
    if (d < 0n || d > gross) throw invalid(`Desconto inválido no item ${i + 1}.`);
    return gross - d;
  });
  const itemsNet = sumCents(nets);
  if (orderDiscountCents > itemsNet) throw invalid('Desconto maior que o valor dos itens.');
  const disc = allocateLargestRemainder(orderDiscountCents, nets);
  const extra = allocateLargestRemainder(extraCostsCents, nets);
  const computed = lines.map((l, i) => ({
    quantity: l.quantity,
    unitCostCents: l.unitCostCents,
    netCents: nets[i]!,
    discountShareCents: disc[i]!,
    extraCostShareCents: extra[i]!,
    landedCostCents: nets[i]! - disc[i]! + extra[i]!,
  }));
  const lineDiscounts = sumCents(lines.map((l) => l.discountCents ?? 0n));
  return {
    lines: computed,
    itemsCents: sumCents(lines.map((l) => l.unitCostCents * BigInt(l.quantity))),
    discountCents: lineDiscounts + orderDiscountCents,
    extraCostsCents,
    totalCents: itemsNet - orderDiscountCents + extraCostsCents,
  };
}

/** Custo de uma parte recebida de uma linha (recebimento parcial). */
export function receivedCostShare(
  lineQty: number,
  lineLandedCents: Cents,
  alreadyReceivedQty: number,
  alreadyReceivedCents: Cents,
  qty: number,
): Cents {
  if (qty <= 0 || alreadyReceivedQty + qty > lineQty) throw invalid('Quantidade recebida excede o pendente.');
  if (alreadyReceivedQty + qty === lineQty) return lineLandedCents - alreadyReceivedCents;
  return (lineLandedCents * BigInt(qty)) / BigInt(lineQty);
}
