import { describe, expect, it } from 'vitest';
import {
  assertDifferencePolicy,
  assertPaymentsCoverTotal,
  buildInstallments,
  computeManagementResult,
  computePurchaseTotals,
  computeSaleTotals,
  computeTrade,
  consumeFifo,
  proportionalShare,
  receivedCostShare,
  splitCardSettlement,
  titleStatus,
  isOverdue,
} from '../src';

describe('sale totals', () => {
  it('distributes order discount and shipping across lines', () => {
    const t = computeSaleTotals(
      [
        { quantity: 1, unitPriceCents: 100000n },
        { quantity: 2, unitPriceCents: 50000n },
      ],
      1001n,
      500n,
    );
    expect(t.subtotalCents).toBe(200000n);
    expect(t.totalCents).toBe(200000n - 1001n + 500n);
    expect(t.lines.reduce((a, l) => a + l.totalCents, 0n)).toBe(t.totalCents);
  });
  it('payments must match total exactly', () => {
    expect(() => assertPaymentsCoverTotal(1000n, [{ kind: 'pix', amountCents: 999n }])).toThrow();
    expect(() =>
      assertPaymentsCoverTotal(1000n, [
        { kind: 'pix', amountCents: 400n },
        { kind: 'installment', amountCents: 600n },
      ]),
    ).not.toThrow();
  });
  it('down payment + installments sum exactly', () => {
    const inst = buildInstallments({ totalCents: 100000n, count: 3, firstDueDate: '2026-10-10', interval: 30 });
    expect(inst.map((i) => i.amountCents)).toEqual([33334n, 33333n, 33333n]);
    expect(inst.map((i) => i.dueDate)).toEqual(['2026-10-10', '2026-11-09', '2026-12-09']);
  });
});

describe('trade math (doc 02 §4)', () => {
  it('Example A: customer pays difference', () => {
    const t = computeTrade(400000n, [150000n]);
    expect(t.offsetCents).toBe(150000n);
    expect(t.differenceCents).toBe(250000n);
    expect(t.direction).toBe('customer_pays');
    expect(() => assertDifferencePolicy(t, 'pay')).toThrow();
    expect(() => assertDifferencePolicy(t, 'receive')).not.toThrow();
  });
  it('Example B: company pays difference', () => {
    const t = computeTrade(200000n, [250000n]);
    expect(t.offsetCents).toBe(200000n);
    expect(t.differenceAbsCents).toBe(50000n);
    expect(t.direction).toBe('company_pays');
    expect(() => assertDifferencePolicy(t, 'store_credit')).not.toThrow();
  });
  it('Example C: even trade', () => {
    const t = computeTrade(180000n, [100000n, 80000n]);
    expect(t.offsetCents).toBe(180000n);
    expect(t.direction).toBe('even');
    expect(() => assertDifferencePolicy(t, 'none')).not.toThrow();
  });
});

describe('fifo', () => {
  it('consumes oldest lots first and carries exact remaining cost', () => {
    const c = consumeFifo(
      [
        { id: 'a', remainingQty: 2, remainingCostCents: 1001n },
        { id: 'b', remainingQty: 5, remainingCostCents: 5000n },
      ],
      3,
    );
    expect(c).toEqual([
      { lotId: 'a', quantity: 2, costCents: 1001n },
      { lotId: 'b', quantity: 1, costCents: 1000n },
    ]);
  });
  it('rejects insufficient stock', () => {
    expect(() => consumeFifo([{ id: 'a', remainingQty: 1, remainingCostCents: 10n }], 2)).toThrow(/insuficiente/);
  });
  it('proportional return share closes exactly on the last return', () => {
    const first = proportionalShare(3, 1000n, 0, 0n, 1);
    expect(first).toBe(333n);
    const second = proportionalShare(3, 1000n, 1, first, 2);
    expect(first + second).toBe(1000n);
  });
});

describe('purchase', () => {
  it('landed cost includes freight allocated proportionally', () => {
    const p = computePurchaseTotals(
      [
        { quantity: 1, unitCostCents: 30000n },
        { quantity: 1, unitCostCents: 70000n },
      ],
      0n,
      1001n,
    );
    expect(p.lines.map((l) => l.landedCostCents)).toEqual([30300n, 70701n]);
    expect(p.totalCents).toBe(101001n);
  });
  it('partial receipts close cost exactly', () => {
    const a = receivedCostShare(5, 1000n, 0, 0n, 2);
    const b = receivedCostShare(5, 1000n, 2, a, 3);
    expect(a + b).toBe(1000n);
    expect(() => receivedCostShare(5, 1000n, 5, 1000n, 1)).toThrow();
  });
});

describe('titles & settlements', () => {
  it('T-012: partial receipt leaves balance', () => {
    expect(titleStatus(25000n, 15000n)).toBe('partially_settled');
    expect(titleStatus(25000n, 0n)).toBe('settled');
  });
  it('overdue is derived', () => {
    expect(isOverdue(1n, '2026-09-01', '2026-09-02')).toBe(true);
    expect(isOverdue(0n, '2026-09-01', '2026-09-02')).toBe(false);
  });
  it('T-013: card fee split', () => {
    expect(splitCardSettlement(100000n, 3000n)).toEqual({ grossCents: 100000n, feeCents: 3000n, netCents: 97000n });
  });
});

describe('management result', () => {
  it('computes margins and "sem base"', () => {
    const r = computeManagementResult({
      salesRevenueCents: 400000n,
      returnsRevenueCents: 0n,
      cogsCents: 300000n,
      returnsCogsCents: 0n,
      paymentFeesCents: 0n,
      channelCostsCents: 0n,
      operatingExpensesCents: 0n,
      salesCount: 1,
      unitsSold: 1,
    });
    expect(r.grossProfitCents).toBe(100000n);
    expect(r.grossMarginBps).toBe(2500);
    const empty = computeManagementResult({
      salesRevenueCents: 0n, returnsRevenueCents: 0n, cogsCents: 0n, returnsCogsCents: 0n,
      paymentFeesCents: 0n, channelCostsCents: 0n, operatingExpensesCents: 0n, salesCount: 0, unitsSold: 0,
    });
    expect(empty.grossMarginBps).toBeNull();
    expect(empty.averageTicketCents).toBeNull();
  });
});
