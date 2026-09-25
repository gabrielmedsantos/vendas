'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Plus } from 'lucide-react';
import { useAccounts, useChannels, usePaymentMethods, type Channel, type PaymentMethod } from '@/components/ops/hooks';
import { Badge, Button, Card, Field, FormError, Input, LoadingBlock, Modal, NoPermission, PageHeader, Select, Table, Td, Th } from '@/components/ui';
import { useToast } from '@/components/toast';
import { api } from '@/lib/client/api';
import { KIND_LABEL, pct } from '@/lib/client/format';
import { useCan } from '@/lib/client/session';

const toBps = (s: string) => Math.round(Number((s || '0').replace(',', '.')) * 100);
const fromBps = (b: number) => (b / 100).toString().replace('.', ',');

export default function PaymentsSettings() {
  const can = useCan();
  const qc = useQueryClient();
  const toast = useToast();
  const channels = useChannels();
  const methods = usePaymentMethods();
  const accounts = useAccounts();
  const [ch, setCh] = useState<(Partial<Channel> & { commission: string }) | null>(null);
  const [pm, setPm] = useState<(Partial<PaymentMethod> & { fee: string; instFees: string }) | null>(null);
  const [error, setError] = useState<unknown>(null);
  if (!can('settings.manage')) return <NoPermission />;
  return (
    <div>
      <PageHeader title="Canais e formas de pagamento" description="Taxas e comissões ficam congeladas em cada venda: mudar aqui não altera vendas anteriores." />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Canais de venda" action={<Button size="sm" onClick={() => { setError(null); setCh({ name: '', commission: '0', active: true }); }}><Plus className="size-4" />Canal</Button>}>
          {channels.isLoading ? <LoadingBlock /> : (
            <Table><thead><tr><Th>Canal</Th><Th right>Comissão</Th><Th>Situação</Th><Th /></tr></thead>
              <tbody>{channels.data?.map((c) => <tr key={c.id}><Td>{c.name}</Td><Td right>{pct(c.commissionBps)}</Td><Td><Badge tone={c.active ? 'success' : 'neutral'}>{c.active ? 'Ativo' : 'Inativo'}</Badge></Td><Td right><Button size="sm" variant="quiet" onClick={() => { setError(null); setCh({ ...c, commission: fromBps(c.commissionBps) }); }}>Editar</Button></Td></tr>)}</tbody></Table>
          )}
        </Card>
        <Card title="Formas de pagamento" action={<Button size="sm" onClick={() => { setError(null); setPm({ name: '', kind: 'pix', fee: '0', instFees: '', settlementDays: 0, accountId: accounts.data?.[0]?.id ?? null, active: true }); }}><Plus className="size-4" />Forma</Button>}>
          {methods.isLoading ? <LoadingBlock /> : (
            <Table><thead><tr><Th>Forma</Th><Th>Tipo</Th><Th right>Taxa</Th><Th right>Prazo</Th><Th>Conta</Th><Th /></tr></thead>
              <tbody>{methods.data?.map((m) => <tr key={m.id}><Td>{m.name}{!m.active && <span className="ml-1 text-xs text-muted">(inativa)</span>}</Td><Td>{KIND_LABEL[m.kind]}</Td><Td right>{pct(m.feeBps)}</Td><Td right>{m.settlementDays} d</Td><Td className="text-muted">{m.accountName ?? '—'}</Td><Td right><Button size="sm" variant="quiet" onClick={() => { setError(null); setPm({ ...m, fee: fromBps(m.feeBps), instFees: Object.entries(m.installmentFeeBps).map(([k, v]) => `${k}:${fromBps(v)}`).join(' ') }); }}>Editar</Button></Td></tr>)}</tbody></Table>
          )}
        </Card>
      </div>
      <Modal open={!!ch} onClose={() => setCh(null)} title={ch?.id ? 'Editar canal' : 'Novo canal'} footer={<>
        <Button variant="secondary" onClick={() => setCh(null)}>Cancelar</Button>
        <Button onClick={async () => { setError(null); try { const body = { name: ch!.name, commissionBps: toBps(ch!.commission), active: ch!.active }; if (ch!.id) await api(`channels/${ch!.id}`, { method: 'PUT', body }); else await api('channels', { body }); qc.invalidateQueries({ queryKey: ['channels'] }); setCh(null); toast('Canal salvo.'); } catch (e) { setError(e); } }}>Salvar</Button>
      </>}>
        {ch && <div className="flex flex-col gap-3">
          <Field label="Nome" htmlFor="ch-n"><Input id="ch-n" value={ch.name ?? ''} onChange={(e) => setCh({ ...ch, name: e.target.value })} /></Field>
          <Field label="Comissão/custo do canal (%)" htmlFor="ch-c" help="Ex.: marketplace. Entra como custo variável da venda."><Input id="ch-c" inputMode="decimal" value={ch.commission} onChange={(e) => setCh({ ...ch, commission: e.target.value })} /></Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-[var(--color-primary)]" checked={!!ch.active} onChange={(e) => setCh({ ...ch, active: e.target.checked })} />Ativo</label>
          <FormError error={error} />
        </div>}
      </Modal>
      <Modal open={!!pm} onClose={() => setPm(null)} title={pm?.id ? 'Editar forma de pagamento' : 'Nova forma de pagamento'} footer={<>
        <Button variant="secondary" onClick={() => setPm(null)}>Cancelar</Button>
        <Button onClick={async () => {
          setError(null);
          try {
            const inst = Object.fromEntries((pm!.instFees || '').split(/\s+/).filter(Boolean).map((p) => { const [n, v] = p.split(':'); return [n!, toBps(v ?? '0')]; }));
            const body = { name: pm!.name, kind: pm!.kind, feeBps: toBps(pm!.fee), installmentFeeBps: inst, settlementDays: Number(pm!.settlementDays ?? 0), accountId: pm!.accountId || null, active: pm!.active };
            if (pm!.id) await api(`payment-methods/${pm!.id}`, { method: 'PUT', body }); else await api('payment-methods', { body });
            qc.invalidateQueries({ queryKey: ['payment-methods'] }); setPm(null); toast('Forma de pagamento salva.');
          } catch (e) { setError(e); }
        }}>Salvar</Button>
      </>}>
        {pm && <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Nome" htmlFor="pm-n"><Input id="pm-n" value={pm.name ?? ''} onChange={(e) => setPm({ ...pm, name: e.target.value })} /></Field>
          <Field label="Tipo" htmlFor="pm-k"><Select id="pm-k" value={pm.kind} onChange={(e) => setPm({ ...pm, kind: e.target.value })}>{['cash', 'pix', 'debit', 'credit', 'bank_transfer', 'installment', 'store_credit'].map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</Select></Field>
          <Field label="Taxa (%)" htmlFor="pm-f"><Input id="pm-f" inputMode="decimal" value={pm.fee} onChange={(e) => setPm({ ...pm, fee: e.target.value })} /></Field>
          <Field label="Prazo de liquidação (dias)" htmlFor="pm-s"><Input id="pm-s" type="number" min={0} value={pm.settlementDays ?? 0} onChange={(e) => setPm({ ...pm, settlementDays: Number(e.target.value) })} /></Field>
          {pm.kind === 'credit' && <div className="sm:col-span-2"><Field label="Taxa por parcelas" htmlFor="pm-i" help="Formato: 2:3,99 3:4,59 (parcelas:taxa%)."><Input id="pm-i" value={pm.instFees} onChange={(e) => setPm({ ...pm, instFees: e.target.value })} /></Field></div>}
          <Field label="Conta de destino" htmlFor="pm-a"><Select id="pm-a" value={pm.accountId ?? ''} onChange={(e) => setPm({ ...pm, accountId: e.target.value || null })}><option value="">—</option>{accounts.data?.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select></Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-[var(--color-primary)]" checked={!!pm.active} onChange={(e) => setPm({ ...pm, active: e.target.checked })} />Ativa</label>
          <div className="sm:col-span-2"><FormError error={error} /></div>
        </div>}
      </Modal>
    </div>
  );
}
