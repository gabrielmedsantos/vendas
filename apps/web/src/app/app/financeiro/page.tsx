'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ArrowLeftRight, Banknote, Lock, Merge, Plus, Scale, Undo2, Vault } from 'lucide-react';
import { useAccounts } from '@/components/ops/hooks';
import { Badge, Button, Card, cx, ErrorState, Field, FormError, Input, LoadingBlock, Modal, MoneyInput, PageHeader, Pager, Select, Table, Td, Th } from '@/components/ui';
import { useToast } from '@/components/toast';
import { api, newKey, qs } from '@/lib/client/api';
import { brl, dateBR, KIND_LABEL } from '@/lib/client/format';
import { useCan } from '@/lib/client/session';

type Dialog = null | 'movement' | 'transfer' | 'account' | 'open' | 'close' | 'period' | 'unify' | 'adjust' | 'reverse';

export default function FinancePage() {
  const can = useCan();
  const qc = useQueryClient();
  const toast = useToast();
  const accounts = useAccounts();
  const [cursor, setCursor] = useState<string | undefined>();
  const [accountFilter, setAccountFilter] = useState('');
  const moves = useQuery({ queryKey: ['cash-moves', cursor, accountFilter], queryFn: () => api<{ data: { id: string; occurredOn: string; direction: string; amountCents: string; kind: string; originType: string; description: string | null; accountName: string; reversed: boolean; reversalOf: string | null }[]; meta: { cursor: string | null; hasMore: boolean } }>(`finance/cash-movements${qs({ cursor, accountId: accountFilter })}`) });
  const breakdown = useQuery({ queryKey: ['balance-breakdown'], queryFn: () => api<{ items: { label: string; cents: string; count: number }[]; balanceCents: string; openPayableCents: string; openReceivableCents: string; stockCostCents?: string }>('finance/balance-breakdown') });
  const periods = useQuery({ queryKey: ['periods'], queryFn: () => api<{ period: string; status: string; reason: string | null }[]>('finance/periods') });
  const [dialog, setDialog] = useState<Dialog>(null);
  const [f, setF] = useState<Record<string, string>>({});
  const [target, setTarget] = useState<string>('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState(newKey);
  const open = (d: Dialog, init: Record<string, string> = {}) => { setF(init); setError(null); setDialog(d); };
  const run = async (fn: () => Promise<unknown>, msg: string) => {
    setBusy(true); setError(null);
    try { await fn(); await qc.invalidateQueries(); toast(msg); setDialog(null); setKey(newKey()); } catch (e) { setError(e); } finally { setBusy(false); }
  };
  const manage = can('finance.manage');
  const total = accounts.data?.reduce((a, x) => a + BigInt(x.balanceCents), 0n) ?? 0n;
  return (
    <div>
      <PageHeader title="Financeiro" description="Saldos atuais das contas e livro de caixa realizado." actions={manage && <>
        {(accounts.data?.length ?? 0) > 1 && <Button variant="secondary" onClick={() => open('transfer', { from: accounts.data?.[0]?.id ?? '', to: accounts.data?.[1]?.id ?? '' })}><ArrowLeftRight className="size-4" />Transferência</Button>}
        <Button variant="secondary" onClick={() => open('movement', { kind: 'capital_in', accountId: accounts.data?.[0]?.id ?? '' })}><Banknote className="size-4" />Lançamento</Button>
        <Button onClick={() => open('account', { kind: 'bank' })}><Plus className="size-4" />Nova conta</Button>
      </>} />
      {accounts.isLoading && <LoadingBlock />}
      {accounts.error && <ErrorState error={accounts.error} />}
      {manage && accounts.data && accounts.data.length > 1 && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-primary/40 bg-primary/10 p-4 text-sm">
          <div>
            <p className="font-medium">Você tem {accounts.data.length} contas. Quer deixar uma só?</p>
            <p className="text-muted">O saldo das outras vai para a conta escolhida, dinheiro, Pix e cartões passam a entrar nela e as outras são arquivadas. O histórico continua.</p>
          </div>
          <Button onClick={() => open('unify', { targetId: (accounts.data!.find((a) => a.kind === 'bank') ?? accounts.data![0]!).id, name: 'Conta da loja' })}><Merge className="size-4" />Unificar contas</Button>
        </div>
      )}
      {accounts.data && (
        <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-2xl border border-primary/40 bg-primary/10 p-4"><p className="text-xs text-muted">Saldo total (hoje)</p><p className="mt-1 text-2xl font-semibold tabular">{brl(total.toString())}</p></div>
          {accounts.data.map((a) => (
            <div key={a.id} className="rounded-2xl border border-line bg-surface p-4">
              <div className="flex items-center justify-between"><p className="text-sm font-medium">{a.name}</p><Badge tone={a.kind === 'cash' ? 'warning' : 'info'}>{a.kind === 'cash' ? 'Caixa' : a.kind === 'bank' ? 'Banco' : 'Outra'}</Badge></div>
              <p className="mt-2 text-xl font-semibold tabular">{brl(a.balanceCents)}</p>
              {manage && <Button size="sm" variant="quiet" className="mt-1 -ml-2" onClick={() => { setTarget(a.id); open('adjust', { target: '', reason: 'Conferência com o saldo real' }); }}><Scale className="size-3.5" />Ajustar saldo</Button>}
              {a.kind === 'cash' && manage && (
                <div className="mt-2">{a.openSession
                  ? <Button size="sm" variant="secondary" onClick={() => { setTarget(a.openSession!); open('close', { counted: '' }); }}><Lock className="size-3.5" />Fechar caixa</Button>
                  : <Button size="sm" variant="secondary" onClick={() => { setTarget(a.id); open('open', { counted: a.balanceCents }); }}><Vault className="size-3.5" />Abrir caixa</Button>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {breakdown.data && (
        <Card className="mb-4" title="De onde vem o saldo" description="Tudo que entrou menos tudo que saiu das contas, por tipo. É dinheiro, não lucro.">
          <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
            <div>
              {breakdown.data.items.length === 0 ? <p className="text-sm text-muted">Nenhum movimento ainda.</p> : (
                <ul className="divide-y divide-line text-sm">
                  {breakdown.data.items.map((l) => (
                    <li key={l.label} className="flex items-center justify-between gap-3 py-2">
                      <span>{l.label} <span className="text-xs text-muted">({l.count})</span></span>
                      <span className={cx('tabular font-medium', BigInt(l.cents) >= 0n ? 'text-success' : 'text-danger-soft')}>{BigInt(l.cents) >= 0n ? '+' : '−'}{brl((BigInt(l.cents) < 0n ? -BigInt(l.cents) : BigInt(l.cents)).toString())}</span>
                    </li>
                  ))}
                  <li className="flex items-center justify-between gap-3 py-2 font-semibold"><span>Saldo nas contas</span><span className="tabular">{brl(breakdown.data.balanceCents)}</span></li>
                </ul>
              )}
            </div>
            <div className="flex flex-col gap-3 rounded-xl border border-line bg-bg p-4 text-sm">
              <p className="font-medium">Ainda não passou pela conta</p>
              <div className="flex justify-between"><span className="text-muted">Contas a pagar em aberto</span><span className="tabular text-danger-soft">{brl(breakdown.data.openPayableCents)}</span></div>
              <div className="flex justify-between"><span className="text-muted">Contas a receber em aberto</span><span className="tabular text-success">{brl(breakdown.data.openReceivableCents)}</span></div>
              {breakdown.data.stockCostCents !== undefined && <div className="flex justify-between"><span className="text-muted">Mercadoria em estoque (a custo)</span><span className="tabular">{brl(breakdown.data.stockCostCents)}</span></div>}
              <p className="text-xs text-muted">Compra lançada “a pagar” só sai da conta quando você der baixa em A pagar. O dinheiro usado em mercadoria que ainda está no estoque não some: virou produto e aparece aqui a custo. Gasto pago que não aparece na lista ao lado ainda não foi lançado no sistema.</p>
            </div>
          </div>
        </Card>
      )}
      <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
        <Card title="Movimentos de caixa e banco" description="Somente dinheiro que efetivamente entrou ou saiu. Vendas a prazo aparecem quando recebidas." action={
          <div className="w-48"><Select aria-label="Conta" value={accountFilter} onChange={(e) => { setAccountFilter(e.target.value); setCursor(undefined); }}><option value="">Todas as contas</option>{accounts.data?.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select></div>
        }>
          {moves.isLoading && <LoadingBlock />}
          {moves.data && moves.data.data.length === 0 && <p className="py-8 text-center text-sm text-muted">Nenhum movimento ainda.</p>}
          {moves.data && moves.data.data.length > 0 && (
            <>
              <Table>
                <thead><tr><Th>Data</Th><Th>Conta</Th><Th>Tipo</Th><Th>Descrição</Th><Th right>Valor</Th>{manage && <Th />}</tr></thead>
                <tbody>{moves.data.data.map((m) => (
                  <tr key={m.id}><Td>{dateBR(m.occurredOn)}</Td><Td>{m.accountName}</Td><Td>{KIND_LABEL[m.kind] ?? m.kind}</Td><Td className="text-muted">{m.description ?? ''}</Td><Td right className={m.direction === 'in' ? 'text-success' : 'text-danger-soft'}>{m.direction === 'in' ? '+' : '−'}{brl(m.amountCents)}</Td>
                    {manage && <Td right>{m.reversed ? <Badge tone="neutral">Estornado</Badge> : ['manual', 'balance_adjustment'].includes(m.originType) && m.kind !== 'reversal'
                      ? <Button size="sm" variant="quiet" onClick={() => { setTarget(m.id); open('reverse', { reason: '' }); }}><Undo2 className="size-3.5" />Estornar</Button>
                      : null}</Td>}</tr>
                ))}</tbody>
              </Table>
              <Pager hasMore={moves.data.meta.hasMore} cursor={moves.data.meta.cursor} onNext={setCursor} onFirst={() => setCursor(undefined)} isFirst={!cursor} />
            </>
          )}
        </Card>
        <Card title="Períodos" description="Período fechado não aceita lançamentos retroativos sem reabertura auditada." action={manage && <Button size="sm" variant="secondary" onClick={() => open('period', { period: new Date().toISOString().slice(0, 7), status: 'closed' })}>Fechar/reabrir</Button>}>
          {periods.data?.length ? <ul className="flex flex-col gap-1 text-sm">{periods.data.map((p) => <li key={p.period} className="flex justify-between"><span>{p.period}</span><Badge tone={p.status === 'closed' ? 'warning' : 'info'}>{p.status === 'closed' ? 'Fechado' : 'Reaberto'}</Badge></li>)}</ul> : <p className="text-sm text-muted">Nenhum período fechado.</p>}
        </Card>
      </div>

      <Modal open={dialog === 'movement'} onClose={() => setDialog(null)} title="Lançamento financeiro" footer={<><Button variant="secondary" onClick={() => setDialog(null)}>Cancelar</Button><Button loading={busy} onClick={() => run(() => api('finance/cash-movements', { idempotencyKey: key, body: { accountId: f.accountId || accounts.data?.[0]?.id, kind: f.kind, direction: f.kind === 'cash_adjustment' ? f.direction || 'in' : undefined, amountCents: f.amount, occurredOn: f.date || undefined, description: f.description } }), 'Lançamento registrado.')}>Registrar</Button></>}>
        <div className="flex flex-col gap-3">
          <p className="text-xs text-muted">Aportes, retiradas, empréstimos e saldo inicial têm tipos próprios e não entram na receita de vendas nem nas despesas operacionais.</p>
          <Field label="Tipo" htmlFor="mv-k"><Select id="mv-k" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{['opening', 'capital_in', 'withdrawal', 'loan_in', 'loan_out', 'cash_adjustment'].map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</Select></Field>
          {f.kind === 'cash_adjustment' && <Field label="Sentido" htmlFor="mv-dir"><Select id="mv-dir" value={f.direction ?? 'in'} onChange={(e) => setF({ ...f, direction: e.target.value })}><option value="in">Entrada</option><option value="out">Saída</option></Select></Field>}
          <Field label="Conta" htmlFor="mv-acc"><Select id="mv-acc" value={f.accountId} onChange={(e) => setF({ ...f, accountId: e.target.value })}>{accounts.data?.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select></Field>
          <Field label="Valor" htmlFor="mv-v"><MoneyInput id="mv-v" value={f.amount ?? ''} onChange={(c) => setF({ ...f, amount: c })} /></Field>
          <Field label="Data" htmlFor="mv-d"><Input id="mv-d" type="date" value={f.date ?? ''} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
          <Field label="Descrição" htmlFor="mv-desc" required><Input id="mv-desc" value={f.description ?? ''} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
          <FormError error={error} />
        </div>
      </Modal>
      {dialog === 'adjust' && (() => {
        const acc = accounts.data?.find((a) => a.id === target);
        const cur = BigInt(acc?.balanceCents ?? '0');
        const diff = f.target !== '' && f.target !== undefined ? BigInt(f.target) - cur : null;
        return (
          <Modal open onClose={() => setDialog(null)} title={`Ajustar saldo · ${acc?.name ?? ''}`} footer={<><Button variant="secondary" onClick={() => setDialog(null)}>Cancelar</Button><Button loading={busy} disabled={diff === null || diff === 0n || (f.reason ?? '').trim().length < 3} onClick={() => run(() => api(`finance/accounts/${target}/adjust-balance`, { idempotencyKey: key, body: { targetCents: f.target, reason: (f.reason ?? '').trim() } }), 'Saldo ajustado.')}>Ajustar</Button></>}>
            <div className="flex flex-col gap-3 text-sm">
              <p className="text-muted">Saldo no sistema: <span className="font-semibold text-fg tabular">{brl(cur.toString())}</span></p>
              <Field label="Quanto tem de verdade nesta conta?" htmlFor="adj-target" help="Confira no extrato do banco ou conte o dinheiro."><MoneyInput id="adj-target" value={f.target ?? ''} onChange={(c) => setF({ ...f, target: c })} /></Field>
              {diff !== null && diff !== 0n && (
                <p className={diff > 0n ? 'text-success' : 'text-danger-soft'}>Será lançado um ajuste de {diff > 0n ? 'entrada' : 'saída'} de {brl((diff > 0n ? diff : -diff).toString())}.</p>
              )}
              {diff === 0n && <p className="text-muted">O saldo já está igual; nada a ajustar.</p>}
              <Field label="Motivo" htmlFor="adj-reason"><Input id="adj-reason" maxLength={300} value={f.reason ?? ''} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>
              <p className="text-xs text-muted">O ajuste não conta como receita nem despesa e fica registrado no livro de caixa com o motivo. Gastos conhecidos (compras, despesas) é melhor lançar nas telas próprias, para aparecerem nos relatórios.</p>
              <FormError error={error} />
            </div>
          </Modal>
        );
      })()}
      <Modal open={dialog === 'reverse'} onClose={() => setDialog(null)} title="Estornar lançamento" footer={<><Button variant="secondary" onClick={() => setDialog(null)}>Voltar</Button><Button variant="danger" loading={busy} disabled={(f.reason ?? '').trim().length < 3} onClick={() => run(() => api(`finance/cash-movements/${target}/reverse`, { body: { reason: (f.reason ?? '').trim() } }), 'Lançamento estornado.')}>Estornar</Button></>}>
        <div className="flex flex-col gap-3 text-sm">
          <p className="text-muted">Cria um lançamento oposto de mesmo valor, que anula o original. Os dois ficam no histórico. Movimentos de venda, compra e despesa se estornam na própria tela deles.</p>
          <Field label="Motivo" htmlFor="rv-reason"><Input id="rv-reason" maxLength={300} placeholder="Ex.: lançado errado" value={f.reason ?? ''} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>
          <FormError error={error} />
        </div>
      </Modal>
      <Modal open={dialog === 'unify'} onClose={() => setDialog(null)} title="Unificar contas" footer={<><Button variant="secondary" onClick={() => setDialog(null)}>Cancelar</Button><Button loading={busy} disabled={!f.targetId || (f.name ?? '').trim().length < 2} onClick={() => run(() => api('finance/accounts/unify', { body: { targetId: f.targetId, name: f.name?.trim() || undefined } }), 'Contas unificadas: agora tudo entra numa conta só.')}>Unificar</Button></>}>
        <div className="flex flex-col gap-3 text-sm">
          <Field label="Conta que fica" htmlFor="un-target">
            <Select id="un-target" value={f.targetId ?? ''} onChange={(e) => setF({ ...f, targetId: e.target.value })}>
              {accounts.data?.map((a) => <option key={a.id} value={a.id}>{a.name} · {brl(a.balanceCents)}</option>)}
            </Select>
          </Field>
          <Field label="Nome da conta" htmlFor="un-name"><Input id="un-name" maxLength={80} value={f.name ?? ''} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <ul className="list-disc pl-5 text-muted">
            <li>Saldo das outras contas: transferido para a conta que fica ({brl(total.toString())} no total). Transferência não é receita nem despesa.</li>
            <li>Dinheiro, Pix, débito, crédito e transferência passam a entrar nesta conta.</li>
            <li>As outras contas são arquivadas; os movimentos antigos continuam no histórico.</li>
          </ul>
          <FormError error={error} />
        </div>
      </Modal>
      <Modal open={dialog === 'transfer'} onClose={() => setDialog(null)} title="Transferência entre contas" footer={<><Button variant="secondary" onClick={() => setDialog(null)}>Cancelar</Button><Button loading={busy} onClick={() => run(() => api('finance/transfers', { idempotencyKey: key, body: { fromAccountId: f.from, toAccountId: f.to, amountCents: f.amount, description: f.description || undefined } }), 'Transferência registrada.')}>Transferir</Button></>}>
        <div className="flex flex-col gap-3">
          <p className="text-xs text-muted">Transferência interna (sangria, depósito) não é receita nem despesa.</p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="De" htmlFor="tr-f"><Select id="tr-f" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })}>{accounts.data?.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select></Field>
            <Field label="Para" htmlFor="tr-t"><Select id="tr-t" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })}>{accounts.data?.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select></Field>
          </div>
          <Field label="Valor" htmlFor="tr-v"><MoneyInput id="tr-v" value={f.amount ?? ''} onChange={(c) => setF({ ...f, amount: c })} /></Field>
          <Field label="Descrição" htmlFor="tr-d"><Input id="tr-d" value={f.description ?? ''} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
          <FormError error={error} />
        </div>
      </Modal>
      <Modal open={dialog === 'account'} onClose={() => setDialog(null)} title="Nova conta" footer={<><Button variant="secondary" onClick={() => setDialog(null)}>Cancelar</Button><Button loading={busy} onClick={() => run(() => api('finance/accounts', { body: { name: f.name, kind: f.kind } }), 'Conta criada.')}>Criar</Button></>}>
        <div className="flex flex-col gap-3">
          <Field label="Nome" htmlFor="ac-n"><Input id="ac-n" value={f.name ?? ''} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Tipo" htmlFor="ac-k"><Select id="ac-k" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}><option value="bank">Banco</option><option value="cash">Caixa físico</option><option value="card_transit">Cartões em trânsito</option><option value="other">Outra</option></Select></Field>
          <FormError error={error} />
        </div>
      </Modal>
      <Modal open={dialog === 'open'} onClose={() => setDialog(null)} title="Abrir caixa" footer={<><Button variant="secondary" onClick={() => setDialog(null)}>Cancelar</Button><Button loading={busy} onClick={() => run(() => api('finance/cash-sessions', { body: { accountId: target, countedCents: f.counted || '0' } }), 'Caixa aberto.')}>Abrir</Button></>}>
        <Field label="Valor contado na gaveta" htmlFor="op-c"><MoneyInput id="op-c" value={f.counted ?? ''} onChange={(c) => setF({ ...f, counted: c })} /></Field>
        <div className="mt-3"><FormError error={error} /></div>
      </Modal>
      <Modal open={dialog === 'close'} onClose={() => setDialog(null)} title="Fechar caixa" footer={<><Button variant="secondary" onClick={() => setDialog(null)}>Cancelar</Button><Button loading={busy} onClick={() => run(() => api('finance/cash-sessions/' + target + '/close', { body: { countedCents: f.counted || '0', justification: f.justification || undefined } }), 'Caixa fechado.')}>Fechar</Button></>}>
        <div className="flex flex-col gap-3">
          <Field label="Valor contado" htmlFor="cl-c"><MoneyInput id="cl-c" value={f.counted ?? ''} onChange={(c) => setF({ ...f, counted: c })} /></Field>
          <Field label="Justificativa (obrigatória se houver diferença)" htmlFor="cl-j"><Input id="cl-j" value={f.justification ?? ''} onChange={(e) => setF({ ...f, justification: e.target.value })} /></Field>
          <FormError error={error} />
        </div>
      </Modal>
      <Modal open={dialog === 'period'} onClose={() => setDialog(null)} title="Fechar ou reabrir período" footer={<><Button variant="secondary" onClick={() => setDialog(null)}>Cancelar</Button><Button loading={busy} onClick={() => run(() => api('finance/periods', { body: { period: f.period, status: f.status, reason: f.reason } }), 'Período atualizado.')}>Confirmar</Button></>}>
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Mês (AAAA-MM)" htmlFor="pd-p"><Input id="pd-p" value={f.period ?? ''} onChange={(e) => setF({ ...f, period: e.target.value })} /></Field>
            <Field label="Ação" htmlFor="pd-s"><Select id="pd-s" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="closed">Fechar</option><option value="reopened">Reabrir</option></Select></Field>
          </div>
          <Field label="Motivo" htmlFor="pd-r" required><Input id="pd-r" value={f.reason ?? ''} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>
          <FormError error={error} />
        </div>
      </Modal>
    </div>
  );
}
