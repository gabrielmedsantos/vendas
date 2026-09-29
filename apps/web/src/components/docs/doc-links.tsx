'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Copy, FileText, MessageCircle, RefreshCw, Send, Share2 } from 'lucide-react';
import { Badge, Button, FormError, Input, Modal } from '@/components/ui';
import { useToast } from '@/components/toast';
import { api } from '@/lib/client/api';
import { dateBR } from '@/lib/client/format';

const LABEL: Record<string, string> = {
  sale_receipt: 'Recibo de venda', purchase_term: 'Termo de aquisição', trade_summary: 'Resumo da troca', quote: 'Orçamento', return_receipt: 'Comprovante de devolução', warranty: 'Termo de garantia', sale_contract: 'Contrato de venda',
};

export interface DocContact { name: string | null; phone: string | null }
type Doc = { id: string; docType: string; number: string; status: string };

/** Telefone BR para wa.me: só dígitos, com DDI 55 quando faltar. */
function waPhone(phone: string | null): string | null {
  const d = (phone ?? '').replace(/\D/g, '');
  if (d.length === 10 || d.length === 11) return `55${d}`;
  if (d.length >= 12 && d.length <= 13) return d;
  return null;
}

function SendModal({ doc, contact, onClose }: { doc: Doc; contact?: DocContact; onClose: () => void }) {
  const toast = useToast();
  const [link, setLink] = useState<{ url: string; expiresAt: string } | null>(null);
  const [busy, setBusy] = useState<'' | 'link' | 'share'>('');
  const [error, setError] = useState<unknown>(null);
  const label = `${LABEL[doc.docType] ?? 'Documento'} nº ${doc.number}`;
  const first = contact?.name?.split(' ')[0];
  const makeLink = async () => {
    setBusy('link'); setError(null);
    try { setLink(await api<{ url: string; expiresAt: string }>(`documents/${doc.id}/share`, { method: 'POST' })); } catch (e) { setError(e); } finally { setBusy(''); }
  };
  const message = link ? `Olá${first ? `, ${first}` : ''}! Segue o seu ${label.toLowerCase()} para guardar: ${link.url}` : '';
  const phone = waPhone(contact?.phone ?? null);
  const sharePdf = async () => {
    setBusy('share'); setError(null);
    try {
      const res = await fetch(`/api/v1/documents/${doc.id}/pdf`, { credentials: 'same-origin' });
      if (!res.ok) throw new Error('Não foi possível baixar o PDF.');
      const file = new File([await res.blob()], `${label}.pdf`, { type: 'application/pdf' });
      if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: label });
      else { const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = file.name; a.click(); URL.revokeObjectURL(a.href); toast('Compartilhamento indisponível aqui; PDF baixado.'); }
    } catch (e) { if ((e as Error).name !== 'AbortError') setError(e); } finally { setBusy(''); }
  };
  return (
    <Modal open onClose={onClose} title={`Enviar ${label.toLowerCase()}`} footer={<Button variant="secondary" onClick={onClose}>Fechar</Button>}>
      <div className="flex flex-col gap-4 text-sm">
        <p className="text-muted">O cliente abre o PDF pelo link, sem precisar de conta. O link vale por 30 dias e mostra só este documento.</p>
        {!link ? (
          <Button loading={busy === 'link'} onClick={makeLink}><Send className="size-4" />Gerar link para o cliente</Button>
        ) : (
          <>
            <div className="flex gap-2">
              <Input readOnly value={link.url} aria-label="Link do documento" />
              <Button variant="secondary" aria-label="Copiar link" onClick={async () => { try { await navigator.clipboard.writeText(link.url); toast('Link copiado.'); } catch { toast('Selecione o link e copie.'); } }}><Copy className="size-4" /></Button>
            </div>
            <p className="text-xs text-muted">Válido até {dateBR(link.expiresAt.slice(0, 10))}.</p>
            <a className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#1f9d55] px-4 py-2.5 font-medium text-white hover:brightness-110" href={`https://wa.me/${phone ?? ''}?text=${encodeURIComponent(message)}`} target="_blank" rel="noopener">
              <MessageCircle className="size-4" />{phone ? `Enviar pelo WhatsApp para ${contact?.name ?? 'o cliente'}` : 'Enviar pelo WhatsApp'}
            </a>
            {!phone && <p className="text-xs text-muted">Cliente sem celular cadastrado: o WhatsApp abre para você escolher o contato.</p>}
          </>
        )}
        <div className="border-t border-line pt-3">
          <Button variant="secondary" loading={busy === 'share'} onClick={sharePdf}><Share2 className="size-4" />Compartilhar o PDF</Button>
          <p className="mt-1 text-xs text-muted">No celular, abre as opções de envio (WhatsApp, e-mail) com o arquivo anexado.</p>
        </div>
        <FormError error={error} />
      </div>
    </Modal>
  );
}

export function DocLinks({ docs, contact }: { docs: Doc[]; contact?: DocContact }) {
  const qc = useQueryClient();
  const [sending, setSending] = useState<Doc | null>(null);
  if (!docs.length) return <p className="text-sm text-muted">Nenhum documento.</p>;
  return (
    <ul className="flex flex-col gap-2">
      {docs.map((d) => (
        <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-bg px-3 py-2 text-sm">
          <span className="flex items-center gap-2"><FileText className="size-4 text-primary-soft" />{LABEL[d.docType] ?? d.docType} nº {d.number}</span>
          {d.status === 'ready' ? (
            <span className="flex items-center gap-3">
              <a className="text-xs text-primary-soft hover:underline" href={`/api/v1/documents/${d.id}/pdf`} target="_blank" rel="noopener">Baixar PDF</a>
              <Button size="sm" variant="secondary" onClick={() => setSending(d)}><Send className="size-3.5" />Enviar ao cliente</Button>
            </span>
          ) : d.status === 'failed' ? (
            <Button size="sm" variant="secondary" onClick={async () => { await api(`documents/${d.id}/retry`, { method: 'POST' }); qc.invalidateQueries(); }}><RefreshCw className="size-3.5" />Reprocessar</Button>
          ) : (
            <Badge tone="info">Gerando…</Badge>
          )}
        </li>
      ))}
      <li className="text-[11px] text-muted">Documentos comerciais, sem valor fiscal.</li>
      {sending && <SendModal doc={sending} contact={contact} onClose={() => setSending(null)} />}
    </ul>
  );
}
