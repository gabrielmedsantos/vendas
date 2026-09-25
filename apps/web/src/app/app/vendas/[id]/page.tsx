'use client';

import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { RotateCcw, XCircle } from 'lucide-react';
import { formatBRL } from '@gct/shared';
import { DocLinks } from '@/components/docs/doc-links';
import { useAccounts } from '@/components/ops/hooks';
import { Badge, Button, Card, ErrorState, Field, FormError, Input, LoadingBlock, Modal, PageHeader, Select, Table, Td, Th } from '@/components/ui';
import { useToast } from '@/components/toast';
import { api, newKey } from '@/lib/client/api';
import { brl, dateBR, dateTimeBR, KIND_LABEL, STATUS_LABEL } from '@/lib/client/format';
import { useCan } from '@/lib/client/session';

interface Detail {
  sale: { id: string; number: string | null; status: string; origin: string; saleDate: string; confirmedAt: string | null; customerName: string | null; customerId: string | null; channelName: string | null; subtotalCents: string; discountCents: string; shippingCents: string; totalCents: string; costTotalCents?: string; feesTotalCents?: string; channelCostCents?: string; returnedRevenueCents: string; notes: string | null; tradeId: string | null; discountApprovedBy: string | null };
  items: { id: string; description: string; sku: string; quantity: number; unitPriceCents: string; totalCents: string; costCents?: string; returnedQty: number; internalCode: string | null; productKind: string }[];
  payments: { id: string; kind: string; methodName: string; amountCents: string; installments: number; feeCents?: string; settledNow: boolean }[];
  titles: { id: string; description: string; dueDate: string; originalCents: string; balanceCents: string; status: string }[];
  returns: { id: string; number: string; kind: string; reason: string; revenueCents: string; refundCents: string; storeCreditCents: string; reducedBalanceCents: string; createdAt: string }[];
  documents: { id: string; docType: string; number: string; status: string }[];
  canSeeCost: boolean;
}

export default function SaleDetail() {
  const { id } = useParams<{ id: string }>();
  const can = useCan();
  const qc = useQueryClient();
  const toast = useToast();
  const accounts = useAccounts(can('finance.view'));
  const q = useQuery({ queryKey: ['sale', id], queryFn: () => api<Detail>(`sales/${id}`), refetchInterval: (s) => (s.state.data?.documents.some((d) => d.status === 'pending') ? 3000 : false) });
  const [mode, setMode] = useState<null | 'return' | 'cancel'>(null);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [reason, setReason] = useState('');
  const [refund, setRefund] = useState({ mode: 'refund', payNow: false, accountId: '', method: 'pix' });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState(newKey);
  if (q.isLoading) return <LoadingBlock rows={6} />;
  if (q.error) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  const d = q.data!;
  const s = d.sale;
  const open = d.titles.reduce((a, t) => a + BigInt(t.balanceCents), 0n);
  const canReturn = ['confirmed', 'partially_returned'].includes(s.status) && can('reversals.execute') && !s.tradeId;
  const refundBody = () => (refund.mode === 'store_credit' ? { mode: 'store_credit' } : { mode: 'refund', payNow: refund.payNow ? { accountId: refund.accountId || accounts.data?.[0]?.id, method: refund.method } : null });
  const submit = async () => {
    setBusy(true); setError(null);
    try {
      if (mode === 'cancel') await api(`sales/${id}/cancel`, { body: { reason, refund: refundBody() }, idempotencyKey: key });
      else await api(`sales/${id}/returns`, { body: { reason, refund: refundBody(), items: d.items.map((i) => ({ saleItemId: i.id, quantity: Number(qty[i.id] || 0) })).filter((x) => x.quantity > 0) }, idempotencyKey: key });
      await qc.invalidateQueries();
      toast(mode === 'cancel' ? 'Venda cancelada; estorno registrado.' : 'Devolução registrada; itens em inspeção.');
      setMode(null); setKey(newKey());
    } catch (e) { setError(e); } finally { setBusy(false); }
  };
  return (
    <div>
      <PageHeader
        title={s.number ? `Venda #${s.number}` : 'Orçamento'}
        description={`${s.customerName ?? 'Consumidor não identificado'} · ${dateBR(s.saleDate)}${s.channelName ? ` · ${s.channelName}` : ''}`}
        actions={<>
          {s.origin === 'trade' && <Badge tone="primary">Troca</Badge>}
          <Badge tone={s.status === 'confirmed' ? 'success' : 'warning'}>{STATUS_LABEL[s.status]}</Badge>
          {s.tradeId && <Link className="text-sm text-primary-soft" href={`/app/trocas/${s.tradeId}`}>Ver troca</Link>}
          {canReturn && <Button variant="secondary" onClick={() => { setMode('return'); setQty({}); setReason(''); }}><RotateCcw className="size-4" />Devolução</Button>}
          {canReturn && s.status === 'confirmed' && <Button variant="danger" onClick={() => { setMode('cancel'); setReason(''); }}><XCircle className="size-4" />Cancelar venda</Button>}
        </>}
      />
      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <div className="flex flex-col gap-4">
          <Card title="Itens">
            <Table>
              <thead><tr><Th>Item</Th><Th right>Qtd</Th><Th right>Preço</Th><Th right>Total</Th>{d.canSeeCost && <Th right>Custo histórico</Th>}<Th right>Devolvido</Th></tr></thead>
              <tbody>{d.items.map((i) => (
                <tr key={i.id}><Td>{i.description}<div className="text-xs text-muted">{i.sku}{i.internalCode ? ` · ${i.internalCode}` : ''}</div></Td><Td right>{i.quantity}</Td><Td right>{brl(i.unitPriceCents)}</Td><Td right>{brl(i.totalCents)}</Td>{d.canSeeCost && <Td right>{brl(i.costCents)}</Td>}<Td right>{i.returnedQty || '—'}</Td></tr>
              ))}</tbody>
            </Table>
            <dl className="mt-3 flex flex-col items-end gap-1 text-sm">
              <div className="flex gap-6"><dt className="text-muted">Subtotal</dt><dd className="tabular">{brl(s.subtotalCents)}</dd></div>
              {s.discountCents !== '0' && <div className="flex gap-6"><dt className="text-muted">Descontos</dt><dd className="tabular">−{brl(s.discountCents)}</dd></div>}
              {s.shippingCents !== '0' && <div className="flex gap-6"><dt className="text-muted">Frete</dt><dd className="tabular">{brl(s.shippingCents)}</dd></div>}
              <div className="flex gap-6 text-base font-semibold"><dt>Total</dt><dd className="tabular">{brl(s.totalCents)}</dd></div>
              {d.canSeeCost && s.costTotalCents && <div className="flex gap-6 text-success"><dt>Resultado bruto</dt><dd className="tabular">{formatBRL(BigInt(s.totalCents) - BigInt(s.costTotalCents))}</dd></div>}
              {s.returnedRevenueCents !== '0' && <div className="flex gap-6 text-warning"><dt>Devolvido</dt><dd className="tabular">−{brl(s.returnedRevenueCents)}</dd></div>}
            </dl>
          </Card>
          {d.returns.length > 0 && (
            <Card title="Devoluções e cancelamentos">
              <ul className="flex flex-col gap-2 text-sm">{d.returns.map((r) => (
                <li key={r.id} className="rounded-xl border border-line bg-bg px-3 py-2">
                  <div className="flex justify-between"><span>{r.kind === 'cancellation' ? 'Cancelamento' : 'Devolução'} nº {r.number} · {dateTimeBR(r.createdAt)}</span><span className="tabular">{brl(r.revenueCents)}</span></div>
                  <p className="text-xs text-muted">{r.reason} · abatido {brl(r.reducedBalanceCents)} · reembolso {brl(r.refundCents)} · crédito {brl(r.storeCreditCents)}</p>
                </li>
              ))}</ul>
            </Card>
          )}
        </div>
        <div className="flex flex-col gap-4">
          <Card title="Pagamento">
            <ul className="flex flex-col gap-2 text-sm">{d.payments.map((p) => (
              <li key={p.id} className="flex justify-between gap-2"><span>{p.methodName}{p.installments > 1 ? ` · ${p.installments}x` : ''}<span className="block text-xs text-muted">{p.kind === 'trade_offset' ? 'compensado na troca, sem dinheiro' : p.settledNow ? 'recebido na venda' : 'a receber'}{d.canSeeCost && p.feeCents && p.feeCents !== '0' ? ` · taxa prevista ${brl(p.feeCents)}` : ''}</span></span><span className="tabular">{brl(p.amountCents)}</span></li>
            ))}</ul>
            {d.titles.length > 0 && <p className="mt-3 border-t border-line pt-2 text-sm">Em aberto: <strong className="tabular">{formatBRL(open)}</strong></p>}
          </Card>
          <Card title="Documentos"><DocLinks docs={d.documents} /></Card>
          {s.notes && <Card title="Observações"><p className="text-sm text-muted">{s.notes}</p></Card>}
        </div>
      </div>
      <Modal open={!!mode} onClose={() => setMode(null)} title={mode === 'cancel' ? 'Cancelar venda' : 'Registrar devolução'} footer={<>
        <Button variant="secondary" onClick={() => setMode(null)}>Voltar</Button>
        <Button variant="danger" loading={busy} onClick={submit}>{mode === 'cancel' ? 'Confirmar cancelamento' : 'Confirmar devolução'}</Button>
      </>}>
        <div className="flex flex-col gap-3 text-sm">
          <p className="text-muted">A venda original não é apagada: um estorno vinculado reverte receita e custo pelos valores históricos. Itens voltam em inspeção. Primeiro é abatido o saldo em aberto ({formatBRL(open)}); o que já foi pago vira reembolso ou crédito da loja.</p>
          {mode === 'return' && d.items.filter((i) => i.quantity > i.returnedQty).map((i) => (
            <Field key={i.id} label={`${i.description} (devolvível ${i.quantity - i.returnedQty})`} htmlFor={`ret-${i.id}`}>
              <Input id={`ret-${i.id}`} type="number" min={0} max={i.quantity - i.returnedQty} value={qty[i.id] ?? ''} onChange={(e) => setQty({ ...qty, [i.id]: e.target.value })} />
            </Field>
          ))}
          <Field label="Motivo" htmlFor="rreason" required><Input id="rreason" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
          <Field label="Valor já pago" htmlFor="rmode">
            <Select id="rmode" value={refund.mode} onChange={(e) => setRefund({ ...refund, mode: e.target.value })}>
              <option value="refund">Reembolsar ao cliente</option>
              <option value="store_credit" disabled={!s.customerId}>Gerar crédito da loja</option>
            </Select>
          </Field>
          {refund.mode === 'refund' && can('finance.settle_payable') && (
            <label className="flex items-center gap-2"><input type="checkbox" className="accent-[var(--color-primary)]" checked={refund.payNow} onChange={(e) => setRefund({ ...refund, payNow: e.target.checked })} />Pagar o reembolso agora</label>
          )}
          {refund.mode === 'refund' && refund.payNow && (
            <div className="grid grid-cols-2 gap-2">
              <Select aria-label="Conta" value={refund.accountId} onChange={(e) => setRefund({ ...refund, accountId: e.target.value })}>{accounts.data?.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select>
              <Select aria-label="Meio" value={refund.method} onChange={(e) => setRefund({ ...refund, method: e.target.value })}>{['pix', 'cash', 'bank_transfer'].map((m) => <option key={m} value={m}>{KIND_LABEL[m]}</option>)}</Select>
            </div>
          )}
          <FormError error={error} />
        </div>
      </Modal>
    </div>
  );
}
