import { invalid, type Cents } from '@gct/shared';

export type TitleStatus = 'open' | 'partially_settled' | 'settled' | 'canceled';

export function titleStatus(originalCents: Cents, balanceCents: Cents, canceled = false): TitleStatus {
  if (canceled) return 'canceled';
  if (balanceCents === 0n) return 'settled';
  if (balanceCents < originalCents) return 'partially_settled';
  return 'open';
}

/** "Atrasado" é derivado: saldo positivo e vencimento antes de hoje (fuso da empresa). */
export function isOverdue(balanceCents: Cents, dueDate: string, todayLocal: string, canceled = false): boolean {
  return !canceled && balanceCents > 0n && dueDate < todayLocal;
}

export function assertAllocationWithinBalance(balanceCents: Cents, allocationCents: Cents): void {
  if (allocationCents <= 0n) throw invalid('Valor de baixa deve ser positivo.');
  if (allocationCents > balanceCents) throw invalid('Valor excede o saldo em aberto do título.');
}

export interface CardSettlement {
  grossCents: Cents;
  feeCents: Cents;
  netCents: Cents;
}

/**
 * Liquidação com taxa: título é baixado pelo bruto; banco recebe líquido;
 * taxa vira despesa de recebimento (não some da conta).
 */
export function splitCardSettlement(grossCents: Cents, feeCents: Cents): CardSettlement {
  if (grossCents <= 0n) throw invalid('Valor bruto deve ser positivo.');
  if (feeCents < 0n || feeCents > grossCents) throw invalid('Taxa inválida.');
  return { grossCents, feeCents, netCents: grossCents - feeCents };
}
