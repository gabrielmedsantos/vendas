'use client';

import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { DocLinks } from '@/components/docs/doc-links';
import { Badge, Button, Card, ErrorState, Field, FormError, Input, LoadingBlock, Modal, PageHeader, Select, Table, Td, Th } from '@/components/ui';
import { useToast } from '@/components/toast';
import { api, newKey } from '@/lib/client/api';
import { brl, dateBR, STATUS_LABEL } from '@/lib/client/format';
import { useCan } from '@/lib/client/session';

interface Detail {
  purchase: { id: string; number: string | null; status: string; origin: string; purchaseDate: string; supplierName: string; totalCents?: string; itemsCents?: string; discountCents?: string; extraCostsCents?: string; notes: string | null; tradeId: string | null; cancelReason: string | null };
  items: { id: string; description: string; quantity: number; receivedQty: number; unitCostCents?: string; landedCostCents?: string; receivedCostCents?: string; unitSpecs: unknown[] }[];
  receipts: { id: string; receivedAt: string; quantity: number; notes: string | null }[];
  titles: { id: string; description: string; dueDate: string; originalCents: string; balanceCents: string; status: string }[];
  documents: { id: string; docType: string; number: string; status: string }[];
}

export default function PurchaseDetail() {
  const { id } = useParams<{ id: string }>();
  const can = useCan();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['purchase', id], queryFn: () => api<Detail>(`purchases/${id}`), refetchInterval: (s) => (s.state.data?.documents.some((d) => d.status === 'pending') ? 3000 : false) });
  const [receiving, setReceiving] = useState(false);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [dest, setDest] = useState('available');
  const [cancel, setCancel] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState(newKey);
  if (q.isLoading) return <LoadingBlock rows={6} />;
  if (q.error) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  const d = q.data!;
  const p = d.purchase;
  const pending = d.items.filter((i) => i.quantity > i.receivedQty);
  const run = async (fn: () => Promise<unknown>, msg: string) => {
    setBusy(true); setError(null);
    try { await fn(); await qc.invalidateQueries(); toast(msg); setReceiving(false); setCancel(false); setKey(newKey()); } catch (e) { setError(e); } finally { setBusy(false); }
  };
  return (
    <div>
      <PageHeader
        title={p.number ? `Compra #${p.number}` : 'Rascunho de compra'}
        description={`${p.supplierName} · ${dateBR(p.purchaseDate)}${p.origin === 'trade' ? ' · originada de troca' : ''}`}
        actions={<>
          <Badge tone={p.status === 'received' ? 'success' : p.status === 'canceled' ? 'neutral' : 'warning'}>{STATUS_LABEL[p.status]}</Badge>
          {p.status === 'draft' && can('purchases.manage') && <Button loading={busy} onClick={() => run(() => api(`purchases/${id}/approve`, { method: 'POST', idempotencyKey: key }), 'Compra aprovada; contas a pagar criadas.')}>Aprovar compra</Button>}
          {['approved', 'partially_received'].includes(p.status) && (can('purchases.receive') || can('purchases.manage')) && <Button onClick={() => { setQty(Object.fromEntries(pending.map((i) => [i.id, String(i.quantity - i.receivedQty)]))); setReceiving(true); }}>Receber mercadoria</Button>}
          {['draft', 'approved'].includes(p.status) && p.origin !== 'trade' && can('purchases.manage') && <Button variant="danger" onClick={() => setCancel(true)}>Cancelar</Button>}
          {['received', 'partially_received'].includes(p.status) && p.origin !== 'trade' && can('purchases.manage') && <Button variant="danger" onClick={() => setCancel(true)}>Estornar compra</Button>}
          {p.tradeId && <Link className="text-sm text-primary-soft" href={`/app/trocas/${p.tradeId}`}>Ver troca</Link>}
        </>}
      />
      <FormError error={!receiving && !cancel ? error : null} />
      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="flex flex-col gap-4">
          <Card title="Itens">
            <Table>
              <thead><tr><Th>Item</Th><Th right>Qtd</Th><Th right>Recebido</Th>{d.items[0]?.unitCostCents !== undefined && <><Th right>Custo unit.</Th><Th right>Custo aquisição</Th></>}</tr></thead>
              <tbody>{d.items.map((i) => (
                <tr key={i.id}><Td>{i.description}</Td><Td right>{i.quantity}</Td><Td right className={i.receivedQty < i.quantity ? 'text-warning' : 'text-success'}>{i.receivedQty}</Td>{i.unitCostCents !== undefined && <><Td right>{brl(i.unitCostCents)}</Td><Td right>{brl(i.landedCostCents)}</Td></>}</tr>
              ))}</tbody>
            </Table>
            {p.totalCents !== undefined && (
              <dl className="mt-3 flex flex-col items-end gap-1 text-sm">
                <div className="flex gap-6"><dt className="text-muted">Itens</dt><dd className="tabular">{brl(p.itemsCents)}</dd></div>
                <div className="flex gap-6"><dt className="text-muted">Desconto</dt><dd className="tabular">−{brl(p.discountCents)}</dd></div>
                <div className="flex gap-6"><dt className="text-muted">Frete/custos</dt><dd className="tabular">{brl(p.extraCostsCents)}</dd></div>
                <div className="flex gap-6 font-semibold"><dt>Total</dt><dd className="tabular">{brl(p.totalCents)}</dd></div>
              </dl>
            )}
          </Card>
          <Card title="Recebimentos">
            {d.receipts.length ? <ul className="flex flex-col gap-1 text-sm">{d.receipts.map((r) => <li key={r.id} className="flex justify-between"><span>{dateBR(r.receivedAt)}</span><span>{r.quantity} item(ns)</span></li>)}</ul> : <p className="text-sm text-muted">Nada recebido ainda.</p>}
          </Card>
        </div>
        <div className="flex flex-col gap-4">
          <Card title="Contas a pagar">
            {d.titles.length ? <ul className="flex flex-col gap-2 text-sm">{d.titles.map((t) => <li key={t.id} className="flex justify-between gap-2"><span className="min-w-0"><span className="block truncate">{t.description}</span><span className="text-xs text-muted">vence {dateBR(t.dueDate)} · {STATUS_LABEL[t.status]}</span></span><span className="tabular">{brl(t.balanceCents)}</span></li>)}</ul> : <p className="text-sm text-muted">{p.status === 'draft' ? 'Criadas na aprovação.' : 'Sem títulos.'}</p>}
          </Card>
          <Card title="Documentos"><DocLinks docs={d.documents} /></Card>
          {p.cancelReason && <Card title="Cancelamento"><p className="text-sm text-muted">{p.cancelReason}</p></Card>}
        </div>
      </div>
      <Modal open={receiving} onClose={() => setReceiving(false)} title="Receber mercadoria" footer={<>
        <Button variant="secondary" onClick={() => setReceiving(false)}>Voltar</Button>
        <Button loading={busy} onClick={() => run(() => api(`purchases/${id}/receive`, { idempotencyKey: key, body: { items: pending.map((i) => ({ purchaseItemId: i.id, quantity: Number(qty[i.id] || 0), destination: dest })).filter((x) => x.quantity > 0) } }), 'Recebimento registrado.')}>Confirmar recebimento</Button>
      </>}>
        <div className="flex flex-col gap-3">
          <p className="text-xs text-muted">Somente a quantidade recebida entra no estoque. O restante continua pendente.</p>
          {pending.map((i) => (
            <Field key={i.id} label={`${i.description} (pendente ${i.quantity - i.receivedQty})`} htmlFor={`rq-${i.id}`}>
              <Input id={`rq-${i.id}`} type="number" min={0} max={i.quantity - i.receivedQty} value={qty[i.id] ?? ''} onChange={(e) => setQty({ ...qty, [i.id]: e.target.value })} />
            </Field>
          ))}
          <Field label="Destino" htmlFor="rdest"><Select id="rdest" value={dest} onChange={(e) => setDest(e.target.value)}><option value="available">Disponível para venda</option><option value="inspection">Inspeção</option></Select></Field>
          <FormError error={error} />
        </div>
      </Modal>
      <Modal open={cancel} onClose={() => setCancel(false)} title={['received', 'partially_received'].includes(p.status) ? 'Estornar compra' : 'Cancelar compra'} footer={<>
        <Button variant="secondary" onClick={() => setCancel(false)}>Voltar</Button>
        <Button variant="danger" loading={busy} onClick={() => run(() => api(`purchases/${id}/cancel`, { body: { reason } }), ['received', 'partially_received'].includes(p.status) ? 'Compra estornada: itens fora do estoque e valor devolvido à conta.' : 'Compra cancelada.')}>{['received', 'partially_received'].includes(p.status) ? 'Estornar compra' : 'Cancelar compra'}</Button>
      </>}>
        {['received', 'partially_received'].includes(p.status)
          ? <p className="mb-3 text-sm text-muted">Para compra lançada por engano. Os itens recebidos saem do estoque, os pagamentos são estornados (o valor volta para a conta) e as contas a pagar são canceladas. Só é possível se nenhum item desta compra foi vendido. Tudo fica no histórico com o motivo.</p>
          : <p className="mb-3 text-sm text-muted">Contas a pagar em aberto serão canceladas. Valores já pagos viram um título a receber do fornecedor (reembolso).</p>}
        <Field label="Motivo" htmlFor="creason" required><Input id="creason" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        <div className="mt-3"><FormError error={error} /></div>
      </Modal>
    </div>
  );
}
