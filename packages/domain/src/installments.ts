import { addDays, addMonths, invalid, splitEvenly, type Cents } from '@gct/shared';

export interface InstallmentPlanInput {
  totalCents: Cents;
  count: number;
  firstDueDate: string;
  /** 'monthly' usa mesmo dia do mês; número = intervalo em dias (30/60/90 presets) */
  interval: 'monthly' | number;
}

export interface Installment {
  number: number;
  dueDate: string;
  amountCents: Cents;
}

/** Parcelas somam exatamente o total; centavos residuais vão nas primeiras. */
export function buildInstallments(input: InstallmentPlanInput): Installment[] {
  if (input.totalCents <= 0n) throw invalid('Valor parcelado deve ser positivo.');
  if (!Number.isInteger(input.count) || input.count < 1 || input.count > 48) throw invalid('Parcelas entre 1 e 48.');
  const amounts = splitEvenly(input.totalCents, input.count);
  return amounts.map((amountCents, i) => ({
    number: i + 1,
    amountCents,
    dueDate:
      input.interval === 'monthly' ? addMonths(input.firstDueDate, i) : addDays(input.firstDueDate, i * input.interval),
  }));
}
