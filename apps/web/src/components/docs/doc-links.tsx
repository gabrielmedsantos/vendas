'use client';

import { useQueryClient } from '@tanstack/react-query';
import { FileText, RefreshCw } from 'lucide-react';
import { Badge, Button } from '@/components/ui';
import { api } from '@/lib/client/api';

const LABEL: Record<string, string> = {
  sale_receipt: 'Recibo de venda', purchase_term: 'Termo de aquisição', trade_summary: 'Resumo da troca', quote: 'Orçamento', return_receipt: 'Comprovante de devolução', warranty: 'Termo de garantia',
};

export function DocLinks({ docs }: { docs: { id: string; docType: string; number: string; status: string }[] }) {
  const qc = useQueryClient();
  if (!docs.length) return <p className="text-sm text-muted">Nenhum documento.</p>;
  return (
    <ul className="flex flex-col gap-2">
      {docs.map((d) => (
        <li key={d.id} className="flex items-center justify-between gap-2 rounded-xl border border-line bg-bg px-3 py-2 text-sm">
          <span className="flex items-center gap-2"><FileText className="size-4 text-primary-soft" />{LABEL[d.docType] ?? d.docType} nº {d.number}</span>
          {d.status === 'ready' ? (
            <a className="text-xs text-primary-soft hover:underline" href={`/api/v1/documents/${d.id}/pdf`} target="_blank" rel="noopener">Baixar PDF</a>
          ) : d.status === 'failed' ? (
            <Button size="sm" variant="secondary" onClick={async () => { await api(`documents/${d.id}/retry`, { method: 'POST' }); qc.invalidateQueries(); }}><RefreshCw className="size-3.5" />Reprocessar</Button>
          ) : (
            <Badge tone="info">Gerando…</Badge>
          )}
        </li>
      ))}
      <li className="text-[11px] text-muted">Documentos comerciais, sem valor fiscal.</li>
    </ul>
  );
}
