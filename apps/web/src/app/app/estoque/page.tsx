'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { CheckCircle2, ClipboardCheck, Wrench } from 'lucide-react';
import { useAccounts } from '@/components/ops/hooks';
import { Button, Card, EmptyState, ErrorState, Field, FormError, Input, LoadingBlock, Modal, MoneyInput, PageHeader, Pager, Select, Table, Tabs, Td, Th } from '@/components/ui';
import { useToast } from '@/components/toast';
import { api, newKey, qs } from '@/lib/client/api';
import { brl, dateBR, dateTimeBR, KIND_LABEL, CONDITION_LABEL } from '@/lib/client/format';
import { useCan } from '@/lib/client/session';

interface Movement { id: string; createdAt: string; direction: string; kind: string; bucket: string; quantity: number; physicalAfter: number; reason: string | null; name: string; sku: string; internalCode: string | null; costCents?: string; sourceType: string }
interface Inspect { lotId: string; sourceType: string; receivedAt: string; qtyRemaining: number; name: string; sku: string; internalCode: string | null; condition: string | null; defects: string | null; costRemainingCents?: string }

function Movements() {
  const [cursor, setCursor] = useState<string | undefined>();
  const [kind, setKind] = useState('');
  const q = useQuery({ queryKey: ['movements', cursor, kind], queryFn: () => api<{ data: Movement[]; meta: { cursor: string | null; hasMore: boolean } }>(`inventory/movements${qs({ cursor, kind })}`) });
  return (
    <Card title="Livro de movimentos" description="Registro imutável de toda entrada e saída, com origem, usuário e saldo físico após o movimento." action={
      <div className="w-48"><Select aria-label="Tipo" value={kind} onChange={(e) => { setKind(e.target.value); setCursor(undefined); }}><option value="">Todos os tipos</option>{['purchase_receipt', 'sale', 'trade_in', 'trade_out', 'sale_return', 'adjustment_in', 'adjustment_out', 'loss', 'inspection_release', 'reversal'].map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</Select></div>
    }>
      {q.isLoading && <LoadingBlock />}
      {q.error && <ErrorState error={q.error} />}
      {q.data && q.data.data.length === 0 && <EmptyState title="Sem movimentos" description="Compras, vendas, trocas e ajustes aparecem aqui." />}
      {q.data && q.data.data.length > 0 && (
        <>
          <Table>
            <thead><tr><Th>Data</Th><Th>Produto</Th><Th>Tipo</Th><Th right>Qtd</Th>{q.data.data[0]?.costCents !== undefined && <Th right>Custo</Th>}<Th right>Saldo físico</Th><Th>Motivo</Th></tr></thead>
            <tbody>{q.data.data.map((m) => (
              <tr key={m.id}><Td className="whitespace-nowrap">{dateTimeBR(m.createdAt)}</Td><Td>{m.name}<div className="text-xs text-muted">{m.sku}{m.internalCode ? ` · ${m.internalCode}` : ''}</div></Td><Td>{KIND_LABEL[m.kind] ?? m.kind}{m.bucket === 'inspection' && <span className="text-xs text-info"> · inspeção</span>}</Td><Td right className={m.direction === 'in' ? 'text-success' : 'text-danger-soft'}>{m.direction === 'in' ? '+' : '−'}{m.quantity}</Td>{m.costCents !== undefined && <Td right>{brl(m.costCents)}</Td>}<Td right>{m.physicalAfter}</Td><Td className="text-xs text-muted">{m.reason ?? ''}</Td></tr>
            ))}</tbody>
          </Table>
          <Pager hasMore={q.data.meta.hasMore} cursor={q.data.meta.cursor} onNext={setCursor} onFirst={() => setCursor(undefined)} isFirst={!cursor} />
        </>
      )}
    </Card>
  );
}

function Inspection() {
  const can = useCan();
  const qc = useQueryClient();
  const toast = useToast();
  const accounts = useAccounts(can('finance.view'));
  const q = useQuery({ queryKey: ['inspection'], queryFn: () => api<Inspect[]>('inventory/inspection') });
  const [repair, setRepair] = useState<Inspect | null>(null);
  const [form, setForm] = useState({ description: '', amount: '', payNow: false, accountId: '' });
  const [error, setError] = useState<unknown>(null);
  const [key, setKey] = useState(newKey);
  return (
    <Card title="Em inspeção / quarentena" description="Itens recebidos em troca, devolvidos ou comprados para conferir. Não ficam disponíveis para venda até serem liberados.">
      {q.isLoading && <LoadingBlock />}
      {q.data && q.data.length === 0 && <EmptyState icon={<CheckCircle2 className="size-5" />} title="Nada aguardando inspeção" />}
      {q.data && q.data.length > 0 && (
        <Table>
          <thead><tr><Th>Entrada</Th><Th>Item</Th><Th>Origem</Th><Th>Condição</Th>{q.data[0]?.costRemainingCents !== undefined && <Th right>Custo</Th>}<Th right>Qtd</Th><Th /></tr></thead>
          <tbody>{q.data.map((i) => (
            <tr key={i.lotId}><Td>{dateBR(i.receivedAt)}</Td><Td>{i.name}<div className="text-xs text-muted">{i.sku}{i.internalCode ? ` · ${i.internalCode}` : ''}</div></Td><Td>{KIND_LABEL[i.sourceType] ?? i.sourceType}</Td><Td className="text-xs">{(i.condition ? CONDITION_LABEL[i.condition] ?? i.condition : '—')}{i.defects ? <div className="text-muted">{i.defects}</div> : null}</Td>{i.costRemainingCents !== undefined && <Td right>{brl(i.costRemainingCents)}</Td>}<Td right>{i.qtyRemaining}</Td>
              <Td right><span className="flex justify-end gap-2">
                {can('purchases.manage') && <Button size="sm" variant="secondary" onClick={() => { setRepair(i); setForm({ description: '', amount: '', payNow: false, accountId: accounts.data?.[0]?.id ?? '' }); }}><Wrench className="size-3.5" />Custo de preparo</Button>}
                <Button size="sm" onClick={async () => { try { await api(`inventory/inspection/${i.lotId}/release`, { body: {} }); qc.invalidateQueries(); toast('Liberado para venda.'); } catch (e) { alert((e as Error).message); } }}>Liberar</Button>
              </span></Td>
            </tr>
          ))}</tbody>
        </Table>
      )}
      <Modal open={!!repair} onClose={() => setRepair(null)} title="Custo realizado de preparo" footer={<>
        <Button variant="secondary" onClick={() => setRepair(null)}>Cancelar</Button>
        <Button onClick={async () => {
          setError(null);
          try {
            await api('inventory/acquisition-costs', { idempotencyKey: key, body: { lotId: repair!.lotId, description: form.description, amountCents: form.amount, payNow: form.payNow ? { accountId: form.accountId, method: 'pix' } : null } });
            await qc.invalidateQueries(); toast('Custo agregado ao item.'); setRepair(null); setKey(newKey());
          } catch (e) { setError(e); }
        }}>Registrar</Button>
      </>}>
        <div className="flex flex-col gap-3">
          <p className="text-xs text-muted">Reparo ou preparo efetivamente realizado antes da revenda soma ao custo do item (não vira despesa operacional). Estimativas não devem ser lançadas aqui.</p>
          <Field label="Descrição" htmlFor="rp-d" required><Input id="rp-d" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Ex.: troca de tela" /></Field>
          <Field label="Valor" htmlFor="rp-v" required><MoneyInput id="rp-v" value={form.amount} onChange={(c) => setForm({ ...form, amount: c })} /></Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-[var(--color-primary)]" checked={form.payNow} onChange={(e) => setForm({ ...form, payNow: e.target.checked })} />Pago agora (senão vai para Contas a pagar)</label>
          {form.payNow && <Select aria-label="Conta" value={form.accountId} onChange={(e) => setForm({ ...form, accountId: e.target.value })}>{accounts.data?.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select>}
          <FormError error={error} />
        </div>
      </Modal>
    </Card>
  );
}

function Count() {
  const qc = useQueryClient();
  const toast = useToast();
  const [countId, setCountId] = useState<string | null>(null);
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [reason, setReason] = useState('');
  const [error, setError] = useState<unknown>(null);
  const q = useQuery({ queryKey: ['count', countId], queryFn: () => api<{ count: { id: string; status: string }; items: { id: string; variantId: string; name: string; sku: string; expectedQty: number; countedQty: number }[] }>(`inventory/counts/${countId}`), enabled: !!countId });
  const diffs = (q.data?.items ?? []).filter((i) => Number(counts[i.variantId] ?? i.countedQty) !== i.expectedQty);
  return (
    <Card title="Inventário físico" description="Conte o estoque por quantidade, revise as divergências e confirme: faltas viram perda ao custo histórico; sobras entram como ajuste.">
      {!countId ? (
        <div className="flex flex-col items-start gap-3">
          <Button onClick={async () => { setError(null); try { const r = await api<{ id: string }>('inventory/counts', { body: {} }); setCountId(r.id); } catch (e) { setError(e); } }}><ClipboardCheck className="size-4" />Iniciar contagem</Button>
          <FormError error={error} />
        </div>
      ) : q.isLoading ? <LoadingBlock /> : q.data && (
        <div className="flex flex-col gap-3">
          <Table>
            <thead><tr><Th>Produto</Th><Th right>Sistema</Th><Th right>Contado</Th><Th right>Diferença</Th></tr></thead>
            <tbody>{q.data.items.map((i) => {
              const c = Number(counts[i.variantId] ?? i.countedQty);
              return <tr key={i.id}><Td>{i.name}<div className="text-xs text-muted">{i.sku}</div></Td><Td right>{i.expectedQty}</Td><Td right><Input type="number" min={0} aria-label={`Contado ${i.name}`} value={counts[i.variantId] ?? String(i.countedQty)} onChange={(e) => setCounts({ ...counts, [i.variantId]: e.target.value })} className="ml-auto h-8 w-24 text-right" /></Td><Td right className={c - i.expectedQty < 0 ? 'text-danger-soft' : c - i.expectedQty > 0 ? 'text-success' : 'text-muted'}>{c - i.expectedQty}</Td></tr>;
            })}</tbody>
          </Table>
          <p className="text-sm">{diffs.length} divergência(s).</p>
          <Field label="Justificativa" htmlFor="cnt-r" required><Input id="cnt-r" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
          <FormError error={error} />
          <div className="flex gap-2">
            <Button variant="secondary" onClick={async () => { await api(`inventory/counts/${countId}`, { method: 'PUT', body: { items: Object.entries(counts).map(([variantId, v]) => ({ variantId, countedQty: Number(v) })) } }); toast('Contagem salva.'); }}>Salvar rascunho</Button>
            <Button onClick={async () => {
              setError(null);
              try {
                await api(`inventory/counts/${countId}`, { method: 'PUT', body: { items: Object.entries(counts).map(([variantId, v]) => ({ variantId, countedQty: Number(v) })) } });
                const r = await api<{ adjustments: number }>(`inventory/counts/${countId}/confirm`, { body: { reason } });
                await qc.invalidateQueries(); toast(`Inventário confirmado: ${r.adjustments} ajuste(s).`); setCountId(null); setCounts({});
              } catch (e) { setError(e); }
            }}>Confirmar divergências</Button>
          </div>
        </div>
      )}
    </Card>
  );
}

export default function StockPage() {
  const can = useCan();
  const [tab, setTab] = useState<'moves' | 'inspection' | 'count'>('moves');
  return (
    <div>
      <PageHeader title="Estoque" description="Disponível = físico vendável − reservado. Itens em inspeção não ficam disponíveis." />
      <div className="mb-4"><Tabs value={tab} onChange={setTab} options={[{ value: 'moves', label: 'Movimentos' }, { value: 'inspection', label: 'Inspeção' }, ...(can('inventory.adjust') ? [{ value: 'count' as const, label: 'Inventário físico' }] : [])]} /></div>
      {tab === 'moves' && <Movements />}
      {tab === 'inspection' && <Inspection />}
      {tab === 'count' && <Count />}
    </div>
  );
}
