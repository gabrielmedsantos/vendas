'use client';

import { Plus, Trash2 } from 'lucide-react';
import { addDays, applyBps, formatBRL } from '@gct/shared';
import { Button, Field, Input, MoneyInput, Select } from '@/components/ui';
import { usePaymentMethods } from './hooks';

export interface PaymentDraft {
  key: string;
  kind: string;
  paymentMethodId: string;
  amountCents: string;
  installments: number;
  firstDueDate?: string;
  settleNow: boolean;
}

export function newPayment(kind = 'pix', amountCents = ''): PaymentDraft {
  return { key: crypto.randomUUID(), kind, paymentMethodId: '', amountCents, installments: 1, settleNow: kind !== 'credit' && kind !== 'debit' && kind !== 'installment' };
}

export function paymentsToApi(list: PaymentDraft[]) {
  return list
    .filter((p) => p.amountCents && p.amountCents !== '0')
    .map((p) => ({
      kind: p.kind,
      paymentMethodId: p.paymentMethodId || undefined,
      amountCents: p.amountCents,
      installments: p.installments,
      firstDueDate: p.firstDueDate || undefined,
      settleNow: p.kind === 'installment' || p.kind === 'store_credit' ? undefined : p.settleNow,
    }));
}

/** Pagamento dividido: soma precisa fechar o total; taxa prevista mostrada por forma. */
export function PaymentsEditor({ value, onChange, totalCents, today, storeCreditCents, showFees }: { value: PaymentDraft[]; onChange: (v: PaymentDraft[]) => void; totalCents: bigint; today: string; storeCreditCents?: string; showFees?: boolean }) {
  const methods = usePaymentMethods();
  const active = (methods.data ?? []).filter((m) => m.active);
  const sum = value.reduce((a, p) => a + BigInt(p.amountCents || '0'), 0n);
  const remaining = totalCents - sum;
  const update = (i: number, patch: Partial<PaymentDraft>) => onChange(value.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  return (
    <div className="flex flex-col gap-3">
      {value.map((p, i) => {
        const method = active.find((m) => (p.paymentMethodId ? m.id === p.paymentMethodId : m.kind === p.kind));
        const fee = method && p.amountCents ? applyBps(BigInt(p.amountCents), method.installmentFeeBps[String(p.installments)] ?? method.feeBps) : 0n;
        return (
          <div key={p.key} className="rounded-xl border border-line bg-bg p-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1.3fr_1fr_auto]">
              <Field label={`Forma ${i + 1}`} htmlFor={`pm-${p.key}`}>
                <Select
                  id={`pm-${p.key}`}
                  value={method?.id ?? ''}
                  onChange={(e) => {
                    const m = active.find((x) => x.id === e.target.value);
                    if (m) update(i, { paymentMethodId: m.id, kind: m.kind, settleNow: !['credit', 'debit', 'installment'].includes(m.kind), installments: 1 });
                  }}
                >
                  <option value="" disabled>Escolha</option>
                  {active.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </Select>
              </Field>
              <Field label="Valor" htmlFor={`pa-${p.key}`}><MoneyInput id={`pa-${p.key}`} value={p.amountCents} onChange={(c) => update(i, { amountCents: c })} /></Field>
              <div className="flex items-end gap-2">
                {remaining !== 0n && (
                  <Button type="button" variant="secondary" size="sm" className="h-10" onClick={() => update(i, { amountCents: (BigInt(p.amountCents || '0') + remaining).toString() })}>Completar</Button>
                )}
                {value.length > 1 && <Button type="button" variant="quiet" size="sm" className="h-10" onClick={() => onChange(value.filter((_, j) => j !== i))} aria-label="Remover forma"><Trash2 className="size-4" /></Button>}
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted">
              {(p.kind === 'installment' || p.kind === 'credit') && (
                <label className="flex items-center gap-2">Parcelas
                  <Input type="number" min={1} max={48} value={p.installments} onChange={(e) => update(i, { installments: Math.max(1, Math.min(48, Number(e.target.value) || 1)) })} className="h-8 w-20" />
                </label>
              )}
              {p.kind === 'installment' && (
                <label className="flex items-center gap-2">1º vencimento
                  <Input type="date" value={p.firstDueDate ?? addDays(today, 30)} onChange={(e) => update(i, { firstDueDate: e.target.value })} className="h-8 w-40" />
                </label>
              )}
              {['cash', 'pix', 'bank_transfer', 'debit', 'credit'].includes(p.kind) && (p.kind !== 'credit' || p.installments === 1) && (
                <label className="flex items-center gap-2">
                  <input type="checkbox" className="accent-[var(--color-primary)]" checked={p.settleNow} onChange={(e) => update(i, { settleNow: e.target.checked })} />
                  {p.kind === 'cash' || p.kind === 'pix' || p.kind === 'bank_transfer' ? 'Recebimento confirmado agora' : 'Já liquidado pela adquirente'}
                </label>
              )}
              {p.kind === 'store_credit' && storeCreditCents && <span>Crédito disponível: {formatBRL(storeCreditCents)}</span>}
              {showFees && fee > 0n && <span>Taxa prevista: {formatBRL(fee)}</span>}
              {method?.accountName && p.settleNow && <span>Conta: {method.accountName}</span>}
            </div>
          </div>
        );
      })}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={() => onChange([...value, newPayment('cash', remaining > 0n ? remaining.toString() : '')])}><Plus className="size-4" /> Dividir pagamento</Button>
        <span className={remaining === 0n ? 'text-xs text-success' : 'text-xs text-warning'} role="status">
          {remaining === 0n ? 'Pagamentos fecham o total.' : remaining > 0n ? `Faltam ${formatBRL(remaining)}` : `Excede em ${formatBRL(-remaining)}`}
        </span>
      </div>
    </div>
  );
}
