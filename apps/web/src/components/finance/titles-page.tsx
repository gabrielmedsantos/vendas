'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { AlertTriangle, CalendarClock, CheckCircle2, Hourglass, Search } from 'lucide-react';
import { formatBRL } from '@gct/shared';
import { useAccounts, useDebounced } from '@/components/ops/hooks';
import { Badge, Button, Card, EmptyState, ErrorState, Field, FormError, Input, LoadingBlock, Modal, MoneyInput, PageHeader, Pager, Select, Stat, Table, Tabs, Td, Th } from '@/components/ui';
import { useToast } from '@/components/toast';
import { api, newKey, qs } from '@/lib/client/api';
import { brl, dateBR, dateTimeBR, KIND_LABEL, STATUS_LABEL } from '@/lib/client/format';
import { useCan } from '@/lib/client/session';

interface Title { id: string; direction: string; description: string; originType: string; dueDate: string; installmentNumber: number; installmentCount: number; originalCents: string; balanceCents: string; status: string; partyName: string | null; overdue: boolean }
interface Summary { pendingCents: string; settledTodayCents: string; settledTodayCount: number; dueWeekCents: string; dueWeekCount: number; overdueCents: string; overdueCount: number }
interface TitleDetail { title: Title & { competenceDate: string }; settlements: { id: string; settledOn: string; method: string; accountName: string; amountCents: string; feeCents: string; netCents: string; reversalOf: string | null; reference: string | null }[]; offsets: { id: string; amountCents: string; originType: string; reversalOf: string | null }[]; adjustments: { id: string; kind: string; amountCents: string; reason: string | null; createdAt: string }[]; credits: { id: string; amountCents: string }[] }

export function TitlesPage({ direction }: { direction: 'receivable' | 'payable' }) {
  const can = useCan();
  const qc = useQueryClient();
  const toast = useToast();
  const recv = direction === 'receivable';
  const canSettle = can(recv ? 'finance.settle_receivable' : 'finance.settle_payable');
  const accounts = useAccounts();
  const [status, setStatus] = useState('open');
  const [term, setTerm] = useState('');
  const [cursor, setCursor] = useState<string | undefined>();
  const [selected, setSelected] = useState<Record<string, Title>>({});
  const [settling, setSettling] = useState(false);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [form, setForm] = useState({ accountId: '', method: 'pix', fee: '', settledOn: '', reference: '', confirmed: false });
  const [detail, setDetail] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState(newKey);
  const q = useDebounced(term, 250);
  const list = useQuery({ queryKey: ['titles', direction, status, q, cursor], queryFn: () => api<{ data: Title[]; meta: { cursor: string | null; hasMore: boolean; total: number }; summary: Summary }>(`finance/titles${qs({ direction, status, q, cursor })}`) });
  const det = useQuery({ queryKey: ['title', detail], queryFn: () => api<TitleDetail>(`finance/titles/${detail}`), enabled: !!detail });
  const s = list.data?.summary;
  const sel = Object.values(selected);
  const total = sel.reduce((a, t) => a + BigInt(amounts[t.id] || '0'), 0n);
  const openSettle = () => {
    setAmounts(Object.fromEntries(sel.map((t) => [t.id, t.balanceCents])));
    setForm({ accountId: accounts.data?.find((a) => a.kind === 'bank')?.id ?? accounts.data?.[0]?.id ?? '', method: 'pix', fee: '', settledOn: '', reference: '', confirmed: false });
    setError(null);
    setSettling(true);
  };
  return (
    <div>
      <PageHeader title={recv ? 'Contas a receber' : 'Contas a pagar'} description={recv ? 'Títulos de vendas a prazo, cartões a liquidar e diferenças de troca.' : 'Compras, despesas, reembolsos e diferenças de troca a pagar.'} />
      {s && (
        <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Total pendente" value={brl(s.pendingCents)} icon={<Hourglass className="size-4" />} tone={recv ? 'success' : 'default'} />
          <Stat label={recv ? 'Recebido hoje' : 'Pago hoje'} value={brl(s.settledTodayCents)} hint={`${s.settledTodayCount} liquidação(ões)`} icon={<CheckCircle2 className="size-4" />} />
          <Stat label="Vence em 7 dias" value={brl(s.dueWeekCents)} hint={`${s.dueWeekCount} título(s)`} icon={<CalendarClock className="size-4" />} tone="warning" />
          <Stat label="Atrasados" value={brl(s.overdueCents)} hint={`${s.overdueCount} título(s)`} icon={<AlertTriangle className="size-4" />} tone="danger" />
        </div>
      )}
      <Card>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Tabs value={status} onChange={(v) => { setStatus(v); setCursor(undefined); setSelected({}); }} options={[{ value: 'open', label: 'Em aberto' }, { value: 'overdue', label: 'Atrasados' }, { value: 'due_week', label: 'Vence na semana' }, { value: 'settled', label: 'Liquidados' }, { value: 'all', label: 'Todos' }]} />
          <div className="relative sm:w-72"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" /><Input value={term} onChange={(e) => { setTerm(e.target.value); setCursor(undefined); }} placeholder="Buscar pessoa ou descrição" className="pl-9" aria-label="Buscar títulos" /></div>
        </div>
        {sel.length > 0 && canSettle && (
          <div className="mt-3 flex items-center justify-between rounded-xl border border-primary/40 bg-primary/10 px-3 py-2 text-sm">
            <span>{sel.length} selecionado(s) · {formatBRL(sel.reduce((a, t) => a + BigInt(t.balanceCents), 0n))}</span>
            <Button size="sm" onClick={openSettle}>{recv ? 'Receber' : 'Pagar'} selecionados</Button>
          </div>
        )}
        <div className="mt-4">
          {list.isLoading && <LoadingBlock />}
          {list.error && <ErrorState error={list.error} retry={() => list.refetch()} />}
          {list.data && list.data.data.length === 0 && <EmptyState title={recv ? 'Nenhuma conta a receber' : 'Nenhuma conta a pagar'} description={recv ? 'Vendas a prazo e cartões aparecem aqui.' : 'Compras a prazo e despesas aparecem aqui.'} />}
          {list.data && list.data.data.length > 0 && (
            <>
              <Table>
                <thead><tr>{canSettle && <Th><span className="sr-only">Selecionar</span></Th>}<Th>Vencimento</Th><Th>Pessoa</Th><Th>Descrição</Th><Th right>Original</Th><Th right>Saldo</Th><Th>Situação</Th></tr></thead>
                <tbody>{list.data.data.map((t) => (
                  <tr key={t.id} className="hover:bg-surface-2">
                    {canSettle && <Td>{t.balanceCents !== '0' && t.status !== 'canceled' && <input type="checkbox" aria-label={`Selecionar ${t.description}`} className="accent-[var(--color-primary)]" checked={!!selected[t.id]} onChange={(e) => setSelected((s) => { const n = { ...s }; if (e.target.checked) n[t.id] = t; else delete n[t.id]; return n; })} />}</Td>}
                    <Td className={t.overdue ? 'text-danger-soft' : ''}>{dateBR(t.dueDate)}</Td>
                    <Td>{t.partyName ?? <span className="text-muted">—</span>}</Td>
                    <Td><button className="text-left hover:text-primary-soft" onClick={() => setDetail(t.id)}>{t.description}</button></Td>
                    <Td right>{brl(t.originalCents)}</Td><Td right className="font-medium">{brl(t.balanceCents)}</Td>
                    <Td>{t.overdue ? <Badge tone="danger">Atrasado</Badge> : <Badge tone={t.status === 'settled' ? 'success' : t.status === 'canceled' ? 'neutral' : t.status === 'partially_settled' ? 'info' : 'warning'}>{STATUS_LABEL[t.status]}</Badge>}</Td>
                  </tr>
                ))}</tbody>
              </Table>
              <Pager hasMore={list.data.meta.hasMore} cursor={list.data.meta.cursor} onNext={setCursor} onFirst={() => setCursor(undefined)} isFirst={!cursor} total={list.data.meta.total} />
            </>
          )}
        </div>
      </Card>
      <Modal open={settling} onClose={() => setSettling(false)} title={recv ? 'Registrar recebimento' : 'Registrar pagamento'} footer={<>
        <Button variant="secondary" onClick={() => setSettling(false)}>Cancelar</Button>
        <Button loading={busy} disabled={!form.confirmed} onClick={async () => {
          setBusy(true); setError(null);
          try {
            await api('finance/settlements', { idempotencyKey: key, body: { direction: recv ? 'in' : 'out', method: form.method, accountId: form.accountId, settledOn: form.settledOn || undefined, feeCents: recv && form.fee ? form.fee : undefined, reference: form.reference || null, allocations: sel.map((t) => ({ titleId: t.id, amountCents: amounts[t.id] || '0' })).filter((a) => a.amountCents !== '0') } });
            await qc.invalidateQueries(); toast('Liquidação registrada.'); setSettling(false); setSelected({}); setKey(newKey());
          } catch (e) { setError(e); } finally { setBusy(false); }
        }}>Confirmar</Button>
      </>}>
        <div className="flex flex-col gap-3 text-sm">
          {sel.map((t) => (
            <Field key={t.id} label={`${t.description} (saldo ${formatBRL(t.balanceCents)})`} htmlFor={`amt-${t.id}`}><MoneyInput id={`amt-${t.id}`} value={amounts[t.id] ?? ''} onChange={(c) => setAmounts({ ...amounts, [t.id]: c })} /></Field>
          ))}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Conta" htmlFor="st-acc"><Select id="st-acc" value={form.accountId} onChange={(e) => setForm({ ...form, accountId: e.target.value })}>{accounts.data?.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select></Field>
            <Field label="Meio" htmlFor="st-m"><Select id="st-m" value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })}>{['pix', 'cash', 'bank_transfer', 'debit', 'credit', 'boleto', 'other'].map((m) => <option key={m} value={m}>{KIND_LABEL[m]}</option>)}</Select></Field>
            <Field label="Data" htmlFor="st-d"><Input id="st-d" type="date" value={form.settledOn} onChange={(e) => setForm({ ...form, settledOn: e.target.value })} /></Field>
            {recv && <Field label="Taxa retida (cartão)" htmlFor="st-f" help="Título baixa pelo bruto; conta recebe o líquido."><MoneyInput id="st-f" value={form.fee} onChange={(c) => setForm({ ...form, fee: c })} /></Field>}
          </div>
          <Field label="Referência / comprovante" htmlFor="st-ref"><Input id="st-ref" value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} placeholder="Ex.: ID do Pix" /></Field>
          <p className="rounded-xl border border-line bg-bg px-3 py-2">Total: <strong className="tabular">{formatBRL(total)}</strong>{recv && form.fee ? <> · líquido na conta: <strong className="tabular">{formatBRL(total - BigInt(form.fee || '0'))}</strong></> : null}</p>
          <label className="flex items-start gap-2 text-xs"><input type="checkbox" className="mt-0.5 accent-[var(--color-primary)]" checked={form.confirmed} onChange={(e) => setForm({ ...form, confirmed: e.target.checked })} />Confirmo que o valor {recv ? 'foi recebido' : 'foi pago'} de fato (Pix/transferência conferidos no banco). Não há integração bancária automática.</label>
          <FormError error={error} />
        </div>
      </Modal>
      <Modal open={!!detail} onClose={() => setDetail(null)} title="Histórico do título" wide>
        {det.isLoading ? <LoadingBlock /> : det.data && (
          <div className="flex flex-col gap-4 text-sm">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <div><p className="text-xs text-muted">Original</p><p className="tabular">{brl(det.data.title.originalCents)}</p></div>
              <div><p className="text-xs text-muted">Saldo</p><p className="tabular font-semibold">{brl(det.data.title.balanceCents)}</p></div>
              <div><p className="text-xs text-muted">Competência</p><p>{dateBR(det.data.title.competenceDate)}</p></div>
              <div><p className="text-xs text-muted">Vencimento</p><p>{dateBR(det.data.title.dueDate)}</p></div>
            </div>
            <div>
              <p className="mb-1 font-medium">Liquidações</p>
              {det.data.settlements.length ? <ul className="flex flex-col gap-1">{det.data.settlements.map((st) => (
                <li key={st.id} className="flex items-center justify-between gap-2 rounded-lg border border-line px-3 py-2">
                  <span>{dateBR(st.settledOn)} · {KIND_LABEL[st.method]} · {st.accountName}{st.reversalOf ? ' · estorno' : ''}{st.feeCents !== '0' ? ` · taxa ${brl(st.feeCents)}` : ''}</span>
                  <span className="flex items-center gap-2"><span className="tabular">{brl(st.amountCents)}</span>
                    {!st.reversalOf && can('reversals.execute') && !det.data!.settlements.some((x) => x.reversalOf === st.id) && <Button size="sm" variant="danger" onClick={async () => { const reason = prompt('Motivo do estorno'); if (!reason) return; try { await api(`finance/settlements/${st.id}/reverse`, { body: { reason } }); qc.invalidateQueries(); toast('Liquidação estornada.'); } catch (e) { alert((e as Error).message); } }}>Estornar</Button>}
                  </span>
                </li>
              ))}</ul> : <p className="text-muted">Nenhuma.</p>}
            </div>
            {det.data.offsets.length > 0 && <div><p className="mb-1 font-medium">Compensações (troca)</p><ul>{det.data.offsets.map((o) => <li key={o.id} className="flex justify-between"><span className="text-muted">{o.reversalOf ? 'Estorno de compensação' : 'Compensação sem dinheiro'}</span><span className="tabular">{brl(o.amountCents)}</span></li>)}</ul></div>}
            {det.data.credits.length > 0 && <div><p className="mb-1 font-medium">Crédito da loja usado</p><ul>{det.data.credits.map((c) => <li key={c.id} className="tabular">{brl(c.amountCents)}</li>)}</ul></div>}
            {det.data.adjustments.length > 0 && <div><p className="mb-1 font-medium">Ajustes sem dinheiro</p><ul>{det.data.adjustments.map((a) => <li key={a.id} className="flex justify-between"><span className="text-muted">{dateTimeBR(a.createdAt)} · {a.kind} · {a.reason}</span><span className="tabular">{brl(a.amountCents)}</span></li>)}</ul></div>}
          </div>
        )}
      </Modal>
    </div>
  );
}
