'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { PackagePlus } from 'lucide-react';
import { formatBRL } from '@gct/shared';
import { Button, cx, ErrorState, Field, FormError, Input, LoadingBlock, Modal, MoneyInput, Select, Textarea } from '@/components/ui';
import { useAccounts } from '@/components/ops/hooks';
import { useToast } from '@/components/toast';
import { api, newKey, qs } from '@/lib/client/api';
import { useCan } from '@/lib/client/session';

interface ProductLite {
  id: string; name: string; kind: string; tracking: string;
  variants: { id: string; sku: string; label: string; onHand: number }[];
  units?: { costCents?: string | null }[];
  unitCostCents?: string | null;
}

/**
 * Entrada de estoque de um produto já cadastrado (reposição). Por trás vira uma compra
 * (paga agora ou a pagar) ou um saldo inicial, exatamente como no cadastro do produto.
 */
export function StockEntryModal({ productId, onClose }: { productId: string; onClose: () => void }) {
  const can = useCan();
  const qc = useQueryClient();
  const toast = useToast();
  const accounts = useAccounts();
  const product = useQuery({ queryKey: ['product', productId], queryFn: () => api<ProductLite>(`products/${productId}`) });
  const suppliers = useQuery({ queryKey: ['parties', 'supplier'], queryFn: () => api<{ data: { id: string; name: string }[] }>(`parties${qs({ role: 'supplier', limit: 100 })}`) });
  const [key] = useState(newKey);
  const [variantId, setVariantId] = useState('');
  const [qty, setQty] = useState('1');
  const [imeis, setImeis] = useState('');
  const [cost, setCost] = useState('');
  const canBuy = can('purchases.manage');
  const [origin, setOrigin] = useState<'paid' | 'payable' | 'opening'>(canBuy ? 'paid' : 'opening');
  const [supplierId, setSupplierId] = useState('');
  const [supplierName, setSupplierName] = useState('');
  const [date, setDate] = useState(() => new Date().toLocaleDateString('en-CA'));
  const [accountId, setAccountId] = useState('');
  const [method, setMethod] = useState('pix');
  const [dueDate, setDueDate] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const p = product.data;
  useEffect(() => { if (p && !variantId) setVariantId(p.variants[0]?.id ?? ''); }, [p, variantId]);
  const serialized = p?.tracking === 'serialized';
  const imeiList = imeis.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean);
  const quantity = serialized ? imeiList.length : Number(qty || 0);
  const total = cost ? BigInt(cost) * BigInt(quantity) : 0n;

  const submit = async () => {
    setError(null);
    if (quantity <= 0) return setError(new Error(serialized ? 'Informe ao menos um IMEI/série.' : 'Informe a quantidade.'));
    if (!cost) return setError(new Error('Informe o custo por unidade.'));
    if (origin !== 'opening' && !supplierId && !supplierName.trim()) return setError(new Error('Escolha ou digite o fornecedor.'));
    if (origin === 'payable' && !dueDate) return setError(new Error('Informe o vencimento.'));
    setBusy(true);
    try {
      await api(`products/${productId}/stock-entry`, {
        idempotencyKey: key,
        body: {
          entries: [{ variantId, quantity, unitCostCents: cost, ...(serialized ? { units: imeiList.map((v) => ({ identifiers: [{ kind: 'imei1', value: v }] })) } : {}) }],
          notes: notes.trim() || null,
          source: origin === 'opening'
            ? { mode: 'opening' }
            : { mode: 'purchase', supplierId: supplierId || null, supplierName: supplierId ? null : supplierName.trim(), purchaseDate: date,
                paymentTerms: origin === 'paid' ? { mode: 'pay_now', accountId: accountId || accounts.data?.[0]?.id, method } : { mode: 'due', dueDate } },
        },
      });
      await qc.invalidateQueries();
      toast(`Entrada de ${quantity} unidade(s) registrada.`);
      onClose();
    } catch (e) { setError(e); } finally { setBusy(false); }
  };

  return (
    <Modal open onClose={onClose} title={p ? `Entrada de estoque · ${p.name}` : 'Entrada de estoque'} footer={<>
      <Button variant="secondary" onClick={onClose}>Cancelar</Button>
      <Button loading={busy} disabled={!p} onClick={submit}><PackagePlus className="size-4" />Dar entrada{quantity > 0 ? ` (${quantity})` : ''}</Button>
    </>}>
      {product.isLoading && <LoadingBlock rows={4} />}
      {product.error && <ErrorState error={product.error} retry={() => product.refetch()} />}
      {p && (
        <div className="flex flex-col gap-4">
          {p.variants.length > 1 && (
            <Field label="Variação" htmlFor="se-var">
              <Select id="se-var" value={variantId} onChange={(e) => setVariantId(e.target.value)}>{p.variants.map((v) => <option key={v.id} value={v.id}>{v.label || v.sku} · {v.onHand} em estoque</option>)}</Select>
            </Field>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            {serialized ? (
              <div className="sm:col-span-2"><Field label="IMEI ou série de cada unidade" htmlFor="se-imeis" help={`${imeiList.length} unidade(s) · um por linha`}><Textarea id="se-imeis" rows={3} value={imeis} onChange={(e) => setImeis(e.target.value)} /></Field></div>
            ) : (
              <Field label="Quantidade" htmlFor="se-qty"><Input id="se-qty" type="number" min={1} max={1000000} value={qty} onChange={(e) => setQty(e.target.value)} /></Field>
            )}
            <Field label="Custo por unidade" htmlFor="se-cost" help={total > 0n ? `Total ${formatBRL(total.toString())}` : 'Quanto você pagou em cada uma'}><MoneyInput id="se-cost" value={cost} onChange={setCost} /></Field>
          </div>
          <div>
            <p className="mb-1.5 text-xs font-medium text-muted">Como essa mercadoria entrou?</p>
            <div role="radiogroup" aria-label="Origem do estoque" className="grid gap-2 sm:grid-cols-3">
              {([
                ['paid', 'Comprei e já paguei', 'Sai do caixa agora', canBuy],
                ['payable', 'Comprei para pagar depois', 'Vira conta a pagar', canBuy],
                ['opening', 'Já tinha na loja', 'Não mexe no caixa', can('inventory.adjust')],
              ] as const).map(([id, title, hint, allowed]) => (
                <button key={id} type="button" role="radio" aria-checked={origin === id} disabled={!allowed} onClick={() => setOrigin(id)}
                  className={cx('rounded-xl border p-3 text-left disabled:cursor-not-allowed disabled:opacity-40', origin === id ? 'border-primary bg-primary/10 ring-1 ring-primary' : 'border-line bg-bg hover:border-line-strong')}>
                  <span className="block text-sm font-medium">{title}</span><span className="text-xs text-muted">{hint}</span>
                </button>
              ))}
            </div>
          </div>
          {origin !== 'opening' && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Fornecedor" htmlFor="se-sup">
                <Select id="se-sup" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
                  <option value="">{supplierName ? 'Novo fornecedor (digitado ao lado)' : 'Selecione…'}</option>
                  {suppliers.data?.data.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </Select>
              </Field>
              <Field label="Ou digite um fornecedor novo" htmlFor="se-supname"><Input id="se-supname" maxLength={160} disabled={!!supplierId} value={supplierName} onChange={(e) => setSupplierName(e.target.value)} /></Field>
              <Field label="Data da compra" htmlFor="se-date"><Input id="se-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
              {origin === 'paid' ? (
                <div className="grid grid-cols-2 gap-2">
                  {(accounts.data?.length ?? 0) > 1 && <Field label="Conta" htmlFor="se-acc"><Select id="se-acc" value={accountId} onChange={(e) => setAccountId(e.target.value)}>{accounts.data?.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select></Field>}
                  <Field label="Pago com" htmlFor="se-method"><Select id="se-method" value={method} onChange={(e) => setMethod(e.target.value)}><option value="pix">Pix</option><option value="cash">Dinheiro</option><option value="debit">Débito</option><option value="credit">Crédito</option><option value="bank_transfer">Transferência</option><option value="boleto">Boleto</option></Select></Field>
                </div>
              ) : <Field label="Vencimento" htmlFor="se-due"><Input id="se-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></Field>}
            </div>
          )}
          <Field label="Observações" htmlFor="se-notes"><Input id="se-notes" maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Opcional" /></Field>
          <p className="text-xs text-muted">{origin === 'opening' ? 'Entra no estoque com o custo informado, sem compra e sem mexer no caixa.' : 'Fica registrada uma compra em Compras e o custo entra no estoque.'}</p>
          <FormError error={error} />
        </div>
      )}
    </Modal>
  );
}
