'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '@/components/ui';
import { api, ApiError } from '@/lib/client/api';
import { useMe } from '@/lib/client/session';
import { AuthCard } from '../../auth-card';

export default function InvitePage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const me = useMe();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const loggedIn = !!me.data;
  return (
    <AuthCard eyebrow="Convite" title="Participar de uma empresa" subtitle="O convite expira em 7 dias e só pode ser usado uma vez.">
      {!loggedIn ? (
        <div className="flex flex-col gap-3 text-sm text-muted">
          <p>Entre ou crie sua conta para aceitar. Se o convite foi enviado para o seu e-mail, use esse mesmo e-mail.</p>
          <div className="flex gap-2">
            <Link className="rounded-xl bg-primary-btn px-4 py-2 text-white" href={`/entrar?volta=${encodeURIComponent(`/convite/${token}`)}`}>Entrar</Link>
            <Link className="rounded-xl border border-line-strong px-4 py-2" href={`/cadastro?volta=${encodeURIComponent(`/convite/${token}`)}`}>Criar conta</Link>
          </div>
          <p className="text-xs">Depois de entrar, você volta para esta página para aceitar.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted">Você está conectado como <strong className="text-fg">{me.data?.user.email}</strong>.</p>
          {error && <p role="alert" className="text-sm text-danger-soft">{error}</p>}
          <Button
            loading={loading}
            onClick={async () => {
              setLoading(true);
              try {
                await api('invites/accept', { body: { token } });
                // A lista de empresas em cache é de antes do convite: recarrega tudo.
                qc.clear();
                router.replace('/app');
              } catch (e) {
                setError(e instanceof ApiError ? e.message : 'Falha ao aceitar.');
              } finally {
                setLoading(false);
              }
            }}
          >
            Aceitar convite
          </Button>
        </div>
      )}
    </AuthCard>
  );
}
