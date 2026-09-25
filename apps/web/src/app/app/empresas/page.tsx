'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Building2, LogOut } from 'lucide-react';
import { Logo } from '@/components/brand/logo';
import { Button, Card, Field, FormError, Input } from '@/components/ui';
import { api } from '@/lib/client/api';
import { authClient } from '@/lib/client/auth';
import { useMe } from '@/lib/client/session';

export default function CompaniesPage() {
  const me = useMe();
  const qc = useQueryClient();
  const router = useRouter();
  const [name, setName] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const select = async (tenantId: string) => {
    await api('session/tenant', { body: { tenantId } });
    qc.clear();
    router.push('/app');
  };
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <Logo />
        <button className="flex items-center gap-2 text-sm text-muted hover:text-fg" onClick={async () => { await authClient.signOut(); window.location.href = '/entrar'; }}><LogOut className="size-4" /> Sair</button>
      </div>
      <div>
        <h1 className="text-2xl font-semibold">Suas empresas</h1>
        <p className="text-sm text-muted">Cada empresa tem dados isolados. Escolha uma para trabalhar ou crie uma nova.</p>
      </div>
      {me.data?.tenants.length ? (
        <Card title="Empresas com acesso">
          <ul className="flex flex-col gap-2">
            {me.data.tenants.map((t) => (
              <li key={t.id}>
                <button onClick={() => select(t.id)} className="flex w-full items-center gap-3 rounded-xl border border-line bg-bg px-4 py-3 text-left hover:border-primary">
                  <Building2 className="size-5 text-primary-soft" />
                  <span className="flex-1">
                    <span className="block font-medium">{t.name}</span>
                    <span className="text-xs text-muted">{t.status === 'active' ? 'Ativa' : 'Suspensa'}</span>
                  </span>
                  <span className="text-xs text-primary-soft">Abrir</span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      <Card title="Criar empresa" description="Você será o proprietário. Cadastros básicos (caixa, conta bancária, formas de pagamento e canal) são criados automaticamente e podem ser ajustados depois.">
        <form
          className="flex flex-col gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setLoading(true);
            setError(null);
            try {
              const referralCode = new URLSearchParams(window.location.search).get('indicacao') || undefined;
              await api('tenants', { body: { name, referralCode } });
              qc.clear();
              router.push('/app');
            } catch (err) {
              setError(err);
            } finally {
              setLoading(false);
            }
          }}
        >
          <Field label="Nome fantasia" htmlFor="tenant-name" required>
            <Input id="tenant-name" required minLength={2} maxLength={120} value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Loja do Centro" />
          </Field>
          <FormError error={error} />
          <div><Button type="submit" loading={loading}>Criar empresa</Button></div>
        </form>
      </Card>
    </div>
  );
}
