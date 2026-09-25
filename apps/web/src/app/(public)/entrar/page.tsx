'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { Button, Field, Input } from '@/components/ui';
import { authClient, authErrorMessage } from '@/lib/client/auth';
import { AuthCard } from '../auth-card';

function SignIn() {
  const router = useRouter();
  const next = useSearchParams().get('volta');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Só caminhos internos conhecidos (evita redirecionamento aberto).
  const safeNext = next && (/^\/app(\/|$)/.test(next) || /^\/convite\/[A-Za-z0-9_-]{20,100}$/.test(next)) ? next : '/app';
  return (
    <AuthCard eyebrow="Entrar" title="Acesse sua conta" subtitle="Informe seus dados para abrir o painel." footer={<>Ainda não tem conta? <Link className="text-primary-soft hover:underline" href={safeNext.startsWith('/convite/') ? `/cadastro?volta=${encodeURIComponent(safeNext)}` : '/cadastro'}>Criar conta</Link></>}>
      <form
        className="flex flex-col gap-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setLoading(true);
          setError(null);
          const r = await authClient.signIn.email({ email, password });
          setLoading(false);
          if (r.error) return setError(authErrorMessage(r.error.code, r.error.message));
          if ((r.data as { twoFactorRedirect?: boolean } | null)?.twoFactorRedirect) return router.push('/entrar/2fa');
          router.replace(safeNext);
        }}
      >
        <Field label="E-mail" htmlFor="email">
          <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="voce@empresa.com.br" />
        </Field>
        <Field label="Senha" htmlFor="password">
          <Input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <div className="flex justify-end text-xs">
          <Link href="/recuperar" className="text-primary-soft hover:underline">Esqueci a senha</Link>
        </div>
        {error && <p role="alert" className="rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger-soft">{error}</p>}
        <Button type="submit" loading={loading} className="w-full">Entrar</Button>
      </form>
    </AuthCard>
  );
}

export default function Page() {
  return (
    <Suspense>
      <SignIn />
    </Suspense>
  );
}
