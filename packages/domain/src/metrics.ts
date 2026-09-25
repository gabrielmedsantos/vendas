import { divRoundHalfUp, ratioBps, type Cents } from '@gct/shared';

/** Fatos do período, calculados pelo serviço de métricas a partir dos livros. */
export interface PeriodFacts {
  /** receita comercial das vendas entregues/confirmadas no período */
  salesRevenueCents: Cents;
  /** valores comerciais devolvidos/estornados no período */
  returnsRevenueCents: Cents;
  /** custo histórico das saídas por venda */
  cogsCents: Cents;
  /** custo histórico das devoluções reconhecidas */
  returnsCogsCents: Cents;
  /** taxas de recebimento */
  paymentFeesCents: Cents;
  /** comissões e custos de canal */
  channelCostsCents: Cents;
  /** despesas operacionais por competência (inclui perdas de inventário) */
  operatingExpensesCents: Cents;
  salesCount: number;
  unitsSold: number;
}

export interface ManagementResult {
  netRevenueCents: Cents;
  cogsCents: Cents;
  grossProfitCents: Cents;
  variableCostsCents: Cents;
  contributionCents: Cents;
  operatingExpensesCents: Cents;
  operatingResultCents: Cents;
  grossMarginBps: number | null;
  operatingMarginBps: number | null;
  averageTicketCents: Cents | null;
  returnOnCostBps: number | null;
}

/**
 * Resultado gerencial (doc 02 §3). Não é lucro líquido contábil.
 */
export function computeManagementResult(f: PeriodFacts): ManagementResult {
  const netRevenue = f.salesRevenueCents - f.returnsRevenueCents;
  const cogs = f.cogsCents - f.returnsCogsCents;
  const gross = netRevenue - cogs;
  const variable = f.paymentFeesCents + f.channelCostsCents;
  const contribution = gross - variable;
  const operating = contribution - f.operatingExpensesCents;
  return {
    netRevenueCents: netRevenue,
    cogsCents: cogs,
    grossProfitCents: gross,
    variableCostsCents: variable,
    contributionCents: contribution,
    operatingExpensesCents: f.operatingExpensesCents,
    operatingResultCents: operating,
    grossMarginBps: ratioBps(gross, netRevenue),
    operatingMarginBps: ratioBps(operating, netRevenue),
    averageTicketCents: f.salesCount > 0 ? divRoundHalfUp(f.salesRevenueCents, BigInt(f.salesCount)) : null,
    returnOnCostBps: ratioBps(gross, cogs),
  };
}

/** Variação percentual em bps vs período anterior; null sem base. */
export function growthBps(current: Cents, previous: Cents): number | null {
  if (previous <= 0n) return null;
  return Number(divRoundHalfUp((current - previous) * 10000n, previous));
}
