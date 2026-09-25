'use client';

import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, Undo2 } from 'lucide-react';
import { formatBRL } from '@gct/shared';
import { DocLinks } from '@/components/docs/doc-links';
import { Badge, Button, Card, ErrorState, Field, FormError, Input, LoadingBlock, Modal, PageHeader, Table, Td, Th } from '@/components/ui';
import { useToast } from '@/components/toast';
import { api, newKey } from '@/lib/client/api';
import { brl, dateBR, dateTimeBR, KIND_LABEL, STATUS_LABEL, CONDITION_LABEL } from '@/lib/client/format';
import { useCan } from '@/lib/client/session';

interface Detail {
  trade: { id: string; number: string; status: string; confirmedAt: string; partyName: string; partyId: string; saleId: string; purchaseId: string; saleTotalCents: string; purchaseTotalCents: string; offsetCents: string; differenceCents: string; differencePolicy: string; notes: string | null; reversalReason: string | null; reversedAt: string | null };
  outgoing: { id: string; description: string; sku: string; quantity: number; unitPriceCents: string; totalCents: string; internalCode: string | null; costCents?: string }[];
  incoming: { id: string; description: string; quantity: number; agreedCents: string; estimatedExtraCostCents: string; suggestedPriceCents: string | null; condition: string | null; identifiers: { kind: string; value: string }[]; destination: string; notes: string | null; internalCode: string | null; unitStatus: string | null }[];
  settlements: { id: string; direction: string; method: string; settledOn: string; amountCents: string; reversalOf: string | null }[];
  documents: { id: string; docType: string; number: string; status: string }[];
  canSeeCost: boolean;
}

export default function TradeDetail() {
  const { id } = useParams<{ id: string }>();
  const can = useCan();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['trade', id], queryFn: () => api<Detail>(`trades/${id}`), refetchInterval: (s) => (s.state.data?.documents.some((d) => d.status === 'pending') ? 3000 : false) });
  const [rev, setRev] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [key] = useState(newKey);
  if (q.isLoading) return <LoadingBlock rows={6} />;
  if (q.error) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  const { trade: t, outgoing, incoming, settlements, documents, canSeeCost } = q.data!;
  const D = BigInt(t.differenceCents);
  const cost = outgoing.reduce((a, o) => a + BigInt(o.costCents ?? '0'), 0n);
  return (
    <div>
      <PageHeader
        title={`Troca #${t.number}`}
        description={`${t.partyName} · ${dateTimeBR(t.confirmedAt)}`}
        actions={<>
          <Badge tone={t.status === 'confirmed' ? 'success' : 'neutral'}>{STATUS_LABEL[t.status]}</Badge>
          <Link className="text-sm text-primary-soft" href={`/app/vendas/${t.saleId}`}>Venda vinculada</Link>
          {(can('purchases.manage') || can('purchases.receive')) && <Link className="text-sm text-primary-soft" href={`/app/compras/${t.purchaseId}`}>Compra vinculada</Link>}
          {t.status === 'confirmed' && can('reversals.execute') && <Button variant="danger" onClick={() => setRev(true)}><Undo2 className="size-4" />Reverter</Button>}
        </>}
      />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="rounded-2xl border border-line bg-surface p-4"><p className="text-xs text-muted">Saída ao cliente (S)</p><p className="mt-1 text-xl font-semibold tabular">{brl(t.saleTotalCents)}</p></div>
        <div className="rounded-2xl border border-line bg-surface p-4"><p className="text-xs text-muted">Entrada avaliada (P)</p><p className="mt-1 text-xl font-semibold tabular">{brl(t.purchaseTotalCents)}</p></div>
        <div className="rounded-2xl border border-line bg-surface p-4"><p className="text-xs text-muted">Compensado sem dinheiro</p><p className="mt-1 text-xl font-semibold tabular">{brl(t.offsetCents)}</p></div>
        <div className="rounded-2xl border border-primary/40 bg-primary/10 p-4"><p className="text-xs text-muted">Diferença</p><p className="mt-1 text-xl font-semibold tabular">{formatBRL(D < 0n ? -D : D)}</p><p className="text-xs">{D > 0n ? 'Cliente paga à empresa' : D < 0n ? (t.differencePolicy === 'store_credit' ? 'Crédito da loja ao cliente' : 'Empresa paga ao cliente') : 'Sem pagamento'}</p></div>
      </div>
      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="flex flex-col gap-4">
          <Card title={<span className="flex items-center gap-2"><ArrowUpRight className="size-4 text-primary-soft" />Produtos entregues ao cliente</span>}>
            <Table>
              <thead><tr><Th>Item</Th><Th right>Qtd</Th><Th right>Valor</Th>{canSeeCost && <Th right>Custo histórico</Th>}</tr></thead>
              <tbody>{outgoing.map((o) => <tr key={o.id}><Td>{o.description}<div className="text-xs text-muted">{o.sku}{o.internalCode ? ` · ${o.internalCode}` : ''}</div></Td><Td right>{o.quantity}</Td><Td right>{brl(o.totalCents)}</Td>{canSeeCost && <Td right>{brl(o.costCents)}</Td>}</tr>)}</tbody>
            </Table>
            {canSeeCost && <p className="mt-2 text-right text-sm text-success">Resultado bruto da venda: {formatBRL(BigInt(t.saleTotalCents) - cost)}</p>}
          </Card>
          <Card title={<span className="flex items-center gap-2"><ArrowDownLeft className="size-4 text-success" />Produtos recebidos do cliente</span>}>
            <ul className="flex flex-col gap-2">{incoming.map((i) => (
              <li key={i.id} className="rounded-xl border border-line bg-bg p-3 text-sm">
                <div className="flex justify-between gap-2"><span className="font-medium">{i.description}{i.internalCode ? ` · ${i.internalCode}` : ''}</span><span className="tabular">{brl(i.agreedCents)}</span></div>
                <p className="text-xs text-muted">{i.identifiers.map((x) => `${x.kind.toUpperCase()}: ${x.value}`).join(' · ') || 'sem identificador'} · {i.condition ? CONDITION_LABEL[i.condition] ?? i.condition : 'condição não informada'} · destino: {i.destination === 'inspection' ? 'inspeção' : 'disponível'}{i.unitStatus ? ` · agora: ${STATUS_LABEL[i.unitStatus]}` : ''}</p>
                {i.estimatedExtraCostCents !== '0' && <p className="text-xs text-muted">Custo previsto (não realizado): {brl(i.estimatedExtraCostCents)}{i.suggestedPriceCents ? ` · preço sugerido ${brl(i.suggestedPriceCents)}` : ''}</p>}
              </li>
            ))}</ul>
          </Card>
        </div>
        <div className="flex flex-col gap-4">
          <Card title="Dinheiro que transitou" description="Somente a diferença movimenta caixa.">
            {settlements.length ? <ul className="flex flex-col gap-1 text-sm">{settlements.map((s) => <li key={s.id} className="flex justify-between"><span>{s.direction === 'in' ? 'Recebido' : 'Pago'} · {KIND_LABEL[s.method]} · {dateBR(s.settledOn)}{s.reversalOf ? ' (estorno)' : ''}</span><span className="tabular">{brl(s.amountCents)}</span></li>)}</ul> : <p className="text-sm text-muted">Nenhum movimento de caixa.</p>}
          </Card>
          <Card title="Documentos"><DocLinks docs={documents} /></Card>
          {t.reversalReason && <Card title="Reversão"><p className="text-sm text-muted">{dateTimeBR(t.reversedAt)} · {t.reversalReason}</p></Card>}
        </div>
      </div>
      <Modal open={rev} onClose={() => setRev(false)} title="Reverter troca" footer={<>
        <Button variant="secondary" onClick={() => setRev(false)}>Voltar</Button>
        <Button variant="danger" loading={busy} onClick={async () => {
          setBusy(true); setError(null);
          try { await api(`trades/${id}/reverse`, { body: { reason }, idempotencyKey: key }); await qc.invalidateQueries(); toast('Troca revertida; reembolsos gerados como títulos.'); setRev(false); } catch (e) { setError(e); } finally { setBusy(false); }
        }}>Confirmar reversão</Button>
      </>}>
        <div className="flex flex-col gap-3 text-sm">
          <p className="text-muted">Desfaz a venda (itens voltam em inspeção ao custo histórico), retira os itens recebidos, desfaz a compensação e cancela saldos em aberto. Dinheiro que já transitou vira título de reembolso a ser conciliado. Se o item recebido já foi revendido, a reversão simples é bloqueada.</p>
          <Field label="Motivo" htmlFor="rvr" required><Input id="rvr" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
          <FormError error={error} />
        </div>
      </Modal>
    </div>
  );
}
