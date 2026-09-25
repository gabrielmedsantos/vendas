'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button, Field, Input } from '@/components/ui';
import { authClient, authErrorMessage } from '@/lib/client/auth';
import { AuthCard } from '../../auth-card';

export default function TwoFactorPage() {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  return (
    <AuthCard eyebrow="Verificação em duas etapas" title="Digite o código" subtitle="Abra seu aplicativo autenticador e informe o código de 6 dígitos.">
      <form
        className="flex flex-col gap-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setLoading(true);
          const r = await authClient.twoFactor.verifyTotp({ code });
          setLoading(false);
          if (r.error) return setError(authErrorMessage(r.error.code, 'Código inválido.'));
          router.replace('/app');
        }}
      >
        <Field label="Código" htmlFor="code">
          <Input id="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
        </Field>
        {error && <p role="alert" className="text-sm text-danger-soft">{error}</p>}
        <Button type="submit" loading={loading}>Verificar</Button>
      </form>
    </AuthCard>
  );
}
