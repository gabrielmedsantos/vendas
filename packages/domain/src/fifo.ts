import { AppError, type Cents } from '@gct/shared';

export interface LotState {
  id: string;
  remainingQty: number;
  /** custo total remanescente do lote (centavos); custo unitário pode não ser inteiro */
  remainingCostCents: Cents;
}

export interface LotConsumption {
  lotId: string;
  quantity: number;
  costCents: Cents;
}

/**
 * Consome lotes em ordem FIFO (a ordem de `lots` já deve ser a canônica:
 * recebimento mais antigo primeiro). Custo proporcional ao remanescente:
 * ao zerar o lote, leva todo o custo restante (sem centavos órfãos).
 */
export function consumeFifo(lots: LotState[], quantity: number): LotConsumption[] {
  if (!Number.isInteger(quantity) || quantity <= 0) throw new AppError('validation_failed', 'Quantidade inválida.');
  const out: LotConsumption[] = [];
  let need = quantity;
  for (const lot of lots) {
    if (need === 0) break;
    if (lot.remainingQty <= 0) continue;
    const take = Math.min(need, lot.remainingQty);
    const cost =
      take === lot.remainingQty
        ? lot.remainingCostCents
        : (lot.remainingCostCents * BigInt(take)) / BigInt(lot.remainingQty);
    out.push({ lotId: lot.id, quantity: take, costCents: cost });
    need -= take;
  }
  if (need > 0) throw new AppError('insufficient_stock', 'Estoque insuficiente para a quantidade solicitada.');
  return out;
}

/**
 * Custo histórico proporcional para devolução de `qty` de uma saída que
 * consumiu `originalQty` com custo `originalCost`, já tendo devolvido
 * `returnedQty` / `returnedCost`. Última devolução leva o resto exato.
 */
export function proportionalShare(
  originalQty: number,
  originalCents: Cents,
  alreadyQty: number,
  alreadyCents: Cents,
  qty: number,
): Cents {
  if (qty <= 0 || alreadyQty + qty > originalQty)
    throw new AppError('validation_failed', 'Quantidade maior que o saldo devolvível.');
  if (alreadyQty + qty === originalQty) return originalCents - alreadyCents;
  return (originalCents * BigInt(qty)) / BigInt(originalQty);
}
