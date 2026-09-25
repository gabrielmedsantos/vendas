'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button, Field, FormError, Input, Modal, MoneyInput, Select } from '@/components/ui';
import { UnitPicker } from '@/components/ops/unit-picker';
import { useToast } from '@/components/toast';
import { api } from '@/lib/client/api';

export function AdjustModal({ open, onClose, variants, tracking }: { open: boolean; onClose: () => void; variants: { id: string; sku: string; label: string }[]; tracking: string }) {
  const [f, setF] = useState({ variantId: variants[0]?.id ?? '', direction: 'out', kind: 'adjustment', quantity: '1', unitCostCents: '', unitId: '', imei: '', reason: '' });
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const qc = useQueryClient();
  const toast = useToast();
  const serialized = tracking === 'serialized';
  return (
    <Modal open={open} onClose={onClose} title="Ajuste de estoque" footer={<>
      <Button variant="secondary" onClick={onClose}>Cancelar</Button>
      <Button variant={f.direction === 'out' ? 'danger' : 'primary'} loading={loading} onClick={async () => {
        setLoading(true); setError(null);
        try {
          await api('inventory/adjustments', { body: {
            variantId: f.variantId, direction: f.direction, kind: f.direction === 'in' ? (f.kind === 'loss' ? 'adjustment' : f.kind) : f.kind, quantity: Number(f.quantity),
            unitCostCents: f.direction === 'in' ? f.unitCostCents || undefined : undefined,
            unitId: f.direction === 'out' && serialized ? f.unitId || undefined : undefined,
            unit: f.direction === 'in' && serialized && f.imei ? { identifiers: [{ kind: 'imei1', value: f.imei }] } : undefined,
            reason: f.reason,
          } });
          await qc.invalidateQueries();
          toast('Ajuste registrado.');
          onClose();
        } catch (e) { setError(e); } finally { setLoading(false); }
      }}>Confirmar ajuste</Button>
    </>}>
      <div className="flex flex-col gap-3">
        <p className="rounded-xl border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">Ajustes são auditados. Saída por perda gera despesa de perda ao custo histórico. Para entrada comprada de fornecedor, use Compras.</p>
        {variants.length > 1 && (
          <Field label="Variação" htmlFor="adj-var"><Select id="adj-var" value={f.variantId} onChange={(e) => setF({ ...f, variantId: e.target.value })}>{variants.map((v) => <option key={v.id} value={v.id}>{v.sku} {v.label}</option>)}</Select></Field>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Sentido" htmlFor="adj-dir"><Select id="adj-dir" value={f.direction} onChange={(e) => setF({ ...f, direction: e.target.value, kind: e.target.value === 'in' ? 'opening' : 'adjustment' })}><option value="out">Saída</option><option value="in">Entrada</option></Select></Field>
          <Field label="Motivo do tipo" htmlFor="adj-kind">
            <Select id="adj-kind" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
              {f.direction === 'out' ? <><option value="adjustment">Ajuste de inventário</option><option value="loss">Perda / avaria</option></> : <><option value="opening">Estoque inicial</option><option value="adjustment">Ajuste de inventário</option></>}
            </Select>
          </Field>
        </div>
        {serialized && f.direction === 'out' ? (
          <Field label="Unidade" htmlFor="adj-unit"><UnitPicker variantId={f.variantId} value={f.unitId} onChange={(id) => setF({ ...f, unitId: id })} /></Field>
        ) : (
          <Field label="Quantidade" htmlFor="adj-qty"><Input id="adj-qty" type="number" min={1} value={serialized ? '1' : f.quantity} disabled={serialized} onChange={(e) => setF({ ...f, quantity: e.target.value })} /></Field>
        )}
        {f.direction === 'in' && (
          <>
            <Field label="Custo unitário" htmlFor="adj-cost" help="Custo real de aquisição, usado no CMV quando vender."><MoneyInput id="adj-cost" value={f.unitCostCents} onChange={(c) => setF({ ...f, unitCostCents: c })} /></Field>
            {serialized && <Field label="IMEI / série" htmlFor="adj-imei"><Input id="adj-imei" value={f.imei} onChange={(e) => setF({ ...f, imei: e.target.value })} /></Field>}
          </>
        )}
        <Field label="Justificativa" htmlFor="adj-reason" required><Input id="adj-reason" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="Ex.: contagem de inventário, avaria no transporte" /></Field>
        <FormError error={error} />
      </div>
    </Modal>
  );
}
