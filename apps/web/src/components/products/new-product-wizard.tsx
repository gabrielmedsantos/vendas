'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, ImagePlus, Plus, Sparkles, Trash2, Upload, X } from 'lucide-react';
import { formatBRL, formatPercentBps, marginBpsOf, parsePercentBps, priceForMarginBps } from '@gct/shared';
import { Button, cx, Field, FormError, Input, MoneyInput, Select, Textarea } from '@/components/ui';
import { useAccounts, useCategories } from '@/components/ops/hooks';
import { api, ApiError, newKey, qs } from '@/lib/client/api';

type Step = 'geral' | 'preco' | 'estoque' | 'variacoes' | 'origem';
const STEPS: { id: Step; label: string }[] = [
  { id: 'geral', label: 'Geral' },
  { id: 'preco', label: 'Preço' },
  { id: 'estoque', label: 'Estoque' },
  { id: 'variacoes', label: 'Variações' },
  { id: 'origem', label: 'Origem do estoque' },
];

interface Row { key: string; label: string; sku: string; priceCents: string; costCents: string; qty: string; minStock: string }
const newRow = (r: Partial<Row> = {}): Row => ({ key: Math.random().toString(36).slice(2), label: '', sku: '', priceCents: '', costCents: '', qty: '', minStock: '', ...r });

/** SKU curto a partir do nome: "Poltrona Inflável" → POL-INF-4821. */
function makeSku(name: string, suffix = ''): string {
  const base = name.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w.slice(0, 3)).join('-') || 'PRD';
  return `${base}${suffix ? `-${suffix}` : ''}-${String(Math.floor(1000 + Math.random() * 9000))}`;
}

const cents = (v: string) => (v ? BigInt(v) : 0n);

export function NewProductWizard({ warrantyMonths, onCreated }: { warrantyMonths: number; onCreated: (id: string) => void }) {
  const qc = useQueryClient();
  const cats = useCategories();
  const accounts = useAccounts();
  const suppliers = useQuery({ queryKey: ['parties', 'supplier'], queryFn: () => api<{ data: { id: string; name: string }[] }>(`parties${qs({ role: 'supplier', limit: 100 })}`) });
  const [step, setStep] = useState<Step>('geral');
  const [key] = useState(newKey);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [photos, setPhotos] = useState<{ file: File; url: string }[]>([]);

  // Geral
  const [kind, setKind] = useState<'physical' | 'service'>('physical');
  const [tracking, setTracking] = useState<'quantity' | 'serialized'>('quantity');
  const [name, setName] = useState('');
  const [brand, setBrand] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [newCat, setNewCat] = useState<string | null>(null);
  const [status, setStatus] = useState<'active' | 'inactive'>('active');
  const [condition, setCondition] = useState('new');
  const [warranty, setWarranty] = useState(String(warrantyMonths * 30));
  const [description, setDescription] = useState('');
  // Preço (produto sem variações)
  const [cost, setCost] = useState('');
  const [marginText, setMarginText] = useState('');
  const [price, setPrice] = useState('');
  const [wholesale, setWholesale] = useState('');
  const [wholesaleMin, setWholesaleMin] = useState('');
  // Estoque
  const [qty, setQty] = useState('');
  const [alert, setAlert] = useState(false);
  const [minStock, setMinStock] = useState('2');
  const [sku, setSku] = useState('');
  const [barcode, setBarcode] = useState('');
  const [imeis, setImeis] = useState('');
  // Variações
  const [hasVariants, setHasVariants] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  // Origem
  const [origin, setOrigin] = useState<'paid' | 'payable' | 'opening'>('paid');
  const [supplierId, setSupplierId] = useState('');
  const [supplierName, setSupplierName] = useState('');
  const [purchaseDate, setPurchaseDate] = useState(() => new Date().toLocaleDateString('en-CA'));
  const [accountId, setAccountId] = useState('');
  const [method, setMethod] = useState('pix');
  const [dueDate, setDueDate] = useState('');
  const [notes, setNotes] = useState('');

  const physical = kind === 'physical';
  const serialized = physical && tracking === 'serialized';
  const imeiList = imeis.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean);
  const singleQty = serialized ? imeiList.length : Number(qty || 0);
  const totalQty = physical ? (hasVariants ? rows.reduce((a, r) => a + Number(r.qty || 0), 0) : singleQty) : 0;
  const stockCost = hasVariants ? rows.reduce((a, r) => a + cents(r.costCents || cost) * BigInt(Number(r.qty || 0)), 0n) : cents(cost) * BigInt(singleQty);
  const margin = useMemo(() => (price ? marginBpsOf(cents(price), cents(cost)) : null), [price, cost]);
  const steps = STEPS.filter((s) => physical || (s.id !== 'estoque' && s.id !== 'origem'));
  const idx = steps.findIndex((s) => s.id === step);

  const applyMargin = (text: string) => {
    setMarginText(text);
    const bps = parsePercentBps(text);
    if (bps !== null && cost) { const p = priceForMarginBps(cents(cost), bps); if (p !== null) setPrice(p.toString()); }
  };

  const validate = (): { step: Step; message: string } | null => {
    if (!name.trim()) return { step: 'geral', message: 'Informe o nome do produto.' };
    if (!hasVariants && !price) return { step: 'preco', message: 'Informe o preço de venda.' };
    if (hasVariants && rows.length === 0) return { step: 'variacoes', message: 'Adicione ao menos uma variação.' };
    if (hasVariants && rows.some((r) => !r.label.trim() || !(r.priceCents || price))) return { step: 'variacoes', message: 'Cada variação precisa de nome e preço.' };
    if (totalQty > 0 && !hasVariants && !cost) return { step: 'preco', message: 'Informe o custo para lançar o estoque inicial.' };
    if (totalQty > 0 && origin !== 'opening' && !supplierId && !supplierName.trim()) return { step: 'origem', message: 'Escolha ou digite o fornecedor.' };
    if (totalQty > 0 && origin === 'payable' && !dueDate) return { step: 'origem', message: 'Informe o vencimento do pagamento.' };
    return null;
  };

  const submit = async () => {
    const problem = validate();
    if (problem) { setStep(problem.step); setError(new Error(problem.message)); return; }
    setBusy(true); setError(null);
    try {
      const baseSku = sku.trim() || makeSku(name);
      const variants = hasVariants
        ? rows.map((r, i) => ({ sku: r.sku.trim() || makeSku(name, String(i + 1)), label: r.label.trim(), retailPriceCents: r.priceCents || price || '0', minStock: alert ? Number(r.minStock || minStock || 0) : 0 }))
        : [{ sku: baseSku, barcode: barcode.trim() || null, label: '', retailPriceCents: price, wholesalePriceCents: wholesale || null, wholesaleMinQty: wholesale && wholesaleMin ? Number(wholesaleMin) : null, minStock: alert ? Number(minStock || 0) : 0 }];
      const entries = !physical ? [] : hasVariants
        ? rows.map((r, i) => ({ variantIndex: i, quantity: Number(r.qty || 0), unitCostCents: r.costCents || cost || '0' })).filter((e) => e.quantity > 0)
        : singleQty > 0 ? [{ variantIndex: 0, quantity: singleQty, unitCostCents: cost || '0', ...(serialized ? { units: imeiList.map((v) => ({ identifiers: [{ kind: 'imei1', value: v }], condition: condition || null })) } : {}) }] : [];
      const body = {
        product: {
          kind, tracking: physical ? tracking : 'none', name: name.trim(), brand: brand.trim() || null, categoryId: categoryId || null, status,
          conditionDefault: physical ? condition || null : null, warrantyDays: Number(warranty || 0), identifierKinds: serialized ? ['imei1'] : [],
          description: description.trim() || null, variants,
        },
        stock: entries.length
          ? {
              entries,
              notes: notes.trim() || null,
              source: origin === 'opening'
                ? { mode: 'opening' }
                : {
                    mode: 'purchase', supplierId: supplierId || null, supplierName: supplierId ? null : supplierName.trim(), purchaseDate,
                    paymentTerms: origin === 'paid' ? { mode: 'pay_now', accountId: accountId || accounts.data?.[0]?.id, method } : { mode: 'due', dueDate },
                  },
            }
          : null,
      };
      const r = await api<{ id: string }>('products/with-stock', { body, idempotencyKey: key });
      for (const p of photos) {
        const fd = new FormData();
        fd.append('file', p.file);
        const res = await fetch(`/api/v1/products/${r.id}/images`, { method: 'POST', body: fd, credentials: 'same-origin' });
        if (!res.ok) { const e = (await res.json()).error; throw new ApiError(res.status, e.code, `Produto cadastrado, mas a foto "${p.file.name}" falhou: ${e.message}`, e.fields, e.requestId); }
      }
      await qc.invalidateQueries();
      onCreated(r.id);
    } catch (e) { setError(e); } finally { setBusy(false); }
  };

  const tab = (s: { id: Step; label: string }, i: number) => (
    <button key={s.id} type="button" role="tab" aria-selected={step === s.id} onClick={() => { setStep(s.id); setError(null); }}
      className={cx('flex flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors', step === s.id ? 'bg-surface-3 text-fg shadow-sm' : 'text-muted hover:text-fg')}>
      <span className={cx('flex size-5 items-center justify-center rounded-full text-[11px]', step === s.id ? 'bg-primary text-white' : i < idx ? 'bg-primary/20 text-primary-soft' : 'bg-surface-3')}>{i < idx ? <Check className="size-3" /> : i + 1}</span>
      {s.label}
    </button>
  );

  return (
    <div className="rounded-[var(--radius-card)] border border-line bg-surface">
      <div role="tablist" aria-label="Etapas do cadastro" className="m-3 flex gap-1 overflow-x-auto rounded-xl border border-line bg-bg p-1">{steps.map(tab)}</div>
      <div className="p-4 pt-2 sm:p-6 sm:pt-3">
        {step === 'geral' && (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Tipo de item" htmlFor="np-kind" help={physical ? 'Mercadoria com estoque' : 'Mão de obra, sem estoque'}>
                <Select id="np-kind" value={kind} onChange={(e) => setKind(e.target.value as 'physical' | 'service')}><option value="physical">Produto físico</option><option value="service">Serviço</option></Select>
              </Field>
              <Field label="Situação" htmlFor="np-status" help={status === 'active' ? 'Aparece na tela de vendas' : 'Escondido nas vendas'}>
                <Select id="np-status" value={status} onChange={(e) => setStatus(e.target.value as 'active' | 'inactive')}><option value="active">Ativo</option><option value="inactive">Inativo</option></Select>
              </Field>
              <div className="sm:col-span-2"><Field label="Nome do produto" htmlFor="np-name" required><Input id="np-name" autoFocus maxLength={160} value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Poltrona Inflável com Pufe" /></Field></div>
              <Field label="Marca" htmlFor="np-brand"><Input id="np-brand" maxLength={80} value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="Opcional" /></Field>
              <Field label="Categoria" htmlFor="np-cat">
                {newCat === null ? (
                  <div className="flex gap-2">
                    <Select id="np-cat" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}><option value="">Sem categoria</option>{cats.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
                    <Button type="button" variant="secondary" onClick={() => setNewCat('')} aria-label="Criar categoria"><Plus className="size-4" /></Button>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <Input id="np-cat" autoFocus placeholder="Nome da nova categoria" value={newCat} onChange={(e) => setNewCat(e.target.value)} />
                    <Button type="button" variant="secondary" disabled={!newCat.trim()} onClick={async () => {
                      try { const c = await api<{ id: string }>('categories', { body: { name: newCat.trim() } }); await qc.invalidateQueries({ queryKey: ['categories'] }); setCategoryId(c.id); setNewCat(null); } catch (e) { setError(e); }
                    }}>Criar</Button>
                    <Button type="button" variant="quiet" aria-label="Cancelar nova categoria" onClick={() => setNewCat(null)}><X className="size-4" /></Button>
                  </div>
                )}
              </Field>
              {physical && (
                <Field label="Condição" htmlFor="np-cond">
                  <Select id="np-cond" value={condition} onChange={(e) => setCondition(e.target.value)}><option value="new">Novo</option><option value="used">Seminovo / usado</option><option value="refurbished">Recondicionado</option></Select>
                </Field>
              )}
              <Field label="Garantia da loja" htmlFor="np-war">
                <Select id="np-war" value={warranty} onChange={(e) => setWarranty(e.target.value)}>
                  <option value="0">Sem garantia</option>{[30, 60, 90, 180, 365].map((d) => <option key={d} value={String(d)}>{d === 365 ? '1 ano' : `${d / 30} ${d === 30 ? 'mês' : 'meses'}`}</option>)}
                  {![0, 30, 60, 90, 180, 365].includes(Number(warranty)) && <option value={warranty}>{warranty} dias</option>}
                </Select>
              </Field>
              <div className="sm:col-span-2"><Field label="Descrição" htmlFor="np-desc"><Textarea id="np-desc" rows={3} maxLength={4000} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Detalhes para catálogo, anúncio ou uso interno" /></Field></div>
            </div>
            <div>
              <p className="mb-1.5 text-xs font-medium text-muted">Fotos do produto</p>
              <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" multiple className="sr-only" aria-label="Fotos do produto"
                onChange={(e) => { const fs = Array.from(e.target.files ?? []).slice(0, 10 - photos.length); setPhotos((p) => [...p, ...fs.map((file) => ({ file, url: URL.createObjectURL(file) }))]); e.target.value = ''; }} />
              <button type="button" onClick={() => fileInput.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); const fs = Array.from(e.dataTransfer.files).filter((f) => /image\/(jpeg|png|webp)/.test(f.type)).slice(0, 10 - photos.length); setPhotos((p) => [...p, ...fs.map((file) => ({ file, url: URL.createObjectURL(file) }))]); }}
                className="flex w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-line px-4 py-8 text-center hover:border-primary">
                <Upload className="size-6 text-muted" aria-hidden />
                <span className="text-sm font-medium">Clique ou arraste para adicionar fotos</span>
                <span className="text-xs text-muted">JPG, PNG ou WebP · até 5 MB cada</span>
              </button>
              {photos.length > 0 && (
                <ul className="mt-3 grid grid-cols-3 gap-2">
                  {photos.map((p, i) => (
                    <li key={p.url} className="group relative aspect-square overflow-hidden rounded-lg border border-line">
                      <img src={p.url} alt={`Foto ${i + 1}`} className="size-full object-cover" />
                      {i === 0 && <span className="absolute bottom-1 left-1 rounded bg-black/70 px-1.5 text-[10px] text-white">Capa</span>}
                      <button type="button" aria-label={`Remover foto ${i + 1}`} onClick={() => { URL.revokeObjectURL(p.url); setPhotos((ps) => ps.filter((x) => x !== p)); }} className="absolute right-1 top-1 rounded-full bg-black/70 p-1 text-white"><X className="size-3" /></button>
                    </li>
                  ))}
                  {photos.length < 10 && <li><button type="button" onClick={() => fileInput.current?.click()} className="flex aspect-square w-full items-center justify-center rounded-lg border border-dashed border-line text-muted hover:border-primary" aria-label="Adicionar mais fotos"><ImagePlus className="size-5" /></button></li>}
                </ul>
              )}
            </div>
          </div>
        )}

        {step === 'preco' && (
          <div className="flex max-w-3xl flex-col gap-4">
            {hasVariants && <p className="rounded-xl border border-primary/40 bg-primary/10 p-3 text-sm">Produto com variações: aqui ficam o custo e o preço <strong>padrão</strong>. Cada variação pode ter os seus na etapa Variações.</p>}
            <div className="grid gap-4 sm:grid-cols-2">
              {physical && <Field label="Preço de custo (por unidade)" htmlFor="np-cost" help="Quanto você pagou em cada unidade"><MoneyInput id="np-cost" value={cost} onChange={(c) => { setCost(c); const bps = parsePercentBps(marginText); if (bps !== null && c) { const p = priceForMarginBps(BigInt(c), bps); if (p !== null) setPrice(p.toString()); } }} /></Field>}
              {physical && <Field label="Margem desejada (%)" htmlFor="np-margin" help="Calcula o preço de venda pelo custo"><Input id="np-margin" inputMode="decimal" placeholder="Ex.: 50" value={marginText} onChange={(e) => applyMargin(e.target.value)} /></Field>}
              <Field label="Preço de venda (varejo)" htmlFor="np-price" required><MoneyInput id="np-price" value={price} onChange={(c) => { setPrice(c); setMarginText(''); }} /></Field>
              <Field label="Preço de atacado" htmlFor="np-whole" help="Opcional: na venda aparece a opção atacado"><MoneyInput id="np-whole" value={wholesale} onChange={setWholesale} /></Field>
              {wholesale && <Field label="Atacado a partir de (unidades)" htmlFor="np-wmin"><Input id="np-wmin" type="number" min={1} value={wholesaleMin} onChange={(e) => setWholesaleMin(e.target.value)} /></Field>}
            </div>
            {physical && price && cost && margin !== null && (
              <div className="flex flex-wrap items-center gap-x-6 gap-y-1 rounded-xl border border-line bg-bg p-4 text-sm">
                <span>Margem estimada: <strong className={margin >= 0 ? 'text-success' : 'text-danger-soft'}>{formatPercentBps(margin)}%</strong></span>
                <span>Lucro por unidade: <strong className="tabular">{formatBRL((cents(price) - cents(cost)).toString())}</strong></span>
                {margin < 0 && <span className="text-danger-soft">Preço abaixo do custo.</span>}
              </div>
            )}
          </div>
        )}

        {step === 'estoque' && physical && (
          <div className="flex max-w-3xl flex-col gap-4">
            <Field label="Controle do estoque" htmlFor="np-track" help={serialized ? 'Cada aparelho tem IMEI/série e custo próprio (celulares, usados).' : 'Conta só a quantidade.'}>
              <Select id="np-track" value={tracking} onChange={(e) => setTracking(e.target.value as 'quantity' | 'serialized')}><option value="quantity">Por quantidade</option><option value="serialized">Por unidade (IMEI / série)</option></Select>
            </Field>
            {hasVariants ? (
              <p className="rounded-xl border border-line bg-bg p-3 text-sm text-muted">A quantidade de cada variação é informada na etapa Variações.</p>
            ) : serialized ? (
              <Field label="IMEI ou número de série das unidades em estoque" htmlFor="np-imeis" help={`${imeiList.length} unidade(s). Um por linha. Deixe vazio se ainda não tem nenhuma.`}>
                <Textarea id="np-imeis" rows={4} value={imeis} onChange={(e) => setImeis(e.target.value)} placeholder={'350000000000011\n350000000000022'} />
              </Field>
            ) : (
              <Field label="Estoque atual (quantidade)" htmlFor="np-qty" help="Deixe vazio ou 0 se ainda não tem o produto.">
                <Input id="np-qty" type="number" min={0} max={1000000} value={qty} onChange={(e) => setQty(e.target.value)} />
              </Field>
            )}
            <label className="flex items-center justify-between gap-3 rounded-xl border border-line bg-bg p-4">
              <span><span className="block text-sm font-medium">Alerta de estoque baixo</span><span className="text-xs text-muted">Avisa no Início quando chegar no mínimo</span></span>
              <input type="checkbox" role="switch" aria-label="Alerta de estoque baixo" className="size-5 accent-[var(--color-primary)]" checked={alert} onChange={(e) => setAlert(e.target.checked)} />
            </label>
            {alert && !hasVariants && <Field label="Estoque mínimo" htmlFor="np-min"><Input id="np-min" type="number" min={0} value={minStock} onChange={(e) => setMinStock(e.target.value)} /></Field>}
            {!hasVariants && (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="SKU (código interno)" htmlFor="np-sku" help="Vazio: gerado automaticamente">
                  <div className="flex gap-2"><Input id="np-sku" maxLength={64} value={sku} onChange={(e) => setSku(e.target.value)} placeholder="Ex.: POL-INF-1234" /><Button type="button" variant="secondary" onClick={() => setSku(makeSku(name))}><Sparkles className="size-4" />Gerar</Button></div>
                </Field>
                <Field label="Código de barras (EAN)" htmlFor="np-bar"><Input id="np-bar" maxLength={64} inputMode="numeric" value={barcode} onChange={(e) => setBarcode(e.target.value)} placeholder="Opcional" /></Field>
              </div>
            )}
          </div>
        )}

        {step === 'variacoes' && (
          <div className="flex flex-col gap-4">
            <label className="flex items-start gap-3 rounded-xl border border-line bg-bg p-4">
              <input type="checkbox" className="mt-1 size-4 accent-[var(--color-primary)]" checked={hasVariants} onChange={(e) => { setHasVariants(e.target.checked); if (e.target.checked && rows.length === 0) setRows([newRow({ priceCents: price, costCents: cost }), newRow({ priceCents: price, costCents: cost })]); }} />
              <span><span className="block text-sm font-medium">Produto com variações (cor, tamanho, capacidade…)</span><span className="text-xs text-muted">Cada variação tem nome, preço, custo e estoque próprios. Vazio usa o preço e o custo padrão da etapa Preço.</span></span>
            </label>
            {hasVariants && (
              <>
                <div className="hidden grid-cols-[1.4fr_1fr_1fr_1fr_80px_80px_40px] gap-2 px-1 text-[11px] font-semibold uppercase tracking-wide text-muted md:grid">
                  <span>Variação</span><span>SKU</span><span>Preço</span><span>Custo</span><span>Estoque</span><span>Mínimo</span><span />
                </div>
                <ul className="flex flex-col gap-2">
                  {rows.map((r, i) => {
                    const up = (patch: Partial<Row>) => setRows((rs) => rs.map((x) => (x.key === r.key ? { ...x, ...patch } : x)));
                    return (
                      <li key={r.key} className="grid gap-2 rounded-xl border border-line bg-bg p-2 md:grid-cols-[1.4fr_1fr_1fr_1fr_80px_80px_40px] md:items-center">
                        <Input aria-label={`Variação ${i + 1}`} placeholder="Ex.: Preta 128 GB" value={r.label} onChange={(e) => up({ label: e.target.value })} />
                        <Input aria-label={`SKU da variação ${i + 1}`} placeholder="Automático" value={r.sku} onChange={(e) => up({ sku: e.target.value })} />
                        <MoneyInput ariaLabel={`Preço da variação ${i + 1}`} value={r.priceCents} onChange={(c) => up({ priceCents: c })} />
                        <MoneyInput ariaLabel={`Custo da variação ${i + 1}`} value={r.costCents} onChange={(c) => up({ costCents: c })} />
                        <Input aria-label={`Estoque da variação ${i + 1}`} type="number" min={0} placeholder="0" value={r.qty} disabled={serialized} onChange={(e) => up({ qty: e.target.value })} />
                        <Input aria-label={`Mínimo da variação ${i + 1}`} type="number" min={0} placeholder={alert ? minStock : '—'} disabled={!alert} value={r.minStock} onChange={(e) => up({ minStock: e.target.value })} />
                        <Button type="button" variant="quiet" aria-label={`Remover variação ${i + 1}`} onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}><Trash2 className="size-4" /></Button>
                      </li>
                    );
                  })}
                </ul>
                <div><Button type="button" variant="secondary" size="sm" onClick={() => setRows((rs) => [...rs, newRow({ priceCents: price, costCents: cost })])}><Plus className="size-4" />Adicionar variação</Button></div>
                {serialized && <p className="text-xs text-muted">Produto por IMEI com variações: cadastre as unidades depois, pela compra de cada variação.</p>}
              </>
            )}
          </div>
        )}

        {step === 'origem' && physical && (
          <div className="flex max-w-3xl flex-col gap-4">
            {totalQty === 0 ? (
              <p className="rounded-xl border border-line bg-bg p-4 text-sm text-muted">Sem estoque inicial: o produto será cadastrado zerado. Quando chegar mercadoria, lance em Compras.</p>
            ) : (
              <>
                <p className="text-sm">Entrada de <strong>{totalQty} unidade(s)</strong>{stockCost > 0n && <> · custo total <strong className="tabular">{formatBRL(stockCost.toString())}</strong></>}. Como essa mercadoria entrou?</p>
                <div role="radiogroup" aria-label="Origem do estoque" className="grid gap-2 sm:grid-cols-3">
                  {([
                    ['paid', 'Comprei e já paguei', 'Sai do caixa agora'],
                    ['payable', 'Comprei para pagar depois', 'Vira conta a pagar'],
                    ['opening', 'Já tinha na loja', 'Não entra no fluxo de caixa'],
                  ] as const).map(([id, title, hint]) => (
                    <button key={id} type="button" role="radio" aria-checked={origin === id} onClick={() => setOrigin(id)}
                      className={cx('rounded-xl border p-3 text-left', origin === id ? 'border-primary bg-primary/10 ring-1 ring-primary' : 'border-line bg-bg hover:border-line-strong')}>
                      <span className="block text-sm font-medium">{title}</span><span className="text-xs text-muted">{hint}</span>
                    </button>
                  ))}
                </div>
                {origin !== 'opening' && (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Fornecedor" htmlFor="np-sup" required>
                      <Select id="np-sup" value={supplierId} onChange={(e) => { setSupplierId(e.target.value); setError(null); }}>
                        <option value="">{supplierName ? 'Novo fornecedor (digitado abaixo)' : 'Selecione…'}</option>
                        {suppliers.data?.data.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </Select>
                    </Field>
                    <Field label="Ou digite um fornecedor novo" htmlFor="np-supname"><Input id="np-supname" maxLength={160} disabled={!!supplierId} value={supplierName} onChange={(e) => { setSupplierName(e.target.value); setError(null); }} placeholder="Nome do fornecedor" /></Field>
                    <Field label="Data da compra" htmlFor="np-date"><Input id="np-date" type="date" value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} /></Field>
                    {origin === 'paid' ? (
                      <div className="grid grid-cols-2 gap-2">
                        {(accounts.data?.length ?? 0) > 1 && <Field label="Conta" htmlFor="np-acc"><Select id="np-acc" value={accountId} onChange={(e) => setAccountId(e.target.value)}>{accounts.data?.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select></Field>}
                        <Field label="Pago com" htmlFor="np-method"><Select id="np-method" value={method} onChange={(e) => setMethod(e.target.value)}><option value="pix">Pix</option><option value="cash">Dinheiro</option><option value="debit">Débito</option><option value="credit">Crédito</option><option value="bank_transfer">Transferência</option><option value="boleto">Boleto</option></Select></Field>
                      </div>
                    ) : origin === 'payable' ? (
                      <Field label="Vencimento" htmlFor="np-due" required><Input id="np-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></Field>
                    ) : null}
                  </div>
                )}
                <Field label="Observações internas" htmlFor="np-notes"><Textarea id="np-notes" rows={2} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Visível só no sistema" /></Field>
                <p className="text-xs text-muted">{origin === 'opening' ? 'O estoque entra com o custo informado (para o lucro das vendas ficar certo), sem compra e sem mexer no caixa.' : 'Fica registrada uma compra em Compras, com o termo de compra, e o custo vai para o estoque.'}</p>
              </>
            )}
          </div>
        )}

        <div className="mt-6"><FormError error={error} /></div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-4">
          <Button type="button" variant="secondary" disabled={idx <= 0} onClick={() => setStep(steps[idx - 1]!.id)}><ArrowLeft className="size-4" />Voltar</Button>
          <div className="flex gap-2">
            {idx < steps.length - 1 && <Button type="button" variant="secondary" onClick={() => setStep(steps[idx + 1]!.id)}>Próximo<ArrowRight className="size-4" /></Button>}
            <Button type="button" loading={busy} onClick={submit}><Check className="size-4" />Cadastrar{totalQty > 0 ? ` com ${totalQty} em estoque` : ''}</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
