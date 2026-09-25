'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, Plus, Scale, Trash2 } from 'lucide-react';
import { formatBRL } from '@gct/shared';
import { useAccounts, useCategories, useDebounced } from '@/components/ops/hooks';
import { PartyPicker, type PickedParty } from '@/components/ops/party-picker';
import { newPayment, PaymentsEditor, paymentsToApi, type PaymentDraft } from '@/components/ops/payments-editor';
import { ProductPicker, type PickedVariant } from '@/components/ops/product-picker';
import { lineFromVariant, SaleLines, type SaleLine } from '@/components/ops/sale-lines';
import { Badge, Button, Card, cx, Field, FormError, Input, Modal, MoneyInput, NoPermission, PageHeader, Select, Textarea } from '@/components/ui';
import { useToast } from '@/components/toast';
import { api, newKey } from '@/lib/client/api';
import { KIND_LABEL } from '@/lib/client/format';
import { useCan, useMe } from '@/lib/client/session';

interface Incoming {
  key: string;
  existing: PickedVariant | null;
  newName: string;
  newCategoryId: string;
  tracking: 'serialized' | 'quantity';
  quantity: number;
  agreedCents: string;
  estimatedExtraCostCents: string;
  suggestedPriceCents: string;
  destination: 'inspection' | 'available';
  imei1: string;
  imei2: string;
  serial: string;
  condition: string;
  battery: string;
  accessories: string;
  defects: string;
  checklist: Record<string, boolean>;
  notes: string;
}

const CHECKS = [['liga', 'Liga normalmente'], ['tela', 'Tela sem trincas'], ['bateria', 'Bateria ok'], ['camera', 'Câmeras ok'], ['botoes', 'Botões ok'], ['conta', 'Sem conta/bloqueio vinculado']] as const;

const blankIncoming = (): Incoming => ({
  key: crypto.randomUUID(), existing: null, newName: '', newCategoryId: '', tracking: 'serialized', quantity: 1, agreedCents: '', estimatedExtraCostCents: '', suggestedPriceCents: '',
  destination: 'inspection', imei1: '', imei2: '', serial: '', condition: 'used', battery: '', accessories: '', defects: '', checklist: {}, notes: '',
});

interface Simulation {
  computation: { saleTotalCents: string; purchaseTotalCents: string; offsetCents: string; differenceCents: string; direction: 'customer_pays' | 'company_pays' | 'even'; differenceAbsCents: string };
  explanation: string;
  estimatedExtraCostsCents: string;
  projected?: { outgoingCostCents: string; grossProfitCents: string };
}

const STEPS = ['Cliente', 'Saem', 'Entram', 'Diferença', 'Confirmar'];

export default function NewTradePage() {
  const can = useCan();
  const me = useMe();
  const router = useRouter();
  const toast = useToast();
  const qc = useQueryClient();
  const cats = useCategories();
  const accounts = useAccounts(can('finance.view') || can('finance.settle_payable'));
  const tz = me.data?.current?.timezone ?? 'America/Sao_Paulo';
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
  const [party, setParty] = useState<PickedParty | null>(null);
  const [out, setOut] = useState<SaleLine[]>([]);
  const [discount, setDiscount] = useState('');
  const [incoming, setIncoming] = useState<Incoming[]>([blankIncoming()]);
  const [companyPolicy, setCompanyPolicy] = useState<'pay' | 'store_credit'>('pay');
  const [payNow, setPayNow] = useState(false);
  const [payAccount, setPayAccount] = useState('');
  const [payMethod, setPayMethod] = useState('pix');
  const [payments, setPayments] = useState<PaymentDraft[]>([newPayment('pix')]);
  const [notes, setNotes] = useState('');
  const [review, setReview] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  const [key, setKey] = useState(newKey);
  const showCost = can('costs.view');

  const S = out.reduce((a, l) => a + BigInt(l.unitPriceCents || '0') * BigInt(l.quantity), 0n) - BigInt(discount || '0');
  const P = incoming.reduce((a, i) => a + BigInt(i.agreedCents || '0'), 0n);
  const D = S - P;
  const direction = D > 0n ? 'customer_pays' : D < 0n ? 'company_pays' : 'even';
  const policy = direction === 'customer_pays' ? 'receive' : direction === 'even' ? 'none' : companyPolicy;

  useEffect(() => {
    if (direction === 'customer_pays') setPayments((ps) => (ps.length === 1 ? [{ ...ps[0]!, amountCents: D.toString() }] : ps));
  }, [D, direction]);
  useEffect(() => { if (accounts.data && !payAccount) setPayAccount(accounts.data.find((a) => a.kind === 'cash')?.id ?? accounts.data[0]?.id ?? ''); }, [accounts.data, payAccount]);

  const body = useMemo(() => ({
    partyId: party?.id,
    outgoing: out.map((l) => ({ variantId: l.variant.variantId, unitId: l.unitId ?? null, quantity: l.quantity, unitPriceCents: l.unitPriceCents || '0' })),
    discountCents: discount || '0',
    incoming: incoming.map((i) => ({
      variantId: i.existing?.variantId,
      newProduct: i.existing ? undefined : { name: i.newName, categoryId: i.newCategoryId || null, tracking: i.tracking },
      quantity: i.tracking === 'serialized' ? 1 : i.quantity,
      agreedCents: i.agreedCents || '0',
      estimatedExtraCostCents: i.estimatedExtraCostCents || '0',
      suggestedPriceCents: i.suggestedPriceCents || null,
      destination: i.destination,
      unit: i.tracking === 'serialized' || i.existing?.tracking === 'serialized' ? {
        identifiers: [i.imei1 && { kind: 'imei1', value: i.imei1 }, i.imei2 && { kind: 'imei2', value: i.imei2 }, i.serial && { kind: 'serial', value: i.serial }].filter(Boolean),
        condition: i.condition || null, batteryHealthPct: i.battery ? Number(i.battery) : null, accessories: i.accessories || null, defects: i.defects || null, checklist: i.checklist,
      } : undefined,
      notes: i.notes || null,
    })),
    differencePolicy: policy,
    differencePayments: direction === 'customer_pays' ? paymentsToApi(payments) : [],
    payNow: direction === 'company_pays' && policy === 'pay' && payNow ? { accountId: payAccount, method: payMethod } : null,
    notes: notes || null,
  }), [party, out, discount, incoming, policy, direction, payments, payNow, payAccount, payMethod, notes]);

  const ready = !!party && out.length > 0 && incoming.every((i) => (i.existing || i.newName.trim().length >= 2) && i.agreedCents !== '');
  const simKey = useDebounced(JSON.stringify(body), 400);
  const sim = useQuery({ queryKey: ['trade-sim', simKey], queryFn: () => api<Simulation>('trades/simulate', { body: JSON.parse(simKey) }), enabled: ready, retry: false });

  if (!can('trades.confirm')) return <NoPermission message="Seu papel não permite concluir trocas. Peça ao proprietário para liberar a permissão “Concluir trocas”." />;

  const setInc = (i: number, patch: Partial<Incoming>) => setIncoming((s) => s.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const step = !party ? 0 : !out.length ? 1 : !ready ? 2 : 3;
  const paid = payments.reduce((a, p) => a + BigInt(p.amountCents || '0'), 0n);

  const openReview = () => {
    setError(null);
    if (!ready) return setError(new Error('Preencha cliente, itens que saem e avaliação dos itens que entram.'));
    if (out.some((l) => l.variant.tracking === 'serialized' && !l.unitId)) return setError(new Error('Escolha a unidade (IMEI/série) dos itens que saem.'));
    if (direction === 'customer_pays' && paid !== D) return setError(new Error(`Pagamentos da diferença devem somar ${formatBRL(D)}.`));
    setReview(true);
  };

  return (
    <div>
      <PageHeader title="Nova troca" description="Venda do que sai + compra do que entra, compensadas sem dinheiro. Só a diferença gera cobrança, pagamento ou crédito." />
      <ol className="mb-4 flex flex-wrap gap-2 text-xs" aria-label="Etapas">
        {STEPS.map((s, i) => (
          <li key={s} className={cx('flex items-center gap-2 rounded-full border px-3 py-1', i < step ? 'border-success/40 text-success' : i === step ? 'border-primary bg-primary/15 text-fg' : 'border-line text-muted')} aria-current={i === step ? 'step' : undefined}>
            <span className="tabular">{i + 1}</span>{s}
          </li>
        ))}
      </ol>
      <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
        <div className="flex flex-col gap-4">
          <Card title="1. Cliente" description="A mesma pessoa recebe o que sai e entrega o que entra. Documento recomendado para rastrear a aquisição de usados.">
            <PartyPicker value={party} onChange={setParty} label="Cliente" required />
          </Card>
          <Card title={<span className="flex items-center gap-2"><ArrowUpRight className="size-4 text-primary-soft" />2. Produtos entregues ao cliente</span>} description="Saem do estoque ao custo histórico (venda).">
            <ProductPicker onPick={(v) => setOut((s) => [...s, lineFromVariant(v)])} />
            <div className="mt-3"><SaleLines lines={out} onChange={setOut} showCost={showCost} /></div>
            {out.length > 0 && <div className="mt-3 w-48"><Field label="Desconto na saída" htmlFor="tdisc"><MoneyInput id="tdisc" value={discount} onChange={setDiscount} /></Field></div>}
          </Card>
          <Card title={<span className="flex items-center gap-2"><ArrowDownLeft className="size-4 text-success" />3. Produtos recebidos do cliente</span>} description="Cada item recebido tem avaliação própria, que vira o custo de aquisição dele. Custos futuros estimados não entram como realizados.">
            <div className="flex flex-col gap-4">
              {incoming.map((it, i) => (
                <div key={it.key} className="rounded-xl border border-line bg-bg p-3">
                  <div className="mb-3 flex items-center justify-between">
                    <span className="text-sm font-medium">Item recebido {i + 1}</span>
                    {incoming.length > 1 && <Button variant="quiet" size="sm" onClick={() => setIncoming(incoming.filter((_, j) => j !== i))} aria-label="Remover item recebido"><Trash2 className="size-4" /></Button>}
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="sm:col-span-2">
                      {it.existing ? (
                        <div className="flex items-center justify-between rounded-xl border border-line px-3 py-2 text-sm"><span>{it.existing.name} · {it.existing.sku}</span><button className="text-xs text-muted hover:text-fg" onClick={() => setInc(i, { existing: null })}>trocar</button></div>
                      ) : (
                        <div className="flex flex-col gap-2">
                          <ProductPicker includeInactive placeholder="Produto já cadastrado (opcional)…" onPick={(v) => setInc(i, { existing: v, tracking: v.tracking === 'serialized' ? 'serialized' : 'quantity' })} />
                          <div className="grid gap-2 sm:grid-cols-3">
                            <Input aria-label="Nome do produto recebido" placeholder="Ou cadastre: nome (ex.: Celular usado 128 GB)" value={it.newName} onChange={(e) => setInc(i, { newName: e.target.value })} className="sm:col-span-2" />
                            <Select aria-label="Categoria" value={it.newCategoryId} onChange={(e) => setInc(i, { newCategoryId: e.target.value })}><option value="">Categoria</option>{cats.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
                          </div>
                          <Select aria-label="Controle" value={it.tracking} onChange={(e) => setInc(i, { tracking: e.target.value as Incoming['tracking'] })} className="sm:w-72"><option value="serialized">Por unidade (IMEI/série)</option><option value="quantity">Por quantidade</option></Select>
                        </div>
                      )}
                    </div>
                    <Field label="Valor acordado (avaliação)" htmlFor={`agr-${it.key}`} required help="Compõe o total recebido (P) e o custo inicial do item."><MoneyInput id={`agr-${it.key}`} value={it.agreedCents} onChange={(c) => setInc(i, { agreedCents: c })} /></Field>
                    {it.tracking === 'quantity' && !it.existing?.tracking?.includes('serial') ? (
                      <Field label="Quantidade" htmlFor={`qty-${it.key}`}><Input id={`qty-${it.key}`} type="number" min={1} value={it.quantity} onChange={(e) => setInc(i, { quantity: Math.max(1, Number(e.target.value) || 1) })} /></Field>
                    ) : (
                      <Field label="Condição" htmlFor={`cond-${it.key}`}><Select id={`cond-${it.key}`} value={it.condition} onChange={(e) => setInc(i, { condition: e.target.value })}><option value="used">Usado</option><option value="refurbished">Recondicionado</option><option value="defective">Com defeito</option><option value="new">Novo</option></Select></Field>
                    )}
                    {(it.tracking === 'serialized' || it.existing?.tracking === 'serialized') && (
                      <>
                        <div className="grid grid-cols-3 gap-2 sm:col-span-2">
                          <Input aria-label="IMEI 1" placeholder="IMEI 1" value={it.imei1} onChange={(e) => setInc(i, { imei1: e.target.value })} />
                          <Input aria-label="IMEI 2" placeholder="IMEI 2" value={it.imei2} onChange={(e) => setInc(i, { imei2: e.target.value })} />
                          <Input aria-label="Número de série" placeholder="Série" value={it.serial} onChange={(e) => setInc(i, { serial: e.target.value })} />
                        </div>
                        <Input aria-label="Bateria %" placeholder="Saúde da bateria %" inputMode="numeric" value={it.battery} onChange={(e) => setInc(i, { battery: e.target.value.replace(/\D/g, '').slice(0, 3) })} />
                        <Input aria-label="Acessórios" placeholder="Acessórios entregues" value={it.accessories} onChange={(e) => setInc(i, { accessories: e.target.value })} />
                        <div className="sm:col-span-2"><Textarea aria-label="Defeitos" placeholder="Defeitos observados" value={it.defects} onChange={(e) => setInc(i, { defects: e.target.value })} className="min-h-12" /></div>
                        <fieldset className="sm:col-span-2">
                          <legend className="mb-1 text-xs text-muted">Checklist de inspeção (registro manual do operador)</legend>
                          <div className="flex flex-wrap gap-3 text-xs">{CHECKS.map(([k, l]) => (
                            <label key={k} className="flex items-center gap-1.5"><input type="checkbox" className="accent-[var(--color-primary)]" checked={!!it.checklist[k]} onChange={(e) => setInc(i, { checklist: { ...it.checklist, [k]: e.target.checked } })} />{l}</label>
                          ))}</div>
                        </fieldset>
                      </>
                    )}
                    <Field label="Custo adicional previsto (simulação)" htmlFor={`est-${it.key}`} help="Ex.: reparo. Não entra no custo até ser realizado."><MoneyInput id={`est-${it.key}`} value={it.estimatedExtraCostCents} onChange={(c) => setInc(i, { estimatedExtraCostCents: c })} /></Field>
                    <Field label="Preço futuro sugerido" htmlFor={`sug-${it.key}`}><MoneyInput id={`sug-${it.key}`} value={it.suggestedPriceCents} onChange={(c) => setInc(i, { suggestedPriceCents: c })} /></Field>
                    <Field label="Destino" htmlFor={`dst-${it.key}`}><Select id={`dst-${it.key}`} value={it.destination} onChange={(e) => setInc(i, { destination: e.target.value as Incoming['destination'] })}><option value="inspection">Inspeção / quarentena</option><option value="available">Disponível para venda</option></Select></Field>
                  </div>
                </div>
              ))}
              <div><Button variant="secondary" size="sm" onClick={() => setIncoming([...incoming, blankIncoming()])}><Plus className="size-4" />Adicionar item recebido</Button></div>
            </div>
          </Card>
          <Card title="4. Diferença" description={direction === 'even' ? 'Sem diferença: nenhum pagamento de nenhum lado.' : direction === 'customer_pays' ? 'O cliente paga a diferença à empresa.' : 'A empresa paga a diferença ao cliente.'}>
            {direction === 'customer_pays' && <PaymentsEditor value={payments} onChange={setPayments} totalCents={D} today={today} showFees={showCost} />}
            {direction === 'company_pays' && (
              <div className="flex flex-col gap-3">
                <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Destino da diferença">
                  {([['pay', 'Pagar ao cliente', 'Conta a pagar (padrão) ou pagamento imediato.'], ['store_credit', 'Crédito da loja', 'Passivo da empresa; caixa não se altera agora.']] as const).map(([v, l, h]) => (
                    <button key={v} type="button" role="radio" aria-checked={companyPolicy === v} onClick={() => setCompanyPolicy(v)} className={cx('rounded-xl border p-3 text-left text-sm', companyPolicy === v ? 'border-primary bg-primary/10' : 'border-line hover:border-line-strong')}>
                      <span className="block font-medium">{l}</span><span className="text-xs text-muted">{h}</span>
                    </button>
                  ))}
                </div>
                {companyPolicy === 'pay' && (
                  <div className="flex flex-col gap-2 text-sm">
                    <label className="flex items-center gap-2"><input type="checkbox" className="accent-[var(--color-primary)]" checked={payNow} onChange={(e) => setPayNow(e.target.checked)} />Pagar agora (senão fica em Contas a pagar)</label>
                    {payNow && (
                      <div className="grid grid-cols-2 gap-2">
                        <Select aria-label="Conta de saída" value={payAccount} onChange={(e) => setPayAccount(e.target.value)}>{accounts.data?.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select>
                        <Select aria-label="Meio" value={payMethod} onChange={(e) => setPayMethod(e.target.value)}>{['pix', 'cash', 'bank_transfer'].map((m) => <option key={m} value={m}>{KIND_LABEL[m]}</option>)}</Select>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
            {direction === 'even' && <p className="text-sm text-muted">Estoque recebido entra pela avaliação; caixa não se move.</p>}
            <div className="mt-3"><Field label="Observações da negociação" htmlFor="tnotes"><Input id="tnotes" value={notes} onChange={(e) => setNotes(e.target.value)} /></Field></div>
          </Card>
        </div>
        <aside className="xl:sticky xl:top-20 xl:self-start">
          <Card title={<span className="flex items-center gap-2"><Scale className="size-4 text-primary-soft" />Resumo da troca</span>}>
            <dl className="flex flex-col gap-2 text-sm">
              <div className="flex justify-between"><dt className="text-muted">Saída ao cliente (S)</dt><dd className="tabular">{formatBRL(S)}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">Entrada avaliada (P)</dt><dd className="tabular">{formatBRL(P)}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">Compensado sem dinheiro</dt><dd className="tabular">{formatBRL(S < P ? S : P)}</dd></div>
            </dl>
            <div className={cx('mt-4 rounded-xl border p-3', direction === 'customer_pays' ? 'border-success/40 bg-success/5' : direction === 'company_pays' ? 'border-warning/40 bg-warning/5' : 'border-line bg-bg')} role="status" aria-live="polite">
              <p className="text-xs uppercase tracking-wide text-muted">Diferença</p>
              <p className="text-2xl font-semibold tabular">{formatBRL(D < 0n ? -D : D)}</p>
              <p className="text-sm">{direction === 'customer_pays' ? 'Cliente paga à empresa' : direction === 'company_pays' ? (policy === 'store_credit' ? 'Empresa concede crédito da loja ao cliente' : 'Empresa paga ao cliente') : 'Ninguém paga nada'}</p>
            </div>
            <ul className="mt-4 flex flex-col gap-1.5 text-xs text-muted">
              <li>Estoque: sai(em) {out.reduce((a, l) => a + l.quantity, 0)} item(ns); entra(m) {incoming.reduce((a, i) => a + (i.tracking === 'serialized' ? 1 : i.quantity), 0)} {incoming.some((i) => i.destination === 'inspection') ? '(em inspeção)' : ''}</li>
              <li>Caixa agora: {direction === 'customer_pays' ? `+${formatBRL(paymentsToApi(payments).filter((p) => p.settleNow && ['cash', 'pix', 'bank_transfer'].includes(p.kind)).reduce((a, p) => a + BigInt(p.amountCents), 0n))}` : direction === 'company_pays' && policy === 'pay' && payNow ? `−${formatBRL(-D)}` : formatBRL(0n)}</li>
              {sim.data?.estimatedExtraCostsCents && sim.data.estimatedExtraCostsCents !== '0' && <li>Custos previstos (não realizados): {formatBRL(sim.data.estimatedExtraCostsCents)}</li>}
            </ul>
            {showCost && sim.data?.projected && (
              <div className="mt-4 rounded-xl border border-line bg-bg p-3 text-sm">
                <div className="flex justify-between"><span className="text-muted">Custo histórico do que sai</span><span className="tabular">{formatBRL(sim.data.projected.outgoingCostCents)}</span></div>
                <div className="flex justify-between font-medium text-success"><span>Resultado bruto da venda</span><span className="tabular">{formatBRL(sim.data.projected.grossProfitCents)}</span></div>
                <p className="mt-1 text-[11px] text-muted">Calculado sobre S, não só sobre a diferença.</p>
              </div>
            )}
            {sim.error && <p className="mt-3 text-xs text-warning">{(sim.error as Error).message}</p>}
            <div className="mt-4"><FormError error={error} /></div>
            <Button className="mt-4 w-full" onClick={openReview} disabled={!ready}>Revisar troca</Button>
          </Card>
        </aside>
      </div>
      <Modal open={review} onClose={() => setReview(false)} title="Confirmar troca" wide footer={<>
        <Button variant="secondary" onClick={() => setReview(false)}>Voltar</Button>
        <Button loading={saving} onClick={async () => {
          setSaving(true); setError(null);
          try {
            const r = await api<{ tradeId: string; number: string }>('trades', { body, idempotencyKey: key });
            await qc.invalidateQueries();
            toast(`Troca #${r.number} confirmada.`);
            router.push(`/app/trocas/${r.tradeId}`);
          } catch (e) { setError(e); setKey(newKey()); } finally { setSaving(false); }
        }}>Confirmar troca</Button>
      </>}>
        <div className="grid gap-4 text-sm sm:grid-cols-2">
          <div><p className="mb-1 font-medium">Entregue a {party?.name}</p><ul className="text-muted">{out.map((l) => <li key={l.key}>{l.quantity}× {l.variant.name}{l.unitCode ? ` (${l.unitCode})` : ''} — {formatBRL(BigInt(l.unitPriceCents || '0') * BigInt(l.quantity))}</li>)}</ul></div>
          <div><p className="mb-1 font-medium">Recebido de {party?.name}</p><ul className="text-muted">{incoming.map((i) => <li key={i.key}>{i.existing?.name ?? i.newName}{i.imei1 ? ` (IMEI ${i.imei1})` : ''} — {formatBRL(i.agreedCents || '0')} · {i.destination === 'inspection' ? 'inspeção' : 'disponível'}</li>)}</ul></div>
          <div className="sm:col-span-2 rounded-xl border border-line bg-bg p-3">
            <p>S {formatBRL(S)} − P {formatBRL(P)} = <strong>{formatBRL(D)}</strong> · <Badge tone={direction === 'even' ? 'neutral' : direction === 'customer_pays' ? 'success' : 'warning'}>{direction === 'customer_pays' ? 'cliente paga' : direction === 'company_pays' ? (policy === 'store_credit' ? 'crédito da loja' : 'empresa paga') : 'sem diferença'}</Badge></p>
            <p className="mt-1 text-xs text-muted">Serão criados numa única operação: venda, compra vinculada, compensação de {formatBRL(S < P ? S : P)}, entrada do(s) item(ns) recebido(s) e somente o movimento financeiro da diferença. Documento “Resumo da troca” e “Termo de aquisição” serão gerados.</p>
          </div>
          <div className="sm:col-span-2"><FormError error={error} /></div>
        </div>
      </Modal>
    </div>
  );
}
