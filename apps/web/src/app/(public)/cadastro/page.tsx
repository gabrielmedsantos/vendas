'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button, Field, Input } from '@/components/ui';
import { authClient, authErrorMessage } from '@/lib/client/auth';
import { AuthCard } from '../auth-card';

export default function SignUpPage() {
  const router = useRouter();
  const [form, setForm] = useState({ name: '', email: '', password: '', confirm: '', terms: false });
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  return (
    <AuthCard eyebrow="Criar conta" title="Comece a organizar sua loja" subtitle="Sua conta é pessoal; a empresa é criada no próximo passo." footer={<>Já tem conta? <Link className="text-primary-soft hover:underline" href="/entrar">Entrar</Link></>}>
      <form
        className="flex flex-col gap-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setError(null);
          if (form.password.length < 10) return setError('A senha precisa ter ao menos 10 caracteres.');
          if (form.password !== form.confirm) return setError('As senhas não conferem.');
          if (!form.terms) return setError('É preciso aceitar os termos de uso e a política de privacidade.');
          setLoading(true);
          const r = await authClient.signUp.email({ name: form.name, email: form.email, password: form.password });
          setLoading(false);
          if (r.error) return setError(authErrorMessage(r.error.code, r.error.message));
          if (!r.data?.token) return setInfo('Conta criada. Enviamos um link de confirmação para o seu e-mail.');
          router.replace('/app/empresas');
        }}
      >
        <Field label="Nome completo" htmlFor="name"><Input id="name" autoComplete="name" required value={form.name} onChange={set('name')} /></Field>
        <Field label="E-mail" htmlFor="email"><Input id="email" type="email" autoComplete="email" required value={form.email} onChange={set('email')} /></Field>
        <Field label="Senha" htmlFor="password" help="Mínimo de 10 caracteres."><Input id="password" type="password" autoComplete="new-password" required value={form.password} onChange={set('password')} /></Field>
        <Field label="Confirme a senha" htmlFor="confirm"><Input id="confirm" type="password" autoComplete="new-password" required value={form.confirm} onChange={set('confirm')} /></Field>
        <label className="flex items-start gap-2 text-xs text-muted">
          <input type="checkbox" className="mt-0.5 accent-[var(--color-primary)]" checked={form.terms} onChange={set('terms')} />
          Concordo com os termos de uso e a política de privacidade do operador do serviço.
        </label>
        {error && <p role="alert" className="rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger-soft">{error}</p>}
        {info && <p role="status" className="rounded-xl border border-success/30 bg-success/10 px-3 py-2 text-sm text-success">{info}</p>}
        <Button type="submit" loading={loading}>Criar conta</Button>
      </form>
    </AuthCard>
  );
}
