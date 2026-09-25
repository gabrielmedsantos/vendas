'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { Badge, Button, Card, EmptyState, ErrorState, Field, FormError, Input, LoadingBlock, Modal, MoneyInput, PageHeader, Select, Stat, Table, Tabs, Td, Th } from '@/components/ui';
import { useToast } from '@/components/toast';
import { api, ApiError } from '@/lib/client/api';
import { brl, dateBR, dateTimeBR, intBR, STATUS_LABEL } from '@/lib/client/format';

interface Overview { tenants: number; active: number; suspended: number; trialing: number; pastDue: number; mrr: string; dead: number; pending: number; webhookFailed: number; note: string }
interface TenantRow { id: string; name: string; slug: string; status: string; statusReason: string | null; createdAt: string; subscriptionStatus: string | null; currentPeriodEnd: string | null; trialEndsAt: string | null; planName: string | null; members: number }
interface PlanRow { code: string; name: string; public: boolean; id: string; version: number; priceMonthlyCents: string; priceYearlyCents: string | null; trialDays: number; limits: Record<string, number | null>; features: string[]; validTo: string | null }
interface InvoiceRow { id: string; tenantId: string; tenantName: string; periodStart: string; periodEnd: string; amountCents: string; status: string; dueDate: string; paidAt: string | null }
interface AuditRow { id: string; adminUserId: string; action: string; tenantId: string | null; reason: string; createdAt: string }
interface WebhookRow { id: string; provider: string; externalId: string; eventType: string; receivedAt: string; processedAt: string | null; result: string | null }

type Tab = 'overview' | 'tenants' | 'plans' | 'invoices' | 'webhooks' | 'audit';

const tone = (s: string | null) => (s === 'active' ? 'success' : s === 'suspended' || s === 'canceled' ? 'danger' : s === 'past_due' ? 'warning' : 'neutral');

/** Ação administrativa com motivo obrigatório. */
function ReasonModal({ title, open, onClose, onConfirm, danger, children }: { title: string; open: boolean; onClose: () => void; onConfirm: (reason: string) => Promise<void>; danger?: boolean; children?: React.ReactNode }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Modal open={open} onClose={onClose} title={title} footer={
      <>
        <Button variant="secondary" onClick={onClose}>Cancelar</Button>
        <Button variant={danger ? 'danger' : 'primary'} loading={busy} disabled={reason.trim().length < 3} onClick={async () => {
          setBusy(true); setError(null);
          try { await onConfirm(reason.trim()); setReason(''); onClose(); } catch (e) { setError(e); } finally { setBusy(false); }
        }}>Confirmar</Button>
      </>
    }>
      <div className="flex flex-col gap-3">
        {children}
        <Field label="Motivo (fica na auditoria)" htmlFor="pl-reason" required><Input id="pl-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} /></Field>
        <FormError error={error} />
      </div>
    </Modal>
  );
}

function Tenants({ plans }: { plans: PlanRow[] }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [q, setQ] = useState('');
  const list = useQuery({ queryKey: ['platform', 'tenants', q], queryFn: () => api<TenantRow[]>(`platform/tenants${q ? `?q=${encodeURIComponent(q)}` : ''}`) });
  const [action, setAction] = useState<{ t: TenantRow; kind: 'suspend' | 'reactivate' | 'plan' } | null>(null);
  const [planVersionId, setPlanVersionId] = useState('');
  const current = plans.filter((p) => !p.validTo);
  return (
    <Card title="Empresas" action={<Input aria-label="Buscar empresa" placeholder="Buscar por nome" value={q} onChange={(e) => setQ(e.target.value)} className="w-56" />}>
      {list.isLoading ? <LoadingBlock /> : list.error ? <ErrorState error={list.error} retry={list.refetch} /> : !list.data?.length ? <EmptyState title="Nenhuma empresa" /> : (
        <Table>
          <thead><tr><Th>Empresa</Th><Th>Plano</Th><Th>Assinatura</Th><Th>Período até</Th><Th right>Usuários</Th><Th /></tr></thead>
          <tbody>
            {list.data.map((t) => (
              <tr key={t.id}>
                <Td><span className="font-medium">{t.name}</span><span className="block text-xs text-muted">{t.slug} · criada {dateBR(t.createdAt)}</span></Td>
                <Td>{t.planName ?? '—'}</Td>
                <Td><Badge tone={tone(t.subscriptionStatus)}>{STATUS_LABEL[t.subscriptionStatus ?? ''] ?? t.subscriptionStatus ?? '—'}</Badge>{t.statusReason && <span className="block text-xs text-muted">{t.statusReason}</span>}</Td>
                <Td>{dateBR(t.trialEndsAt ?? t.currentPeriodEnd)}</Td>
                <Td right>{intBR(t.members)}</Td>
                <Td right>
                  <div className="flex justify-end gap-1">
                    <Button size="sm" variant="secondary" onClick={() => { setPlanVersionId(''); setAction({ t, kind: 'plan' }); }}>Plano</Button>
                    {t.subscriptionStatus === 'suspended'
                      ? <Button size="sm" variant="secondary" onClick={() => setAction({ t, kind: 'reactivate' })}>Reativar</Button>
                      : <Button size="sm" variant="quiet" onClick={() => setAction({ t, kind: 'suspend' })}>Suspender</Button>}
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <ReasonModal
        open={!!action}
        onClose={() => setAction(null)}
        danger={action?.kind === 'suspend'}
        title={action?.kind === 'plan' ? `Trocar plano · ${action.t.name}` : action?.kind === 'suspend' ? `Suspender ${action?.t.name}` : `Reativar ${action?.t.name ?? ''}`}
        onConfirm={async (reason) => {
          if (!action) return;
          if (action.kind === 'plan') {
            if (!planVersionId) throw new ApiError(400, 'validation_failed', 'Escolha o plano.');
            await api(`platform/tenants/${action.t.id}/plan`, { body: { planVersionId, reason } });
          } else await api(`platform/tenants/${action.t.id}/status`, { body: { action: action.kind, reason } });
          toast('Ação registrada.');
          await qc.invalidateQueries({ queryKey: ['platform'] });
        }}
      >
        {action?.kind === 'suspend' && <p className="text-sm text-muted">A empresa fica somente leitura: novas operações são bloqueadas e nenhum dado é apagado.</p>}
        {action?.kind === 'plan' && (
          <Field label="Novo plano" htmlFor="pl-plan" required help="Downgrade não apaga dados; limites passam a valer para novos cadastros.">
            <Select id="pl-plan" value={planVersionId} onChange={(e) => setPlanVersionId(e.target.value)}>
              <option value="">Selecione…</option>
              {current.map((p) => <option key={p.id} value={p.id}>{p.name} v{p.version} · {brl(p.priceMonthlyCents)}/mês</option>)}
            </Select>
          </Field>
        )}
      </ReasonModal>
    </Card>
  );
}

function Plans({ plans, refetch }: { plans: PlanRow[]; refetch: () => void }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ planCode: '', planName: '', priceMonthlyCents: '0', trialDays: 0, users: '', products: '', storage: '', sales: '', catalog: true, reason: '' });
  const [error, setError] = useState<unknown>(null);
  const lim = (v: string) => (v.trim() ? Number(v) : null);
  const edit = (p?: PlanRow) => {
    setF(p ? { planCode: p.code, planName: p.name, priceMonthlyCents: p.priceMonthlyCents, trialDays: p.trialDays, users: String(p.limits.users ?? ''), products: String(p.limits.products ?? ''), storage: String(p.limits.storage_mb ?? ''), sales: String(p.limits.monthly_sales ?? ''), catalog: p.features.includes('catalog'), reason: '' }
      : { planCode: '', planName: '', priceMonthlyCents: '0', trialDays: 0, users: '', products: '', storage: '', sales: '', catalog: true, reason: '' });
    setError(null);
    setOpen(true);
  };
  return (
    <Card title="Planos" description="Alterar um plano cria nova versão. Assinaturas existentes continuam na versão contratada até a troca." action={<Button size="sm" onClick={() => edit()}>Novo plano</Button>}>
      <Table>
        <thead><tr><Th>Plano</Th><Th>Versão</Th><Th right>Mensal</Th><Th>Teste</Th><Th>Limites</Th><Th>Situação</Th><Th /></tr></thead>
        <tbody>
          {plans.map((p) => (
            <tr key={p.id}>
              <Td><span className="font-medium">{p.name}</span><span className="block text-xs text-muted">{p.code}{p.public ? '' : ' · privado'}</span></Td>
              <Td>v{p.version}</Td>
              <Td right>{brl(p.priceMonthlyCents)}</Td>
              <Td>{p.trialDays ? `${p.trialDays} dias` : '—'}</Td>
              <Td className="text-xs text-muted">{Object.entries(p.limits).map(([k, v]) => `${k}: ${v ?? '∞'}`).join(' · ')}</Td>
              <Td>{p.validTo ? <Badge>Substituída</Badge> : <Badge tone="success">Vigente</Badge>}</Td>
              <Td right>{!p.validTo && <Button size="sm" variant="secondary" onClick={() => edit(p)}>Nova versão</Button>}</Td>
            </tr>
          ))}
        </tbody>
      </Table>
      <Modal open={open} onClose={() => setOpen(false)} title="Versão de plano" wide footer={
        <>
          <Button variant="secondary" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button onClick={async () => {
            setError(null);
            try {
              await api('platform/plans', { body: {
                planCode: f.planCode, planName: f.planName, priceMonthlyCents: f.priceMonthlyCents, trialDays: f.trialDays, public: true,
                limits: { users: lim(f.users), products: lim(f.products), storage_mb: lim(f.storage), monthly_sales: lim(f.sales) },
                features: f.catalog ? ['catalog', 'reports_export'] : ['reports_export'], reason: f.reason,
              } });
              toast('Nova versão salva.');
              setOpen(false);
              refetch();
            } catch (e) { setError(e); }
          }}>Salvar versão</Button>
        </>
      }>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Código" htmlFor="pv-code" required help="minúsculas, números, - ou _"><Input id="pv-code" value={f.planCode} onChange={(e) => setF({ ...f, planCode: e.target.value })} /></Field>
          <Field label="Nome" htmlFor="pv-name" required><Input id="pv-name" value={f.planName} onChange={(e) => setF({ ...f, planName: e.target.value })} /></Field>
          <Field label="Preço mensal" htmlFor="pv-price"><MoneyInput id="pv-price" value={f.priceMonthlyCents} onChange={(c) => setF({ ...f, priceMonthlyCents: c })} /></Field>
          <Field label="Dias de teste" htmlFor="pv-trial"><Input id="pv-trial" type="number" min={0} max={90} value={f.trialDays} onChange={(e) => setF({ ...f, trialDays: Number(e.target.value) || 0 })} /></Field>
          <Field label="Usuários (vazio = ilimitado)" htmlFor="pv-u"><Input id="pv-u" inputMode="numeric" value={f.users} onChange={(e) => setF({ ...f, users: e.target.value.replace(/\D/g, '') })} /></Field>
          <Field label="Produtos" htmlFor="pv-p"><Input id="pv-p" inputMode="numeric" value={f.products} onChange={(e) => setF({ ...f, products: e.target.value.replace(/\D/g, '') })} /></Field>
          <Field label="Armazenamento (MB)" htmlFor="pv-s"><Input id="pv-s" inputMode="numeric" value={f.storage} onChange={(e) => setF({ ...f, storage: e.target.value.replace(/\D/g, '') })} /></Field>
          <Field label="Vendas por mês" htmlFor="pv-v"><Input id="pv-v" inputMode="numeric" value={f.sales} onChange={(e) => setF({ ...f, sales: e.target.value.replace(/\D/g, '') })} /></Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.catalog} onChange={(e) => setF({ ...f, catalog: e.target.checked })} /> Inclui catálogo online</label>
          <Field label="Motivo" htmlFor="pv-r" required><Input id="pv-r" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>
        </div>
        <FormError error={error} />
      </Modal>
    </Card>
  );
}

function Invoices() {
  const qc = useQueryClient();
  const toast = useToast();
  const list = useQuery({ queryKey: ['platform', 'invoices'], queryFn: () => api<InvoiceRow[]>('platform/invoices') });
  const [paying, setPaying] = useState<InvoiceRow | null>(null);
  return (
    <Card title="Faturas" description="Cobrança manual do piloto: registre o pagamento depois de conferir o recebimento. Nenhuma cobrança real é enviada pelo sistema.">
      {list.isLoading ? <LoadingBlock /> : list.error ? <ErrorState error={list.error} /> : !list.data?.length ? <EmptyState title="Nenhuma fatura" description="Faturas aparecem aqui quando criadas manualmente ou recebidas do provedor de cobrança." /> : (
        <Table>
          <thead><tr><Th>Empresa</Th><Th>Período</Th><Th right>Valor</Th><Th>Vencimento</Th><Th>Situação</Th><Th /></tr></thead>
          <tbody>
            {list.data.map((i) => (
              <tr key={i.id}>
                <Td>{i.tenantName}</Td>
                <Td>{dateBR(i.periodStart)} – {dateBR(i.periodEnd)}</Td>
                <Td right>{brl(i.amountCents)}</Td>
                <Td>{dateBR(i.dueDate)}</Td>
                <Td><Badge tone={i.status === 'paid' ? 'success' : 'warning'}>{i.status === 'paid' ? `Paga ${dateBR(i.paidAt)}` : STATUS_LABEL[i.status] ?? i.status}</Badge></Td>
                <Td right>{i.status === 'open' && <Button size="sm" variant="secondary" onClick={() => setPaying(i)}>Registrar pagamento</Button>}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <ReasonModal open={!!paying} onClose={() => setPaying(null)} title="Registrar pagamento" onConfirm={async (reason) => {
        await api(`platform/invoices/${paying!.id}/paid`, { body: { reason } });
        toast('Pagamento registrado; assinatura atualizada.');
        await qc.invalidateQueries({ queryKey: ['platform'] });
      }}>
        {paying && <p className="text-sm">{paying.tenantName} · {brl(paying.amountCents)} · período {dateBR(paying.periodStart)} – {dateBR(paying.periodEnd)}</p>}
      </ReasonModal>
    </Card>
  );
}

export default function PlatformPage() {
  const [tab, setTab] = useState<Tab>('overview');
  const me = useQuery({ queryKey: ['platform', 'me'], queryFn: () => api<{ role: string }>('platform/me'), retry: false });
  const overview = useQuery({ queryKey: ['platform', 'overview'], queryFn: () => api<Overview>('platform/overview'), enabled: me.isSuccess });
  const plans = useQuery({ queryKey: ['platform', 'plans'], queryFn: () => api<PlanRow[]>('platform/plans'), enabled: me.isSuccess });
  const audit = useQuery({ queryKey: ['platform', 'audit'], queryFn: () => api<AuditRow[]>('platform/audit'), enabled: me.isSuccess && tab === 'audit' });
  const hooks = useQuery({ queryKey: ['platform', 'webhooks'], queryFn: () => api<WebhookRow[]>('platform/webhooks'), enabled: me.isSuccess && tab === 'webhooks' });

  if (me.isLoading) return <main className="mx-auto max-w-6xl p-4 sm:p-6"><LoadingBlock /></main>;
  if (me.error) {
    const e = me.error as ApiError;
    return (
      <main className="mx-auto max-w-lg p-6">
        <EmptyState icon={<ShieldAlert className="size-6" />} title={e.status === 403 ? 'Verificação em duas etapas necessária' : 'Página não encontrada'}
          description={e.status === 403 ? e.message : 'Esta área é restrita à administração da plataforma.'}
          action={<Link className="text-primary-soft underline" href={e.status === 403 ? '/app/configuracoes/plano' : '/app'}>{e.status === 403 ? 'Ativar em Configurações › Plano e segurança' : 'Voltar ao sistema'}</Link>} />
      </main>
    );
  }
  const o = overview.data;
  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-4 p-4 sm:p-6">
      <PageHeader title="Administração da plataforma" description="Empresas, planos e cobrança. Esta área não mostra vendas, clientes ou estoque das empresas." actions={<Link href="/app" className="text-sm text-primary-soft underline">Voltar ao sistema</Link>} />
      <Tabs value={tab} onChange={setTab} options={[
        { value: 'overview', label: 'Visão geral' }, { value: 'tenants', label: 'Empresas' }, { value: 'plans', label: 'Planos' },
        { value: 'invoices', label: 'Faturas' }, { value: 'webhooks', label: 'Webhooks' }, { value: 'audit', label: 'Auditoria' },
      ]} />
      {tab === 'overview' && (overview.error ? <ErrorState error={overview.error} /> : !o ? <LoadingBlock /> : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Empresas" value={intBR(o.tenants)} />
            <Stat label="Assinaturas ativas" value={intBR(o.active)} tone="success" />
            <Stat label="Em teste" value={intBR(o.trialing)} />
            <Stat label="Receita recorrente mensal" value={brl(o.mrr)} tone="primary" info={o.note} />
            <Stat label="Pagamento pendente" value={intBR(o.pastDue)} tone={o.pastDue ? 'warning' : 'default'} />
            <Stat label="Suspensas" value={intBR(o.suspended)} tone={o.suspended ? 'danger' : 'default'} />
            <Stat label="Fila pendente" value={intBR(o.pending)} hint="documentos, exportações, avisos" />
            <Stat label="Falhas (fila/webhooks)" value={`${intBR(o.dead)} / ${intBR(o.webhookFailed)}`} tone={o.dead || o.webhookFailed ? 'danger' : 'default'} />
          </div>
        </>
      ))}
      {tab === 'tenants' && <Tenants plans={plans.data ?? []} />}
      {tab === 'plans' && (plans.isLoading ? <LoadingBlock /> : plans.error ? <ErrorState error={plans.error} /> : <Plans plans={plans.data ?? []} refetch={plans.refetch} />)}
      {tab === 'invoices' && <Invoices />}
      {tab === 'webhooks' && (
        <Card title="Webhooks de cobrança" description="Eventos recebidos com assinatura válida. Repetidos são ignorados pelo identificador do provedor.">
          {hooks.isLoading ? <LoadingBlock /> : !hooks.data?.length ? <EmptyState title="Nenhum evento recebido" description="Integração de cobrança desligada até configurar BILLING_WEBHOOK_SECRET." /> : (
            <Table>
              <thead><tr><Th>Recebido</Th><Th>Tipo</Th><Th>Identificador</Th><Th>Resultado</Th></tr></thead>
              <tbody>{hooks.data.map((h) => <tr key={h.id}><Td>{dateTimeBR(h.receivedAt)}</Td><Td>{h.eventType}</Td><Td className="text-xs">{h.provider}:{h.externalId}</Td><Td>{h.processedAt ? <Badge tone={h.result === 'ok' ? 'success' : 'danger'}>{h.result}</Badge> : <Badge>Na fila</Badge>}</Td></tr>)}</tbody>
            </Table>
          )}
        </Card>
      )}
      {tab === 'audit' && (
        <Card title="Auditoria administrativa">
          {audit.isLoading ? <LoadingBlock /> : !audit.data?.length ? <EmptyState title="Nenhuma ação registrada" /> : (
            <Table>
              <thead><tr><Th>Quando</Th><Th>Ação</Th><Th>Motivo</Th></tr></thead>
              <tbody>{audit.data.map((a) => <tr key={a.id}><Td>{dateTimeBR(a.createdAt)}</Td><Td>{a.action}</Td><Td>{a.reason}</Td></tr>)}</tbody>
            </Table>
          )}
        </Card>
      )}
    </main>
  );
}
