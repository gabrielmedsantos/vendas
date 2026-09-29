'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Hash, Pencil, Plus, Receipt, Search, Tag, Trash2, TrendingDown } from 'lucide-react';
import { monthRange } from '@gct/shared';
import { useAccounts, useDebounced } from '@/components/ops/hooks';
import { Badge, Button, Card, EmptyState, ErrorState, Field, FormError, Input, LoadingBlock, Modal, MoneyInput, PageHeader, Pager, Select, Stat, Table, Td, Th } from '@/components/ui';
import { useToast } from '@/components/toast';
import { api, newKey, qs } from '@/lib/client/api';
import { brl, dateBR, KIND_LABEL } from '@/lib/client/format';
import { useCan } from '@/lib/client/session';

interface Row { id: string; kind: string; description: string; competenceDate: string; amountCents: string; categoryName: string | null; balanceCents: string | null; titleStatus: string | null; notes: string | null }

export default function ExpensesPage() {
  const can = useCan();
  const qc = useQueryClient();
  const toast = useToast();
  const accounts = useAccounts();
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
  const m = monthRange(today);
  const [from, setFrom] = useState(m.from);
  const [to, setTo] = useState(m.to);
  const [categoryId, setCategoryId] = useState('');
  const [term, setTerm] = useState('');
  const [cursor, setCursor] = useState<string | undefined>();
  const [creating, setCreating] = useState(false);
  const [replacing, setReplacing] = useState<Row | null>(null);
  const [removing, setRemoving] = useState<Row | null>(null);
  const [reason, setReason] = useState('');
  const [f, setF] = useState({ description: '', categoryId: '', amount: '', competenceDate: today, dueDate: today, paid: true, accountId: '', method: 'pix', notes: '' });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState(newKey);
  const q = useDebounced(term, 250);
  const cats = useQuery({ queryKey: ['expense-categories'], queryFn: () => api<{ id: string; name: string }[]>('finance/expense-categories') });
  const list = useQuery({ queryKey: ['expenses', from, to, categoryId, q, cursor], queryFn: () => api<{ data: Row[]; meta: { cursor: string | null; hasMore: boolean }; summary: { totalCents: string; count: number; averageCents: string | null; topCategory: { name: string; amountCents: string } | null } }>(`finance/expenses${qs({ from, to, categoryId, q, cursor })}`) });
  const s = list.data?.summary;
  return (
    <div>
      <PageHeader title="Despesas operacionais" description="Aluguel, energia, marketing, frete de venda e outras despesas por competência. Compra de mercadoria não é despesa: vira custo quando vendida." actions={can('finance.manage') && <Button onClick={() => { setF({ ...f, accountId: accounts.data?.find((a) => a.kind === 'bank')?.id ?? '' }); setError(null); setCreating(true); }}><Plus className="size-4" />Nova despesa</Button>} />
      {s && (
        <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Total no período" value={brl(s.totalCents)} tone="danger" icon={<Receipt className="size-4" />} />
          <Stat label="Lançamentos" value={s.count} icon={<Hash className="size-4" />} />
          <Stat label="Maior categoria" value={s.topCategory ? brl(s.topCategory.amountCents) : '—'} hint={s.topCategory?.name ?? 'Sem despesas no período'} icon={<Tag className="size-4" />} />
          <Stat label="Média por despesa" value={brl(s.averageCents)} icon={<TrendingDown className="size-4" />} />
        </div>
      )}
      <Card>
        <div className="grid gap-2 sm:grid-cols-[auto_auto_1fr_auto]">
          <Input type="date" aria-label="De" value={from} onChange={(e) => { setFrom(e.target.value); setCursor(undefined); }} />
          <Input type="date" aria-label="Até" value={to} onChange={(e) => { setTo(e.target.value); setCursor(undefined); }} />
          <div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" /><Input value={term} onChange={(e) => { setTerm(e.target.value); setCursor(undefined); }} placeholder="Pesquisar descrição" className="pl-9" aria-label="Pesquisar despesas" /></div>
          <Select aria-label="Categoria" value={categoryId} onChange={(e) => { setCategoryId(e.target.value); setCursor(undefined); }}><option value="">Todas as categorias</option>{cats.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
        </div>
        <p className="mt-2 text-xs text-muted">Os resumos usam só o período; a lista aplica também pesquisa e categoria.</p>
        <div className="mt-4">
          {list.isLoading && <LoadingBlock />}
          {list.error && <ErrorState error={list.error} />}
          {list.data && list.data.data.length === 0 && <EmptyState icon={<Receipt className="size-5" />} title="Nenhuma despesa neste período" description="Registre aluguel, tráfego, frete e outras despesas para acompanhar o impacto no resultado." />}
          {list.data && list.data.data.length > 0 && (
            <>
              <Table>
                <thead><tr><Th>Competência</Th><Th>Descrição</Th><Th>Categoria</Th><Th>Pagamento</Th><Th right>Valor</Th><Th /></tr></thead>
                <tbody>{list.data.data.map((e) => (
                  <tr key={e.id}><Td>{dateBR(e.competenceDate)}</Td><Td>{e.description}{e.notes && <div className="text-xs text-muted">{e.notes}</div>}</Td><Td>{e.kind === 'inventory_loss' ? <Badge tone="warning">Perda de estoque</Badge> : e.categoryName ?? '—'}</Td>
                    <Td>{e.titleStatus ? <Badge tone={e.titleStatus === 'settled' ? 'success' : 'warning'}>{e.titleStatus === 'settled' ? 'Pago' : 'A pagar'}</Badge> : '—'}</Td>
                    <Td right>{brl(e.amountCents)}</Td>
                    <Td right>{e.kind === 'operating' && can('finance.manage') && (
                      <span className="flex justify-end gap-1">
                        <Button size="sm" variant="quiet" onClick={() => {
                          setReplacing(e); setError(null); setKey(newKey());
                          setF({ description: e.description, categoryId: cats.data?.find((c) => c.name === e.categoryName)?.id ?? '', amount: e.amountCents, competenceDate: e.competenceDate, dueDate: e.competenceDate, paid: e.titleStatus === 'settled', accountId: accounts.data?.[0]?.id ?? '', method: 'pix', notes: e.notes ?? '' });
                          setCreating(true);
                        }}><Pencil className="size-3.5" />Corrigir</Button>
                        <Button size="sm" variant="quiet" aria-label={`Excluir ${e.description}`} onClick={() => { setRemoving(e); setReason(''); setError(null); }}><Trash2 className="size-3.5" />Excluir</Button>
                      </span>
                    )}</Td>
                  </tr>
                ))}</tbody>
              </Table>
              <Pager hasMore={list.data.meta.hasMore} cursor={list.data.meta.cursor} onNext={setCursor} onFirst={() => setCursor(undefined)} isFirst={!cursor} />
            </>
          )}
        </div>
      </Card>
      <Modal open={!!removing} onClose={() => setRemoving(null)} title="Excluir despesa" footer={<>
        <Button variant="secondary" onClick={() => setRemoving(null)}>Voltar</Button>
        <Button variant="danger" loading={busy} disabled={reason.trim().length < 3} onClick={async () => {
          setBusy(true); setError(null);
          try { await api(`finance/expenses/${removing!.id}/cancel`, { body: { reason: reason.trim() } }); await qc.invalidateQueries(); toast('Despesa excluída; valor devolvido à conta.'); setRemoving(null); } catch (e) { setError(e); } finally { setBusy(false); }
        }}>Excluir</Button>
      </>}>
        {removing && (
          <div className="flex flex-col gap-3 text-sm">
            <p><span className="font-medium">{removing.description}</span> · {brl(removing.amountCents)}</p>
            <p className="text-muted">A despesa sai do resultado{removing.titleStatus === 'settled' ? ' e o pagamento é estornado: o valor volta para a conta' : ''}. Fica registrado no histórico quem excluiu e o motivo.</p>
            <Field label="Motivo" htmlFor="ex-rm"><Input id="ex-rm" value={reason} maxLength={300} placeholder="Ex.: lançada em duplicidade" onChange={(e) => setReason(e.target.value)} /></Field>
            <FormError error={error} />
          </div>
        )}
      </Modal>
      <Modal open={creating} onClose={() => { setCreating(false); setReplacing(null); }} title={replacing ? 'Corrigir despesa' : 'Nova despesa'} footer={<>
        <Button variant="secondary" onClick={() => { setCreating(false); setReplacing(null); }}>Cancelar</Button>
        <Button loading={busy} onClick={async () => {
          setBusy(true); setError(null);
          try {
            // Corrigir = estorna a despesa original (pagamento volta para a conta) e registra a correta.
            if (replacing) { await api(`finance/expenses/${replacing.id}/cancel`, { body: { reason: `Corrigida: ${f.description}`.slice(0, 500) } }); setReplacing(null); }
            await api('finance/expenses', { idempotencyKey: key, body: { description: f.description, categoryId: f.categoryId || null, amountCents: f.amount, competenceDate: f.competenceDate, dueDate: f.dueDate, payNow: f.paid ? { accountId: f.accountId || accounts.data?.[0]?.id, method: f.method } : null, notes: f.notes || null } });
            await qc.invalidateQueries(); toast(replacing ? 'Despesa corrigida.' : 'Despesa registrada.'); setCreating(false); setKey(newKey());
          } catch (e) { await qc.invalidateQueries(); setError(e); } finally { setBusy(false); }
        }}>{replacing ? 'Salvar correção' : 'Registrar'}</Button>
      </>}>
        <div className="flex flex-col gap-3">
          {replacing && <p className="rounded-xl border border-line bg-bg p-3 text-xs text-muted">Ao salvar, a despesa original é estornada (se foi paga, o valor volta para a conta) e esta é registrada no lugar. Os dois lançamentos ficam no histórico.</p>}
          <Field label="Descrição" htmlFor="ex-d" required><Input id="ex-d" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Categoria" htmlFor="ex-c"><Select id="ex-c" value={f.categoryId} onChange={(e) => setF({ ...f, categoryId: e.target.value })}><option value="">Sem categoria</option>{cats.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
            <Field label="Valor" htmlFor="ex-v" required><MoneyInput id="ex-v" value={f.amount} onChange={(c) => setF({ ...f, amount: c })} /></Field>
            <Field label="Competência" htmlFor="ex-comp"><Input id="ex-comp" type="date" value={f.competenceDate} onChange={(e) => setF({ ...f, competenceDate: e.target.value })} /></Field>
            <Field label="Vencimento" htmlFor="ex-due"><Input id="ex-due" type="date" value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value })} /></Field>
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-[var(--color-primary)]" checked={f.paid} onChange={(e) => setF({ ...f, paid: e.target.checked })} />Já foi paga</label>
          {f.paid && <div className="grid grid-cols-2 gap-3">
            <Select aria-label="Conta" value={f.accountId} onChange={(e) => setF({ ...f, accountId: e.target.value })}>{accounts.data?.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select>
            <Select aria-label="Meio" value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}>{['pix', 'cash', 'bank_transfer', 'boleto', 'debit', 'credit'].map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</Select>
          </div>}
          <Field label="Observações" htmlFor="ex-n"><Input id="ex-n" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
          <FormError error={error} />
        </div>
      </Modal>
    </div>
  );
}
