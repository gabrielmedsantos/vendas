'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { Button, Field, Input } from '@/components/ui';
import { authClient, authErrorMessage } from '@/lib/client/auth';
import { AuthCard } from '../auth-card';

function Reset() {
  const token = useSearchParams().get('token') ?? '';
  const [password, setPassword] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  return (
    <AuthCard eyebrow="Nova senha" title="Defina sua nova senha" subtitle="Todas as outras sessões serão encerradas.">
      {done ? (
        <p role="status" className="text-sm text-success">Senha alterada. <Link href="/entrar" className="underline">Entrar</Link></p>
      ) : (
        <form
          className="flex flex-col gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            if (password.length < 10) return setError('Mínimo de 10 caracteres.');
            setLoading(true);
            const r = await authClient.resetPassword({ newPassword: password, token });
            setLoading(false);
            if (r.error) return setError(authErrorMessage(r.error.code, r.error.message));
            setDone(true);
          }}
        >
          <Field label="Nova senha" htmlFor="password"><Input id="password" type="password" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
          {error && <p role="alert" className="text-sm text-danger-soft">{error}</p>}
          <Button type="submit" loading={loading} disabled={!token}>Salvar</Button>
        </form>
      )}
    </AuthCard>
  );
}

export default function Page() {
  return (
    <Suspense>
      <Reset />
    </Suspense>
  );
}
