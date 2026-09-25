'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Button, Field, Input } from '@/components/ui';
import { authClient } from '@/lib/client/auth';
import { AuthCard } from '../auth-card';

export default function RecoverPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  return (
    <AuthCard eyebrow="Recuperar acesso" title="Esqueceu a senha?" subtitle="Enviaremos um link temporário para criar uma nova senha." footer={<Link className="text-primary-soft hover:underline" href="/entrar">Voltar para entrar</Link>}>
      {sent ? (
        <p role="status" className="rounded-xl border border-success/30 bg-success/10 px-3 py-3 text-sm text-success">
          Se houver uma conta com este e-mail, você receberá o link em instantes. O link expira em 30 minutos.
        </p>
      ) : (
        <form
          className="flex flex-col gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setLoading(true);
            await authClient.requestPasswordReset({ email, redirectTo: '/redefinir-senha' });
            setLoading(false);
            setSent(true);
          }}
        >
          <Field label="E-mail" htmlFor="email"><Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          <Button type="submit" loading={loading}>Enviar link</Button>
        </form>
      )}
    </AuthCard>
  );
}
