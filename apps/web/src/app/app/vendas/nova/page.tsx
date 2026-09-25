'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { formatBRL } from '@gct/shared';
import { PartyPicker, type PickedParty } from '@/components/ops/party-picker';
import { newPayment, PaymentsEditor, paymentsToApi, type PaymentDraft } from '@/components/ops/payments-editor';
import { ProductPicker, type PickedVariant } from '@/components/ops/product-picker';
import { lineFromVariant, SaleLines, type SaleLine } from '@/components/ops/sale-lines';
import { useChannels } from '@/components/ops/hooks';
import { Button, Card, Field, FormError, Input, Modal, MoneyInput, NoPermission, PageHeader, Select } from '@/components/ui';
import { useToast } from '@/components/toast';
import { api, newKey } from '@/lib/client/api';
import { KIND_LABEL } from '@/lib/client/format';
import { useCan, useMe } from '@/lib/client/session';

function NewSale() {
  const can = useCan();
  const me = useMe();
  const router = useRouter();
  const params = useSearchParams();
  const toast = useToast();
  const qc = useQueryClient();
  const channels = useChannels();
  const tz = me.data?.current?.timezone ?? 'America/Sao_Paulo';
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
  const [lines, setLines] = useState<SaleLine[]>([]);
  const [customer, setCustomer] = useState<PickedParty | null>(null);
  const [channelId, setChannelId] = useState('');
  const [discount, setDiscount] = useState('');
  const [shipping, setShipping] = useState('');
  const [notes, setNotes] = useState('');
  const [payments, setPayments] = useState<PaymentDraft[]>([newPayment('pix')]);
  const [review, setReview] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  const [key, setKey] = useState(newKey);
  const pre = params.get('variante');
  const preQ = useQuery({ queryKey: ['variant', pre], queryFn: () => api<PickedVariant>(`variants/${pre}`), enabled: !!pre });
  useEffect(() => { if (preQ.data) setLines((s) => (s.length ? s : [lineFromVariant(preQ.data)])); }, [preQ.data]);
  useEffect(() => { if (channels.data && !channelId) setChannelId(channels.data.find((c) => c.active)?.id ?? ''); }, [channels.data, channelId]);
  const showCost = can('costs.view');
  const subtotal = lines.reduce((a, l) => a + BigInt(l.unitPriceCents || '0') * BigInt(l.quantity), 0n);
  const total = subtotal - BigInt(discount || '0') + BigInt(shipping || '0');
  const cost = lines.reduce((a, l) => a + (l.unitCostCents ? BigInt(l.unitCostCents) * BigInt(l.quantity) : 0n), 0n);
  const paid = payments.reduce((a, p) => a + BigInt(p.amountCents || '0'), 0n);
  // Primeiro pagamento acompanha o total enquanto houver só uma forma.
  useEffect(() => {
    setPayments((ps) => (ps.length === 1 ? [{ ...ps[0]!, amountCents: total > 0n ? total.toString() : '' }] : ps));
  }, [total]);
  if (!can('sales.create')) return <NoPermission />;
  const body = () => ({
    customerId: customer?.id ?? null,
    channelId: channelId || null,
    items: lines.map((l) => ({ variantId: l.variant.variantId, unitId: l.unitId ?? null, quantity: l.quantity, unitPriceCents: l.unitPriceCents || '0' })),
    discountCents: discount || '0',
    shippingCents: shipping || '0',
    payments: paymentsToApi(payments),
    notes: notes || null,
  });
  const openReview = () => {
    setError(null);
    if (!lines.length) return setError(new Error('Adicione ao menos um item.'));
    if (lines.some((l) => l.variant.tracking === 'serialized' && !l.unitId)) return setError(new Error('Escolha a unidade (IMEI/série) de cada item serializado.'));
    if (paid !== total) return setError(new Error(`Pagamentos (${formatBRL(paid)}) precisam somar o total (${formatBRL(total)}).`));
    setReview(true);
  };
  return (
    <div>
      <PageHeader title="Nova venda" description="Venda entregue e confirmada: baixa o estoque ao custo histórico e cria os recebimentos." />
      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <div className="flex flex-col gap-4">
          <Card title="Itens da venda">
            <ProductPicker onPick={(v) => setLines((s) => [...s, lineFromVariant(v)])} />
            <div className="mt-4"><SaleLines lines={lines} onChange={setLines} showCost={showCost} /></div>
          </Card>
          <Card title="Cliente e canal">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2"><PartyPicker value={customer} onChange={setCustomer} role="customer" label="Cliente" /></div>
              <Field label="Canal de venda" htmlFor="channel" required>
                <Select id="channel" value={channelId} onChange={(e) => setChannelId(e.target.value)}>{channels.data?.filter((c) => c.active).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
              </Field>
              <Field label="Observações" htmlFor="notes"><Input id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
            </div>
          </Card>
          <Card title="Formas de pagamento" description="Crediário e crédito da loja exigem cliente identificado.">
            <PaymentsEditor value={payments} onChange={setPayments} totalCents={total} today={today} storeCreditCents={customer?.storeCreditCents} showFees={showCost} />
          </Card>
        </div>
        <aside className="lg:sticky lg:top-20 lg:self-start">
          <Card title="Resumo">
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-2">
                <Field label="Desconto" htmlFor="discount"><MoneyInput id="discount" value={discount} onChange={setDiscount} /></Field>
                <Field label="Frete cobrado" htmlFor="shipping"><MoneyInput id="shipping" value={shipping} onChange={setShipping} /></Field>
              </div>
              <dl className="flex flex-col gap-1.5 text-sm">
                <div className="flex justify-between"><dt className="text-muted">Subtotal</dt><dd className="tabular">{formatBRL(subtotal)}</dd></div>
                {showCost && <div className="flex justify-between"><dt className="text-muted">Custo (histórico estimado)</dt><dd className="tabular text-danger-soft">−{formatBRL(cost)}</dd></div>}
                <div className="mt-2 flex items-end justify-between border-t border-line pt-3"><dt className="text-xs uppercase tracking-wide text-muted">Total da venda</dt><dd className="text-2xl font-semibold tabular">{formatBRL(total)}</dd></div>
                {showCost && <div className="flex justify-between text-success"><dt>Resultado bruto projetado</dt><dd className="tabular">{formatBRL(total - cost)}</dd></div>}
              </dl>
              <FormError error={error} />
              <Button onClick={openReview} disabled={!lines.length}>Revisar e confirmar</Button>
            </div>
          </Card>
        </aside>
      </div>
      <Modal open={review} onClose={() => setReview(false)} title="Confirmar venda" footer={<>
        <Button variant="secondary" onClick={() => setReview(false)}>Voltar</Button>
        <Button loading={saving} onClick={async () => {
          setSaving(true); setError(null);
          try {
            const r = await api<{ saleId: string; number: string }>('sales', { body: body(), idempotencyKey: key });
            await qc.invalidateQueries();
            toast(`Venda #${r.number} confirmada.`);
            router.push(`/app/vendas/${r.saleId}`);
          } catch (e) { setError(e); setKey(newKey()); } finally { setSaving(false); }
        }}>Confirmar venda</Button>
      </>}>
        <div className="flex flex-col gap-3 text-sm">
          <p><span className="text-muted">Cliente:</span> {customer?.name ?? 'Consumidor não identificado'}</p>
          <ul className="flex flex-col gap-1">{lines.map((l) => <li key={l.key} className="flex justify-between"><span>{l.quantity}× {l.variant.name}{l.unitCode ? ` (${l.unitCode})` : ''}</span><span className="tabular">{formatBRL(BigInt(l.unitPriceCents || '0') * BigInt(l.quantity))}</span></li>)}</ul>
          <div className="flex justify-between border-t border-line pt-2 font-semibold"><span>Total</span><span className="tabular">{formatBRL(total)}</span></div>
          <ul className="flex flex-col gap-1 text-muted">{paymentsToApi(payments).map((p, i) => <li key={i} className="flex justify-between"><span>{KIND_LABEL[p.kind]}{p.installments > 1 ? ` em ${p.installments}x` : ''}{p.settleNow === false ? ' (a receber)' : p.kind === 'installment' ? ' (a receber)' : ''}</span><span className="tabular">{formatBRL(p.amountCents)}</span></li>)}</ul>
          <p className="text-xs text-muted">Ao confirmar: estoque baixado, títulos criados e recebimentos confirmados registrados no caixa. Correções depois são feitas por devolução/estorno.</p>
          <FormError error={error} />
        </div>
      </Modal>
    </div>
  );
}

export default function Page() {
  return <Suspense><NewSale /></Suspense>;
}
