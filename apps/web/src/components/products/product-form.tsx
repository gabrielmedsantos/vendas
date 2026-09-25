'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button, Card, Field, FormError, Input, MoneyInput, Select, Textarea } from '@/components/ui';
import { useCategories } from '@/components/ops/hooks';
import { api } from '@/lib/client/api';

export interface VariantForm {
  id?: string;
  sku: string;
  barcode: string;
  label: string;
  retailPriceCents: string;
  wholesalePriceCents: string;
  wholesaleMinQty: string;
  suggestedPriceCents: string;
  minStock: string;
}

export interface ProductFormValue {
  kind: 'physical' | 'service';
  tracking: 'quantity' | 'serialized' | 'none';
  name: string;
  description: string;
  brand: string;
  categoryId: string;
  status: 'active' | 'inactive';
  conditionDefault: string;
  warrantyDays: string;
  identifierKinds: string[];
  variants: VariantForm[];
  version?: number;
}

export const emptyVariant = (): VariantForm => ({ sku: '', barcode: '', label: '', retailPriceCents: '', wholesalePriceCents: '', wholesaleMinQty: '', suggestedPriceCents: '', minStock: '0' });

export const emptyProduct = (): ProductFormValue => ({
  kind: 'physical', tracking: 'quantity', name: '', description: '', brand: '', categoryId: '', status: 'active', conditionDefault: '', warrantyDays: '0', identifierKinds: [], variants: [emptyVariant()],
});

export function toApi(v: ProductFormValue) {
  return {
    kind: v.kind,
    tracking: v.kind === 'service' ? 'none' : v.tracking,
    name: v.name,
    description: v.description || null,
    brand: v.brand || null,
    categoryId: v.categoryId || null,
    status: v.status,
    conditionDefault: v.conditionDefault || null,
    warrantyDays: Number(v.warrantyDays || 0),
    identifierKinds: v.tracking === 'serialized' ? v.identifierKinds : [],
    version: v.version,
    variants: v.variants.map((x) => ({
      id: x.id,
      sku: x.sku,
      barcode: x.barcode || null,
      label: x.label,
      retailPriceCents: x.retailPriceCents || '0',
      wholesalePriceCents: x.wholesalePriceCents || null,
      wholesaleMinQty: x.wholesaleMinQty ? Number(x.wholesaleMinQty) : null,
      suggestedPriceCents: x.suggestedPriceCents || null,
      minStock: Number(x.minStock || 0),
    })),
  };
}

export function ProductForm({ initial, onSubmit, submitLabel, locked }: { initial: ProductFormValue; onSubmit: (v: ProductFormValue) => Promise<void>; submitLabel: string; locked?: boolean }) {
  const [v, setV] = useState(initial);
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  const [newCat, setNewCat] = useState('');
  const cats = useCategories();
  const qc = useQueryClient();
  const set = <K extends keyof ProductFormValue>(k: K, val: ProductFormValue[K]) => setV((s) => ({ ...s, [k]: val }));
  const setVar = (i: number, patch: Partial<VariantForm>) => setV((s) => ({ ...s, variants: s.variants.map((x, j) => (j === i ? { ...x, ...patch } : x)) }));
  const fe = (error as { fields?: Record<string, string> } | null)?.fields ?? {};
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setSaving(true);
        setError(null);
        try {
          await onSubmit(v);
        } catch (err) {
          setError(err);
        } finally {
          setSaving(false);
        }
      }}
    >
      <Card title="Geral">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Tipo de item" htmlFor="kind" help={v.kind === 'service' ? 'Serviço não movimenta estoque.' : 'Mercadoria com estoque.'}>
            <Select id="kind" value={v.kind} disabled={locked} onChange={(e) => { const kind = e.target.value as ProductFormValue['kind']; setV((s) => ({ ...s, kind, tracking: kind === 'service' ? 'none' : s.tracking === 'none' ? 'quantity' : s.tracking })); }}>
              <option value="physical">Produto físico</option>
              <option value="service">Serviço</option>
            </Select>
          </Field>
          {v.kind === 'physical' && (
            <Field label="Controle de estoque" htmlFor="tracking" help={v.tracking === 'serialized' ? 'Cada unidade tem identidade própria (IMEI/série) e custo específico.' : 'Estoque por quantidade, custo FIFO por lote.'}>
              <Select id="tracking" value={v.tracking} disabled={locked} onChange={(e) => set('tracking', e.target.value as ProductFormValue['tracking'])}>
                <option value="quantity">Por quantidade (lotes)</option>
                <option value="serialized">Por unidade (IMEI/série, usados)</option>
              </Select>
            </Field>
          )}
          <Field label="Nome" htmlFor="name" required error={fe.name}><Input id="name" required value={v.name} onChange={(e) => set('name', e.target.value)} /></Field>
          <Field label="Marca" htmlFor="brand"><Input id="brand" value={v.brand} onChange={(e) => set('brand', e.target.value)} /></Field>
          <Field label="Categoria" htmlFor="category">
            <div className="flex gap-2">
              <Select id="category" value={v.categoryId} onChange={(e) => set('categoryId', e.target.value)}>
                <option value="">Sem categoria</option>
                {cats.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </div>
            <div className="mt-1 flex gap-2">
              <Input value={newCat} onChange={(e) => setNewCat(e.target.value)} placeholder="Nova categoria" aria-label="Nova categoria" className="h-8 text-xs" />
              <Button type="button" size="sm" variant="secondary" disabled={!newCat.trim()} onClick={async () => {
                try {
                  const c = await api<{ id: string }>('categories', { body: { name: newCat.trim() } });
                  await qc.invalidateQueries({ queryKey: ['categories'] });
                  set('categoryId', c.id);
                  setNewCat('');
                } catch (err) { setError(err); }
              }}>Criar</Button>
            </div>
          </Field>
          <Field label="Situação" htmlFor="status" help="Inativo não aparece para nova venda e continua nos documentos antigos.">
            <Select id="status" value={v.status} onChange={(e) => set('status', e.target.value as ProductFormValue['status'])}>
              <option value="active">Ativo</option>
              <option value="inactive">Inativo</option>
            </Select>
          </Field>
          {v.kind === 'physical' && (
            <Field label="Condição padrão" htmlFor="condition">
              <Select id="condition" value={v.conditionDefault} onChange={(e) => set('conditionDefault', e.target.value)}>
                <option value="">Não informar</option>
                <option value="new">Novo</option>
                <option value="used">Usado</option>
                <option value="refurbished">Recondicionado</option>
              </Select>
            </Field>
          )}
          <Field label="Garantia comercial (dias)" htmlFor="warranty"><Input id="warranty" type="number" min={0} max={3650} value={v.warrantyDays} onChange={(e) => set('warrantyDays', e.target.value)} /></Field>
          {v.tracking === 'serialized' && (
            <fieldset className="flex flex-col gap-1.5 sm:col-span-2">
              <legend className="text-xs font-medium text-muted">Identificadores usados</legend>
              <div className="flex flex-wrap gap-3 text-sm">
                {[['imei1', 'IMEI 1'], ['imei2', 'IMEI 2'], ['serial', 'Número de série']].map(([k, l]) => (
                  <label key={k} className="flex items-center gap-2">
                    <input type="checkbox" className="accent-[var(--color-primary)]" checked={v.identifierKinds.includes(k!)} onChange={(e) => set('identifierKinds', e.target.checked ? [...v.identifierKinds, k!] : v.identifierKinds.filter((x) => x !== k))} />
                    {l}
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          <div className="sm:col-span-2"><Field label="Descrição" htmlFor="desc"><Textarea id="desc" value={v.description} onChange={(e) => set('description', e.target.value)} placeholder="Detalhes para catálogo, loja ou uso interno" /></Field></div>
        </div>
      </Card>
      <Card title="Preços e variações" description="O custo não é digitado aqui: ele vem das compras e trocas (custo real de aquisição).">
        <div className="flex flex-col gap-4">
          {v.variants.map((x, i) => (
            <div key={x.id ?? i} className="rounded-xl border border-line bg-bg p-3">
              <div className="grid gap-3 sm:grid-cols-4">
                <Field label="SKU" htmlFor={`sku-${i}`} required><Input id={`sku-${i}`} required value={x.sku} onChange={(e) => setVar(i, { sku: e.target.value })} /></Field>
                <Field label="Variação" htmlFor={`label-${i}`} help="Ex.: Preto 128 GB, Tamanho M"><Input id={`label-${i}`} value={x.label} onChange={(e) => setVar(i, { label: e.target.value })} /></Field>
                <Field label="Código de barras" htmlFor={`bar-${i}`}><Input id={`bar-${i}`} value={x.barcode} onChange={(e) => setVar(i, { barcode: e.target.value })} /></Field>
                <Field label="Estoque mínimo" htmlFor={`min-${i}`}><Input id={`min-${i}`} type="number" min={0} value={x.minStock} onChange={(e) => setVar(i, { minStock: e.target.value })} /></Field>
                <Field label="Preço de varejo" htmlFor={`retail-${i}`} required><MoneyInput id={`retail-${i}`} value={x.retailPriceCents} onChange={(c) => setVar(i, { retailPriceCents: c })} /></Field>
                <Field label="Preço de atacado" htmlFor={`whole-${i}`}><MoneyInput id={`whole-${i}`} value={x.wholesalePriceCents} onChange={(c) => setVar(i, { wholesalePriceCents: c })} /></Field>
                <Field label="Qtd. mínima atacado" htmlFor={`wmin-${i}`}><Input id={`wmin-${i}`} type="number" min={1} value={x.wholesaleMinQty} onChange={(e) => setVar(i, { wholesaleMinQty: e.target.value })} /></Field>
                <Field label="Preço sugerido" htmlFor={`sug-${i}`}><MoneyInput id={`sug-${i}`} value={x.suggestedPriceCents} onChange={(c) => setVar(i, { suggestedPriceCents: c })} /></Field>
              </div>
              {v.variants.length > 1 && <div className="mt-2 flex justify-end"><Button type="button" variant="quiet" size="sm" onClick={() => set('variants', v.variants.filter((_, j) => j !== i))}><Trash2 className="size-4" /> Remover variação</Button></div>}
            </div>
          ))}
          <div><Button type="button" variant="secondary" size="sm" onClick={() => set('variants', [...v.variants, emptyVariant()])}><Plus className="size-4" /> Adicionar variação</Button></div>
        </div>
      </Card>
      <FormError error={error} />
      <div className="flex justify-end gap-2"><Button type="submit" loading={saving}>{submitLabel}</Button></div>
    </form>
  );
}
