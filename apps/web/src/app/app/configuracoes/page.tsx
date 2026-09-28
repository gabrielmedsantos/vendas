'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Button, Card, ErrorState, Field, FormError, Input, LoadingBlock, MoneyInput, NoPermission, PageHeader, Select, Textarea } from '@/components/ui';
import { useToast } from '@/components/toast';
import { api } from '@/lib/client/api';
import { useCan } from '@/lib/client/session';

interface Tenant { name: string; legalName: string | null; document: string | null; timezone: string; email: string | null; phone: string | null; address: Record<string, string>; settings: { revenueGoalCents?: string; warrantyTerms?: string; receiptFooter?: string } }
const WARRANTY_DEFAULT = 'A garantia da loja cobre somente defeitos de funcionamento do próprio equipamento (defeitos de fabricação ou de componentes) que surgirem dentro do prazo indicado, sem custo de peças e mão de obra. '
  + 'A garantia não cobre mau uso: quedas, impactos, tela ou traseira trincada ou quebrada, contato com líquidos ou umidade, oxidação, danos elétricos por carregadores ou cabos inadequados, '
  + 'aparelho aberto ou reparado por terceiros, alteração de sistema (root, jailbreak e similares), perda de dados e desgaste natural da bateria. '
  + 'Para acionar, apresente o produto com este comprovante. Esta garantia não reduz os direitos previstos no Código de Defesa do Consumidor.';
const TZ = ['America/Sao_Paulo', 'America/Manaus', 'America/Cuiaba', 'America/Belem', 'America/Fortaleza', 'America/Recife', 'America/Bahia', 'America/Porto_Velho', 'America/Rio_Branco', 'America/Noronha'];

export default function CompanySettings() {
  const can = useCan();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['tenant'], queryFn: () => api<Tenant>('tenant') });
  const [f, setF] = useState<Record<string, string>>({});
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (q.data) setF({
      name: q.data.name, legalName: q.data.legalName ?? '', document: q.data.document ?? '', timezone: q.data.timezone, email: q.data.email ?? '', phone: q.data.phone ?? '',
      street: q.data.address.street ?? '', number: q.data.address.number ?? '', district: q.data.address.district ?? '', city: q.data.address.city ?? '', state: q.data.address.state ?? '', zip: q.data.address.zip ?? '',
      revenueGoalCents: q.data.settings.revenueGoalCents ?? '', warrantyTerms: q.data.settings.warrantyTerms ?? '', receiptFooter: q.data.settings.receiptFooter ?? '',
    });
  }, [q.data]);
  if (!can('settings.manage')) return <NoPermission />;
  if (q.isLoading) return <LoadingBlock />;
  if (q.error) return <ErrorState error={q.error} />;
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <div>
      <PageHeader title="Empresa" description="Dados usados nos documentos comerciais e no fuso das datas e relatórios." />
      <form className="flex flex-col gap-4" onSubmit={async (e) => {
        e.preventDefault(); setSaving(true); setError(null);
        try {
          await api('tenant', { method: 'PUT', body: {
            name: f.name, legalName: f.legalName || null, document: f.document || null, timezone: f.timezone, email: f.email || '', phone: f.phone || null,
            address: Object.fromEntries(['street', 'number', 'district', 'city', 'state', 'zip'].map((k) => [k, f[k] ?? ''])),
            settings: { revenueGoalCents: f.revenueGoalCents || null, warrantyTerms: f.warrantyTerms || null, receiptFooter: f.receiptFooter || null },
          } });
          await qc.invalidateQueries(); toast('Dados da empresa salvos.');
        } catch (err) { setError(err); } finally { setSaving(false); }
      }}>
        <Card title="Identificação">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Nome fantasia" htmlFor="c-name" required><Input id="c-name" value={f.name ?? ''} onChange={set('name')} /></Field>
            <Field label="Razão social" htmlFor="c-legal"><Input id="c-legal" value={f.legalName ?? ''} onChange={set('legalName')} /></Field>
            <Field label="CNPJ/CPF" htmlFor="c-doc"><Input id="c-doc" value={f.document ?? ''} onChange={set('document')} /></Field>
            <Field label="Fuso horário" htmlFor="c-tz" help="Define o dia de vendas, vencimentos e relatórios."><Select id="c-tz" value={f.timezone ?? ''} onChange={set('timezone')}>{TZ.map((z) => <option key={z} value={z}>{z}</option>)}</Select></Field>
            <Field label="Telefone" htmlFor="c-phone"><Input id="c-phone" value={f.phone ?? ''} onChange={set('phone')} /></Field>
            <Field label="E-mail comercial" htmlFor="c-email"><Input id="c-email" type="email" value={f.email ?? ''} onChange={set('email')} /></Field>
          </div>
        </Card>
        <Card title="Endereço">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="sm:col-span-2"><Field label="Logradouro" htmlFor="c-st"><Input id="c-st" value={f.street ?? ''} onChange={set('street')} /></Field></div>
            <Field label="Número" htmlFor="c-nu"><Input id="c-nu" value={f.number ?? ''} onChange={set('number')} /></Field>
            <Field label="Bairro" htmlFor="c-di"><Input id="c-di" value={f.district ?? ''} onChange={set('district')} /></Field>
            <Field label="Cidade" htmlFor="c-ci"><Input id="c-ci" value={f.city ?? ''} onChange={set('city')} /></Field>
            <div className="grid grid-cols-2 gap-2"><Field label="UF" htmlFor="c-uf"><Input id="c-uf" maxLength={2} value={f.state ?? ''} onChange={set('state')} /></Field><Field label="CEP" htmlFor="c-zip"><Input id="c-zip" value={f.zip ?? ''} onChange={set('zip')} /></Field></div>
          </div>
        </Card>
        <Card title="Metas e documentos">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Meta de faturamento mensal" htmlFor="c-goal"><MoneyInput id="c-goal" value={f.revenueGoalCents ?? ''} onChange={(c) => setF({ ...f, revenueGoalCents: c })} /></Field>
            <Field label="Rodapé dos recibos" htmlFor="c-foot"><Input id="c-foot" value={f.receiptFooter ?? ''} onChange={set('receiptFooter')} /></Field>
            <div className="sm:col-span-2"><Field label="Termos de garantia comercial" htmlFor="c-war" help="Aparecem nos recibos dos produtos com garantia. Use texto aprovado pela empresa; o documento guarda os termos vigentes na época."><Textarea id="c-war" rows={6} value={f.warrantyTerms ?? ''} onChange={set('warrantyTerms')} /></Field>
              <Button type="button" variant="quiet" className="mt-1" onClick={() => { if (!f.warrantyTerms || confirm('Substituir o texto atual pelo texto padrão?')) setF({ ...f, warrantyTerms: WARRANTY_DEFAULT }); }}>Usar texto padrão (não cobre mau uso)</Button>
            </div>
          </div>
        </Card>
        <FormError error={error} />
        <div className="flex justify-end"><Button type="submit" loading={saving}>Salvar</Button></div>
      </form>
    </div>
  );
}
