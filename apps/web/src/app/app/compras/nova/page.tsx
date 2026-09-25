'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { allocateLargestRemainder, formatBRL } from '@gct/shared';
import { PartyPicker, type PickedParty } from '@/components/ops/party-picker';
import { ProductPicker, type PickedVariant } from '@/components/ops/product-picker';
import { useAccounts } from '@/components/ops/hooks';
import { Button, Card, Field, FormError, Input, MoneyInput, NoPermission, PageHeader, Select } from '@/components/ui';
import { useToast } from '@/components/toast';
import { api, newKey } from '@/lib/client/api';
import { useCan } from '@/lib/client/session';

interface UnitSpec { imei: string; imei2: string; serial: string; condition: string; battery: string; accessories: string; defects: string }
interface Line { key: string; variant: PickedVariant; quantity: number; unitCostCents: string; units: UnitSpec[] }
const blankUnit = (): UnitSpec => ({ imei: '', imei2: '', serial: '', condition: 'used', battery: '', accessories: '', defects: '' });

function NewPurchase() {
  const can = useCan();
  const router = useRouter();
  const params = useSearchParams();
  const toast = useToast();
  const qc = useQueryClient();
  const accounts = useAccounts();
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
  const [supplier, setSupplier] = useState<PickedParty | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [extra, setExtra] = useState('');
  const [discount, setDiscount] = useState('');
  const [terms, setTerms] = useState<{ mode: string; accountId: string; method: string; dueDate: string; count: string; firstDueDate: string }>({ mode: 'pay_now', accountId: '', method: 'pix', dueDate: today, count: '2', firstDueDate: today });
  const [destination, setDestination] = useState('available');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState<'quick' | 'draft' | null>(null);
  const [key] = useState(newKey);
  const pre = params.get('variante');
  const preQ = useQuery({ queryKey: ['variant', pre], queryFn: () => api<PickedVariant>(`variants/${pre}`), enabled: !!pre });
  const [preUsed, setPreUsed] = useState(false);
  useEffect(() => {
    if (preQ.data && !preUsed) {
      setPreUsed(true);
      const v = preQ.data;
      setLines((s) => (s.length ? s : [{ key: crypto.randomUUID(), variant: v, quantity: 1, unitCostCents: '', units: v.tracking === 'serialized' ? [blankUnit()] : [] }]));
    }
  }, [preQ.data, preUsed]);
  useEffect(() => {
    if (accounts.data && !terms.accountId) setTerms((t) => ({ ...t, accountId: accounts.data.find((a) => a.kind === 'bank')?.id ?? accounts.data[0]?.id ?? '' }));
  }, [accounts.data, terms.accountId]);
  const itemsNet = lines.reduce((a, l) => a + BigInt(l.unitCostCents || '0') * BigInt(l.quantity), 0n);
  const total = itemsNet - BigInt(discount || '0') + BigInt(extra || '0');
  const landed = useMemo(() => {
    const weights = lines.map((l) => BigInt(l.unitCostCents || '0') * BigInt(l.quantity));
    const e = weights.length ? allocateLargestRemainder(BigInt(extra || '0'), weights) : [];
    const d = weights.length ? allocateLargestRemainder(BigInt(discount || '0'), weights) : [];
    return weights.map((w, i) => w - d[i]! + e[i]!);
  }, [lines, extra, discount]);
  if (!can('purchases.manage')) return <NoPermission />;
  const addVariant = (v: PickedVariant) => {
    if (v.kind === 'service') return setError(new Error('Serviço não entra em estoque.'));
    setLines((s) => [...s, { key: crypto.randomUUID(), variant: v, quantity: 1, unitCostCents: '', units: v.tracking === 'serialized' ? [blankUnit()] : [] }]);
  };
  const setLine = (i: number, patch: Partial<Line>) => setLines((s) => s.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const payload = () => ({
    supplierId: supplier?.id,
    purchaseDate: today,
    items: lines.map((l) => ({
      variantId: l.variant.variantId,
      quantity: l.quantity,
      unitCostCents: l.unitCostCents || '0',
      unitSpecs: l.variant.tracking === 'serialized' ? l.units.map((u) => ({
        identifiers: [u.imei && { kind: 'imei1', value: u.imei }, u.imei2 && { kind: 'imei2', value: u.imei2 }, u.serial && { kind: 'serial', value: u.serial }].filter(Boolean),
        condition: u.condition || null, batteryHealthPct: u.battery ? Number(u.battery) : null, accessories: u.accessories || null, defects: u.defects || null,
      })) : undefined,
    })),
    discountCents: discount || '0',
    extraCostsCents: extra || '0',
    paymentTerms: terms.mode === 'pay_now' ? { mode: 'pay_now', accountId: terms.accountId, method: terms.method } : terms.mode === 'due' ? { mode: 'due', dueDate: terms.dueDate } : { mode: 'installments', count: Number(terms.count), firstDueDate: terms.firstDueDate, interval: 'monthly' },
    notes: notes || null,
  });
  const submit = async (mode: 'quick' | 'draft') => {
    setError(null);
    if (!supplier) return setError(new Error('Escolha o fornecedor ou a pessoa que vende.'));
    if (!lines.length) return setError(new Error('Adicione ao menos um item.'));
    setSaving(mode);
    try {
      const r = mode === 'quick'
        ? await api<{ id: string }>('purchases/quick', { body: { ...payload(), destination }, idempotencyKey: key })
        : await api<{ id: string }>('purchases', { body: payload() });
      await qc.invalidateQueries();
      toast(mode === 'quick' ? 'Compra registrada e estoque atualizado.' : 'Rascunho salvo.');
      router.push(`/app/compras/${r.id}`);
    } catch (e) { setError(e); } finally { setSaving(null); }
  };
  return (
    <div>
      <PageHeader title="Nova compra" description="Compra de fornecedor ou de pessoa física (usados). Custo de aquisição = preço acordado − desconto + frete e custos diretamente atribuíveis." />
      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <div className="flex flex-col gap-4">
          <Card title="Quem vende"><PartyPicker value={supplier} onChange={setSupplier} role="supplier" label="Fornecedor" required /></Card>
          <Card title="Itens">
            <ProductPicker onPick={addVariant} includeInactive />
            <div className="mt-4 flex flex-col gap-3">
              {lines.length === 0 && <p className="py-6 text-center text-sm text-muted">Busque e adicione os produtos comprados.</p>}
              {lines.map((l, i) => (
                <div key={l.key} className="rounded-xl border border-line bg-bg p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div><p className="font-medium">{l.variant.name}{l.variant.label ? ` · ${l.variant.label}` : ''}</p><p className="text-xs text-muted">{l.variant.sku}{l.variant.tracking === 'serialized' ? ' · cada unidade com IMEI/série' : ''}</p></div>
                    <Button variant="quiet" size="sm" onClick={() => setLines(lines.filter((_, j) => j !== i))} aria-label="Remover item"><Trash2 className="size-4" /></Button>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
                    <Field label="Quantidade" htmlFor={`q-${l.key}`}><Input id={`q-${l.key}`} type="number" min={1} value={l.quantity} onChange={(e) => { const n = Math.max(1, Number(e.target.value) || 1); setLine(i, { quantity: n, units: l.variant.tracking === 'serialized' ? Array.from({ length: n }, (_, k) => l.units[k] ?? blankUnit()) : [] }); }} /></Field>
                    <Field label="Custo unitário acordado" htmlFor={`c-${l.key}`}><MoneyInput id={`c-${l.key}`} value={l.unitCostCents} onChange={(c) => setLine(i, { unitCostCents: c })} /></Field>
                    <div className="flex flex-col justify-end text-right text-xs text-muted">Custo de aquisição da linha<span className="text-sm font-medium text-fg tabular">{formatBRL(landed[i] ?? 0n)}</span></div>
                  </div>
                  {l.variant.tracking === 'serialized' && l.units.map((u, k) => (
                    <div key={k} className="mt-3 grid grid-cols-2 gap-2 rounded-lg border border-line/60 p-2 sm:grid-cols-4">
                      <p className="col-span-2 text-xs font-medium text-muted sm:col-span-4">Unidade {k + 1}</p>
                      {(['imei', 'imei2', 'serial'] as const).map((f) => (
                        <Input key={f} aria-label={f.toUpperCase()} placeholder={f === 'serial' ? 'Série' : f === 'imei' ? 'IMEI 1' : 'IMEI 2'} value={u[f]} onChange={(e) => setLine(i, { units: l.units.map((x, j) => (j === k ? { ...x, [f]: e.target.value } : x)) })} className="h-9" />
                      ))}
                      <Select aria-label="Condição" value={u.condition} onChange={(e) => setLine(i, { units: l.units.map((x, j) => (j === k ? { ...x, condition: e.target.value } : x)) })} className="h-9"><option value="new">Novo</option><option value="used">Usado</option><option value="refurbished">Recondicionado</option><option value="defective">Com defeito</option></Select>
                      <Input aria-label="Bateria %" placeholder="Bateria %" inputMode="numeric" value={u.battery} onChange={(e) => setLine(i, { units: l.units.map((x, j) => (j === k ? { ...x, battery: e.target.value.replace(/\D/g, '').slice(0, 3) } : x)) })} className="h-9" />
                      <Input aria-label="Acessórios" placeholder="Acessórios" value={u.accessories} onChange={(e) => setLine(i, { units: l.units.map((x, j) => (j === k ? { ...x, accessories: e.target.value } : x)) })} className="h-9 sm:col-span-2" />
                      <Input aria-label="Defeitos" placeholder="Defeitos observados" value={u.defects} onChange={(e) => setLine(i, { units: l.units.map((x, j) => (j === k ? { ...x, defects: e.target.value } : x)) })} className="h-9 sm:col-span-2" />
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </Card>
          <Card title="Custos e condição de pagamento">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Frete e custos de aquisição" htmlFor="extra" help="Rateado pelo valor dos itens."><MoneyInput id="extra" value={extra} onChange={setExtra} /></Field>
              <Field label="Desconto obtido" htmlFor="disc"><MoneyInput id="disc" value={discount} onChange={setDiscount} /></Field>
              <Field label="Pagamento" htmlFor="terms">
                <Select id="terms" value={terms.mode} onChange={(e) => setTerms({ ...terms, mode: e.target.value })}>
                  <option value="pay_now">Pago agora</option>
                  <option value="due">A pagar em data única</option>
                  <option value="installments">Parcelado (mensal)</option>
                </Select>
              </Field>
              {terms.mode === 'pay_now' && (
                <>
                  <Field label="Conta de saída" htmlFor="acc"><Select id="acc" value={terms.accountId} onChange={(e) => setTerms({ ...terms, accountId: e.target.value })}>{accounts.data?.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select></Field>
                  <Field label="Meio" htmlFor="meth"><Select id="meth" value={terms.method} onChange={(e) => setTerms({ ...terms, method: e.target.value })}><option value="pix">Pix</option><option value="cash">Dinheiro</option><option value="bank_transfer">Transferência</option><option value="boleto">Boleto</option><option value="debit">Débito</option><option value="credit">Crédito</option></Select></Field>
                </>
              )}
              {terms.mode === 'due' && <Field label="Vencimento" htmlFor="due"><Input id="due" type="date" value={terms.dueDate} onChange={(e) => setTerms({ ...terms, dueDate: e.target.value })} /></Field>}
              {terms.mode === 'installments' && (
                <>
                  <Field label="Parcelas" htmlFor="cnt"><Input id="cnt" type="number" min={1} max={48} value={terms.count} onChange={(e) => setTerms({ ...terms, count: e.target.value })} /></Field>
                  <Field label="1º vencimento" htmlFor="fd"><Input id="fd" type="date" value={terms.firstDueDate} onChange={(e) => setTerms({ ...terms, firstDueDate: e.target.value })} /></Field>
                </>
              )}
              <Field label="Destino no estoque" htmlFor="dest" help="Itens usados costumam ir para inspeção antes da venda.">
                <Select id="dest" value={destination} onChange={(e) => setDestination(e.target.value)}><option value="available">Disponível para venda</option><option value="inspection">Inspeção / quarentena</option></Select>
              </Field>
              <Field label="Observações" htmlFor="notes"><Input id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
            </div>
          </Card>
        </div>
        <aside className="lg:sticky lg:top-20 lg:self-start">
          <Card title="Resumo">
            <dl className="flex flex-col gap-2 text-sm">
              <div className="flex justify-between"><dt className="text-muted">Itens</dt><dd className="tabular">{formatBRL(itemsNet)}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">Desconto</dt><dd className="tabular">−{formatBRL(BigInt(discount || '0'))}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">Frete e custos</dt><dd className="tabular">{formatBRL(BigInt(extra || '0'))}</dd></div>
              <div className="mt-2 flex justify-between border-t border-line pt-2 text-base font-semibold"><dt>Total a pagar</dt><dd className="tabular">{formatBRL(total)}</dd></div>
            </dl>
            <p className="mt-3 text-xs text-muted">A compra de estoque reduz o caixa quando paga, mas não vira despesa: o custo entra no resultado quando o item for vendido.</p>
            <div className="mt-4"><FormError error={error} /></div>
            <div className="mt-4 flex flex-col gap-2">
              <Button loading={saving === 'quick'} disabled={!!saving} onClick={() => submit('quick')}>Confirmar compra e receber tudo</Button>
              <Button variant="secondary" loading={saving === 'draft'} disabled={!!saving} onClick={() => submit('draft')}>Salvar como rascunho (receber depois)</Button>
            </div>
          </Card>
        </aside>
      </div>
    </div>
  );
}

export default function Page() {
  return <Suspense><NewPurchase /></Suspense>;
}
