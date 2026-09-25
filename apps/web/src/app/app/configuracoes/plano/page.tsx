'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { Badge, Button, Card, ErrorState, Field, FormError, Input, LoadingBlock, PageHeader, Table, Td, Th } from '@/components/ui';
import { useToast } from '@/components/toast';
import { api } from '@/lib/client/api';
import { authClient } from '@/lib/client/auth';
import { brl, dateBR, dateTimeBR, STATUS_LABEL } from '@/lib/client/format';
import { useCan, useMe } from '@/lib/client/session';

interface Billing {
  entitlements: { planCode: string; planName: string; status: string; limits: Record<string, number | null>; features: string[]; trialEndsAt: string | null; currentPeriodEnd: string; cancelAtPeriodEnd: boolean; priceMonthlyCents: string };
  usage: Record<string, number>;
  invoices: { id: string; periodStart: string; periodEnd: string; amountCents: string; status: string; dueDate: string; paidAt: string | null }[];
  events: { fromStatus: string | null; toStatus: string; reason: string; createdAt: string }[];
}
const LIMIT_LABEL: Record<string, string> = { users: 'Usuários', products: 'Produtos', storage_mb: 'Armazenamento (MB)', monthly_sales: 'Vendas no mês' };

function Security() {
  const me = useMe();
  const toast = useToast();
  const [password, setPassword] = useState('');
  const [uri, setUri] = useState<string | null>(null);
  const [codes, setCodes] = useState<string[]>([]);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const enabled = !!me.data?.user.twoFactorEnabled;
  return (
    <Card title="Segurança da sua conta" action={<ShieldCheck className="size-4 text-primary-soft" />}>
      <div className="flex flex-col gap-3 text-sm">
        <p className="text-muted">Verificação em duas etapas (TOTP) é recomendada ao proprietário e obrigatória para a administração da plataforma.</p>
        <p>Situação: {enabled ? <Badge tone="success">Ativa</Badge> : <Badge tone="warning">Inativa</Badge>}</p>
        {!enabled && !uri && (
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Confirme sua senha" htmlFor="tf-p"><Input id="tf-p" type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
            <Button onClick={async () => { setError(null); const r = await authClient.twoFactor.enable({ password }); if (r.error) return setError(r.error.message ?? 'Falha'); if (r.data.method !== 'totp') return setError('Método inesperado.'); setUri(r.data.totpURI); setCodes(r.data.backupCodes); }}>Ativar</Button>
          </div>
        )}
        {uri && (
          <div className="flex flex-col gap-2">
            <p>Adicione esta chave no seu aplicativo autenticador (copie o endereço abaixo):</p>
            <Input readOnly value={uri} aria-label="Endereço TOTP" />
            <p className="text-xs text-muted">Guarde os códigos de recuperação em local seguro: {codes.join(' · ')}</p>
            <div className="flex items-end gap-2">
              <Field label="Código do aplicativo" htmlFor="tf-c"><Input id="tf-c" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} /></Field>
              <Button onClick={async () => { const r = await authClient.twoFactor.verifyTotp({ code }); if (r.error) return setError('Código inválido.'); toast('Verificação em duas etapas ativada.'); setUri(null); me.refetch(); }}>Confirmar</Button>
            </div>
          </div>
        )}
        <div>
          <Button variant="secondary" onClick={async () => { await authClient.revokeOtherSessions(); toast('Outras sessões encerradas.'); }}>Encerrar sessões em outros dispositivos</Button>
        </div>
        {error && <p role="alert" className="text-danger-soft">{error}</p>}
      </div>
    </Card>
  );
}

function Referral() {
  const toast = useToast();
  const q = useQuery({ queryKey: ['referrals'], queryFn: () => api<{ code: string; link: string; pending: number; qualified: number; rewarded: number; rules: string }>('referrals') });
  if (!q.data) return null;
  const r = q.data;
  return (
    <Card title="Indique outra loja" description={r.rules}>
      <div className="flex flex-col gap-3 text-sm">
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Seu link de indicação" htmlFor="ref-link"><Input id="ref-link" readOnly value={r.link} className="w-80 max-w-full" /></Field>
          <Button variant="secondary" onClick={async () => { try { await navigator.clipboard.writeText(r.link); toast('Link copiado.'); } catch { toast('Não foi possível copiar; selecione o texto.'); } }}>Copiar</Button>
        </div>
        <p className="text-muted">Código <strong className="text-fg">{r.code}</strong> · aguardando pagamento: {r.pending} · qualificadas: {r.qualified} · recompensadas: {r.rewarded}</p>
      </div>
    </Card>
  );
}

export default function PlanPage() {
  const can = useCan();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['billing'], queryFn: () => api<Billing>('billing') });
  const [error, setError] = useState<unknown>(null);
  return (
    <div>
      <PageHeader title="Plano e segurança" description="Limites aplicados no servidor. Atraso não apaga dados: bloqueia novas operações e mantém consulta e exportação." />
      <div className="flex flex-col gap-4">
        {q.isLoading && <LoadingBlock />}
        {q.error && <ErrorState error={q.error} />}
        {q.data && (
          <>
            <Card title={`Plano ${q.data.entitlements.planName}`} action={<Badge tone={q.data.entitlements.status === 'active' || q.data.entitlements.status === 'trialing' ? 'success' : 'warning'}>{STATUS_LABEL[q.data.entitlements.status]}</Badge>}>
              <dl className="grid gap-3 text-sm sm:grid-cols-3">
                <div><dt className="text-muted">Valor mensal</dt><dd>{q.data.entitlements.priceMonthlyCents === '0' ? 'A definir pelo operador' : brl(q.data.entitlements.priceMonthlyCents)}</dd></div>
                <div><dt className="text-muted">{q.data.entitlements.status === 'trialing' ? 'Fim do teste' : 'Período atual até'}</dt><dd>{dateBR(q.data.entitlements.trialEndsAt ?? q.data.entitlements.currentPeriodEnd)}</dd></div>
                <div><dt className="text-muted">Cobrança</dt><dd>Manual (gateway ainda não configurado)</dd></div>
              </dl>
              <div className="mt-4 grid gap-3 sm:grid-cols-4">
                {Object.entries(LIMIT_LABEL).map(([k, l]) => {
                  const lim = q.data.entitlements.limits[k];
                  const used = q.data.usage[k] ?? 0;
                  return (
                    <div key={k} className="rounded-xl border border-line bg-bg p-3">
                      <p className="text-xs text-muted">{l}</p>
                      <p className="text-sm font-medium tabular">{used} / {lim ?? '∞'}</p>
                      {lim ? <div className="mt-2 h-1.5 rounded-full bg-surface-3"><div className="h-1.5 rounded-full bg-primary" style={{ width: `${Math.min(100, (used / lim) * 100)}%` }} /></div> : null}
                    </div>
                  );
                })}
              </div>
              {can('billing.manage') && (
                <div className="mt-4 flex items-center gap-3 text-sm">
                  {q.data.entitlements.cancelAtPeriodEnd ? <Badge tone="warning">Cancelamento agendado para o fim do período</Badge> : null}
                  <Button variant={q.data.entitlements.cancelAtPeriodEnd ? 'secondary' : 'danger'} size="sm" onClick={async () => { setError(null); try { await api('billing/cancel', { body: { cancel: !q.data!.entitlements.cancelAtPeriodEnd } }); qc.invalidateQueries({ queryKey: ['billing'] }); toast('Assinatura atualizada.'); } catch (e) { setError(e); } }}>{q.data.entitlements.cancelAtPeriodEnd ? 'Manter assinatura' : 'Cancelar ao fim do período'}</Button>
                </div>
              )}
              <div className="mt-2"><FormError error={error} /></div>
            </Card>
            <Card title="Faturas da assinatura">
              {q.data.invoices.length ? (
                <Table><thead><tr><Th>Período</Th><Th>Vencimento</Th><Th right>Valor</Th><Th>Situação</Th></tr></thead>
                  <tbody>{q.data.invoices.map((i) => <tr key={i.id}><Td>{dateBR(i.periodStart)} a {dateBR(i.periodEnd)}</Td><Td>{dateBR(i.dueDate)}</Td><Td right>{brl(i.amountCents)}</Td><Td><Badge tone={i.status === 'paid' ? 'success' : 'warning'}>{i.status === 'paid' ? 'Paga' : i.status === 'open' ? 'Em aberto' : i.status}</Badge></Td></tr>)}</tbody></Table>
              ) : <p className="text-sm text-muted">Nenhuma fatura emitida.</p>}
              {q.data.events.length > 0 && <ul className="mt-3 flex flex-col gap-1 text-xs text-muted">{q.data.events.map((e, i) => <li key={i}>{dateTimeBR(e.createdAt)} · {e.fromStatus ? `${STATUS_LABEL[e.fromStatus]} → ` : ''}{STATUS_LABEL[e.toStatus]} · {e.reason}</li>)}</ul>}
            </Card>
          </>
        )}
        {can('billing.manage') && <Referral />}
        <Security />
      </div>
    </div>
  );
}
