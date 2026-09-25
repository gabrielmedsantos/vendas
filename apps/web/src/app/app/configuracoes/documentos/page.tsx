'use client';

import { useQuery } from '@tanstack/react-query';
import { DocLinks } from '@/components/docs/doc-links';
import { Card, ErrorState, LoadingBlock, PageHeader } from '@/components/ui';
import { api } from '@/lib/client/api';

export default function DocumentsPage() {
  const q = useQuery({ queryKey: ['documents'], queryFn: () => api<{ id: string; docType: string; number: string; status: string }[]>('documents'), refetchInterval: 10_000 });
  return (
    <div>
      <PageHeader title="Documentos" description="Recibos, termos e resumos gerados com numeração por empresa, snapshot dos valores e hash. Sem valor fiscal." />
      <Card>
        {q.isLoading && <LoadingBlock />}
        {q.error && <ErrorState error={q.error} />}
        {q.data && <DocLinks docs={q.data} />}
      </Card>
      <p className="mt-3 text-xs text-muted">Assinatura eletrônica e emissão fiscal dependem de integração futura; nada aqui é marcado como “assinado”.</p>
    </div>
  );
}
