'use client';

import { useQuery } from '@tanstack/react-query';
import { forwardRef, useEffect, useRef, useState, type CSSProperties } from 'react';
import { Download, Printer, Share2 } from 'lucide-react';
import { formatBRL, moneyInWords } from '@gct/shared';
import { Button, cx, ErrorState, Field, Input, LoadingBlock, Modal, Textarea } from '@/components/ui';
import { useToast } from '@/components/toast';
import { api } from '@/lib/client/api';

/**
 * Recibo da venda para entregar ao cliente: dados do cliente editáveis na hora, prévia ao vivo,
 * imprimir (A4 ou bobina 80 mm), baixar PDF e compartilhar. Não é nota fiscal.
 * Estilos inline: o mesmo HTML vai para a impressão e para o PDF, sem depender do tema do app.
 */

type Money = string;
interface Party { name: string; document: string | null; phone: string | null; email: string | null; address?: Record<string, string> | null }
export interface ReceiptData {
  company: { name: string; legalName: string | null; document: string | null; phone: string | null; email: string | null; address: Record<string, string> | null; warrantyTerms: string; receiptFooter: string | null };
  customer: Party | null;
  number: string | null;
  date: string;
  confirmedAt: string | null;
  items: { description: string; sku: string; quantity: number; unitPriceCents: Money; totalCents: Money; warrantyDays: number; identifiers: { kind: string; value: string }[] }[];
  subtotalCents: Money; discountCents: Money; shippingCents: Money; totalCents: Money;
  payments: { methodName: string | null; kind: string; amountCents: Money; installments: number; firstDueDate: string | null }[];
  notes: string | null;
  status: string;
  brand: { logoId: string | null; color: string | null };
}

interface Form { name: string; document: string; phone: string; address: string; notes: string; date: string; format: 'a4' | 'roll'; warranty: boolean; signatures: boolean }

const addr = (a?: Record<string, string> | null) => {
  if (!a) return '';
  const line1 = [a.street, a.number].filter(Boolean).join(', ');
  return [line1, a.complement, a.district, [a.city, a.state].filter(Boolean).join(' - '), a.zip ? `CEP ${a.zip}` : ''].filter(Boolean).join(' · ');
};
const phoneBR = (p: string) => {
  const d = p.replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '');
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return p;
};
const br = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
const money = (c: Money) => formatBRL(c);
const ID_LABEL: Record<string, string> = { imei1: 'IMEI', imei2: 'IMEI 2', serial: 'Série', other: 'Código' };
const KIND: Record<string, string> = { cash: 'Dinheiro', pix: 'Pix', debit: 'Cartão de débito', credit: 'Cartão de crédito', bank_transfer: 'Transferência', store_credit: 'Crédito da loja', installment: 'Crediário', trade_offset: 'Troca' };

export const ReceiptSheet = forwardRef<HTMLDivElement, { d: ReceiptData; f: Form }>(function ReceiptSheet({ d, f }, ref) {
  const accent = /^#[0-9a-f]{6}$/i.test(d.brand.color ?? '') ? d.brand.color! : '#5b34d6';
  const roll = f.format === 'roll';
  const W = roll ? 302 : 794;
  const pad = roll ? 14 : 48;
  const fs = (n: number) => (roll ? Math.max(9, n - 2) : n);
  const muted = '#5f6170';
  const line = '#e4e4ea';
  const total = BigInt(d.totalCents);
  const warrantyItems = d.items.filter((i) => i.warrantyDays > 0);
  const text: CSSProperties = { fontFamily: "'Inter Variable', Inter, Arial, sans-serif", color: '#16161d', fontSize: fs(12), lineHeight: 1.45 };
  const label: CSSProperties = { fontSize: fs(9.5), fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: accent, margin: `${roll ? 10 : 18}px 0 6px` };
  const number = d.number ? String(d.number).padStart(6, '0') : '—';
  const companyAddr = addr(d.company.address);
  return (
    <div ref={ref} style={{ ...text, width: W, background: '#fff', boxSizing: 'border-box', padding: pad, position: 'relative' }}>
      {!roll && <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 8, background: accent }} />}
      {/* Cabeçalho */}
      <div style={{ display: 'flex', flexDirection: roll ? 'column' : 'row', alignItems: roll ? 'center' : 'flex-start', justifyContent: 'space-between', gap: roll ? 6 : 24, textAlign: roll ? 'center' : 'left', paddingTop: roll ? 0 : 8 }}>
        <div style={{ display: 'flex', flexDirection: roll ? 'column' : 'row', alignItems: 'center', gap: roll ? 6 : 14 }}>
          {d.brand.logoId && <img src={`/api/v1/attachments/${d.brand.logoId}`} alt="" crossOrigin="anonymous" style={{ maxHeight: roll ? 48 : 64, maxWidth: roll ? 140 : 160, objectFit: 'contain' }} />}
          <div>
            <div style={{ fontSize: fs(18), fontWeight: 800, letterSpacing: '-0.01em' }}>{d.company.name}</div>
            {d.company.legalName && d.company.legalName !== d.company.name && <div style={{ color: muted, fontSize: fs(11) }}>{d.company.legalName}</div>}
            {d.company.document && <div style={{ color: muted, fontSize: fs(11) }}>CNPJ/CPF {d.company.document}</div>}
            <div style={{ color: muted, fontSize: fs(11) }}>{[d.company.phone && phoneBR(d.company.phone), d.company.email].filter(Boolean).join(' · ')}</div>
            {companyAddr && <div style={{ color: muted, fontSize: fs(11) }}>{companyAddr}</div>}
          </div>
        </div>
        <div style={{ textAlign: roll ? 'center' : 'right', flexShrink: 0, marginTop: roll ? 6 : 0 }}>
          <div style={{ display: 'inline-block', background: accent, color: '#fff', borderRadius: 6, padding: '4px 10px', fontSize: fs(11), fontWeight: 700, letterSpacing: '0.06em' }}>RECIBO DE VENDA</div>
          <div style={{ fontSize: fs(20), fontWeight: 800, marginTop: 6 }}>Nº {number}</div>
          <div style={{ color: muted, fontSize: fs(11) }}>{br(f.date)}</div>
        </div>
      </div>

      <div style={{ height: 1, background: line, margin: `${roll ? 10 : 22}px 0 0` }} />

      {/* Cliente */}
      <div style={label}>Cliente</div>
      <div style={{ display: 'grid', gridTemplateColumns: roll ? '1fr' : '1fr 1fr', gap: roll ? 2 : '4px 24px' }}>
        <div><span style={{ color: muted }}>Nome: </span><strong>{f.name || 'Consumidor não identificado'}</strong></div>
        {f.document && <div><span style={{ color: muted }}>CPF/CNPJ: </span>{f.document}</div>}
        {f.phone && <div><span style={{ color: muted }}>Telefone: </span>{phoneBR(f.phone)}</div>}
        {f.address && <div style={{ gridColumn: roll ? 'auto' : '1 / -1' }}><span style={{ color: muted }}>Endereço: </span>{f.address}</div>}
      </div>

      {/* Itens */}
      <div style={label}>Itens</div>
      {roll ? (
        <div>
          {d.items.map((i, k) => (
            <div key={k} style={{ padding: '5px 0', borderBottom: `1px dashed ${line}` }}>
              <div style={{ fontWeight: 600 }}>{i.description}</div>
              {i.identifiers.map((x) => <div key={x.value} style={{ color: muted, fontSize: fs(10) }}>{ID_LABEL[x.kind] ?? x.kind}: {x.value}</div>)}
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: muted }}>{i.quantity} × {money(i.unitPriceCents)}</span><strong>{money(i.totalCents)}</strong></div>
            </div>
          ))}
        </div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: '#f4f3fa' }}>
              {['Descrição', 'Qtd', 'Valor unit.', 'Total'].map((h, k) => <th key={h} style={{ textAlign: k ? 'right' : 'left', padding: '8px 10px', fontSize: fs(10), fontWeight: 700, color: muted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {d.items.map((i, k) => (
              <tr key={k} style={{ borderBottom: `1px solid ${line}` }}>
                <td style={{ padding: '9px 10px', verticalAlign: 'top' }}>
                  <div style={{ fontWeight: 600 }}>{i.description}</div>
                  {i.identifiers.length > 0 && <div style={{ color: muted, fontSize: fs(10.5) }}>{i.identifiers.map((x) => `${ID_LABEL[x.kind] ?? x.kind}: ${x.value}`).join(' · ')}</div>}
                  {f.warranty && i.warrantyDays > 0 && <div style={{ color: muted, fontSize: fs(10.5) }}>Garantia: {i.warrantyDays} dias</div>}
                </td>
                <td style={{ padding: '9px 10px', textAlign: 'right', verticalAlign: 'top' }}>{i.quantity}</td>
                <td style={{ padding: '9px 10px', textAlign: 'right', verticalAlign: 'top', whiteSpace: 'nowrap' }}>{money(i.unitPriceCents)}</td>
                <td style={{ padding: '9px 10px', textAlign: 'right', verticalAlign: 'top', whiteSpace: 'nowrap', fontWeight: 600 }}>{money(i.totalCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Totais e pagamento */}
      <div style={{ display: 'flex', flexDirection: roll ? 'column-reverse' : 'row', justifyContent: 'space-between', gap: roll ? 8 : 24, marginTop: roll ? 8 : 16 }}>
        <div style={{ flex: 1 }}>
          <div style={{ ...label, marginTop: roll ? 8 : 0 }}>Pagamento</div>
          {d.payments.length === 0 && <div style={{ color: muted }}>—</div>}
          {d.payments.map((p, k) => (
            <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, maxWidth: roll ? 'none' : 300 }}>
              <span>{p.methodName ?? KIND[p.kind] ?? p.kind}{p.installments > 1 ? ` · ${p.installments}x de ${money((BigInt(p.amountCents) / BigInt(p.installments)).toString())}` : ''}</span>
              <span style={{ whiteSpace: 'nowrap' }}>{money(p.amountCents)}</span>
            </div>
          ))}
        </div>
        <div style={{ minWidth: roll ? 0 : 240 }}>
          {[['Subtotal', d.subtotalCents], ...(BigInt(d.discountCents) > 0n ? [['Desconto', `-${d.discountCents}`]] : []), ...(BigInt(d.shippingCents) > 0n ? [['Frete', d.shippingCents]] : [])].map(([l, v]) => (
            <div key={l} style={{ display: 'flex', justifyContent: 'space-between', color: muted }}><span>{l}</span><span>{v!.startsWith('-') ? `− ${money(v!.slice(1))}` : money(v!)}</span></div>
          ))}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 6, paddingTop: 6, borderTop: `2px solid ${accent}` }}>
            <span style={{ fontWeight: 700 }}>TOTAL</span><span style={{ fontSize: fs(20), fontWeight: 800, color: accent }}>{money(d.totalCents)}</span>
          </div>
        </div>
      </div>

      {/* Declaração */}
      <div style={{ marginTop: roll ? 10 : 22, padding: roll ? 8 : 14, background: '#f7f6fc', borderRadius: 8, borderLeft: `3px solid ${accent}` }}>
        Recebemos de <strong>{f.name || 'consumidor não identificado'}</strong> a importância de <strong>{money(d.totalCents)}</strong> ({moneyInWords(total)}), referente aos itens acima.
      </div>

      {f.notes.trim() && (<><div style={label}>Observações</div><div style={{ whiteSpace: 'pre-wrap' }}>{f.notes}</div></>)}

      {f.warranty && warrantyItems.length > 0 && (
        <>
          <div style={label}>Garantia</div>
          <div style={{ fontSize: fs(10.5), color: muted, whiteSpace: 'pre-wrap' }}>{d.company.warrantyTerms}</div>
        </>
      )}

      {f.signatures && (
        <div style={{ display: 'flex', flexDirection: roll ? 'column' : 'row', gap: roll ? 22 : 40, marginTop: roll ? 26 : 48 }}>
          {[d.company.name, f.name || 'Cliente'].map((n, k) => (
            <div key={k} style={{ flex: 1, textAlign: 'center' }}>
              <div style={{ borderTop: '1px solid #16161d', paddingTop: 4, fontSize: fs(11) }}>{n}</div>
              <div style={{ color: muted, fontSize: fs(10) }}>{k ? 'Cliente' : 'Loja'}</div>
            </div>
          ))}
        </div>
      )}

      <div style={{ marginTop: roll ? 14 : 28, textAlign: 'center', color: muted, fontSize: fs(10) }}>
        {d.company.receiptFooter && <div style={{ marginBottom: 2 }}>{d.company.receiptFooter}</div>}
        Este recibo não substitui documento fiscal.
      </div>
    </div>
  );
});

export function ReceiptModal({ saleId, open, onClose }: { saleId: string; open: boolean; onClose: () => void }) {
  const toast = useToast();
  const q = useQuery({ queryKey: ['receipt-data', saleId], queryFn: () => api<ReceiptData>(`sales/${saleId}/receipt-data`), enabled: open });
  const [f, setF] = useState<Form | null>(null);
  const [busy, setBusy] = useState<null | 'pdf' | 'share' | 'print'>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [sheetH, setSheetH] = useState(1123);

  useEffect(() => {
    if (!q.data || f) return;
    const c = q.data.customer;
    setF({ name: c?.name ?? '', document: c?.document ?? '', phone: c?.phone ?? '', address: addr(c?.address), notes: q.data.notes ?? '', date: q.data.date, format: 'a4', warranty: true, signatures: true });
  }, [q.data, f]);

  // Prévia encaixada na largura disponível.
  useEffect(() => {
    const el = box.current;
    if (!el || !f) return;
    const W = f.format === 'roll' ? 302 : 794;
    const ro = new ResizeObserver(() => {
      setScale(Math.min(1, (el.clientWidth - 24) / W));
      if (sheet.current) setSheetH(sheet.current.offsetHeight);
    });
    ro.observe(el);
    if (sheet.current) ro.observe(sheet.current);
    return () => ro.disconnect();
  }, [f]);

  const fileName = () => `recibo-${q.data?.number ? String(q.data.number).padStart(6, '0') : 'venda'}.pdf`;

  const toPdf = async (): Promise<Blob> => {
    const node = sheet.current!;
    const { domToJpeg } = await import('modern-screenshot');
    const w = node.offsetWidth;
    const h = node.offsetHeight;
    const img = await domToJpeg(node, { width: w, height: h, scale: 2, quality: 0.95, backgroundColor: '#ffffff' });
    const { jsPDF } = await import('jspdf');
    if (f!.format === 'roll') {
      const mmW = 80;
      const mmH = (h / w) * mmW;
      const pdf = new jsPDF({ unit: 'mm', format: [mmW, mmH], orientation: 'portrait' });
      pdf.addImage(img, 'JPEG', 0, 0, mmW, mmH);
      return pdf.output('blob');
    }
    // A4: a imagem ocupa a largura; recibos longos seguem em mais páginas.
    const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
    const pageW = 210;
    const pageH = 297;
    const imgH = (h / w) * pageW;
    for (let y = 0, i = 0; y < imgH; y += pageH, i++) {
      if (i) pdf.addPage();
      pdf.addImage(img, 'JPEG', 0, -y, pageW, imgH);
    }
    return pdf.output('blob');
  };

  const download = async () => {
    setBusy('pdf');
    try {
      const blob = await toPdf();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = fileName();
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      toast('PDF do recibo baixado.');
    } catch { toast('Não foi possível gerar o PDF.'); } finally { setBusy(null); }
  };

  const share = async () => {
    setBusy('share');
    try {
      const file = new File([await toPdf()], fileName(), { type: 'application/pdf' });
      if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: 'Recibo de venda' });
      else { const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = file.name; a.click(); toast('Compartilhamento indisponível aqui; PDF baixado.'); }
    } catch (e) { if ((e as Error).name !== 'AbortError') toast('Não foi possível compartilhar.'); } finally { setBusy(null); }
  };

  const print = async () => {
    setBusy('print');
    try {
      const html = sheet.current!.outerHTML;
      const frame = document.createElement('iframe');
      frame.setAttribute('aria-hidden', 'true');
      frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
      document.body.appendChild(frame);
      const doc = frame.contentDocument!;
      const roll = f!.format === 'roll';
      doc.open();
      doc.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${fileName()}</title><style>@page{size:${roll ? '80mm auto' : 'A4'};margin:${roll ? '0' : '0'}}html,body{margin:0;background:#fff}*{-webkit-print-color-adjust:exact;print-color-adjust:exact}</style></head><body>${html}</body></html>`);
      doc.close();
      await Promise.all(Array.from(doc.images).map((im) => (im.complete ? null : new Promise((r) => { im.onload = r; im.onerror = r; }))));
      frame.contentWindow!.focus();
      frame.contentWindow!.print();
      setTimeout(() => frame.remove(), 1000);
    } finally { setBusy(null); }
  };

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((s) => (s ? { ...s, [k]: v } : s));
  const W = f?.format === 'roll' ? 302 : 794;

  return (
    <Modal open={open} onClose={onClose} title="Recibo da venda" wide footer={
      <div className="flex w-full flex-wrap justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>Fechar</Button>
        <Button variant="secondary" disabled={!f} loading={busy === 'print'} onClick={print}><Printer className="size-4" />Imprimir</Button>
        <Button variant="secondary" disabled={!f} loading={busy === 'share'} onClick={share}><Share2 className="size-4" />Compartilhar</Button>
        <Button disabled={!f} loading={busy === 'pdf'} onClick={download}><Download className="size-4" />Baixar PDF</Button>
      </div>
    }>
      {q.isLoading && <LoadingBlock rows={6} />}
      {q.error && <ErrorState error={q.error} retry={() => q.refetch()} />}
      {q.data && f && (
        <div className="grid gap-5 lg:grid-cols-[300px_minmax(0,1fr)]">
          <div className="flex flex-col gap-3">
            <p className="text-xs text-muted">Os dados abaixo saem só neste recibo; o cadastro do cliente não muda.</p>
            <Field label="Nome do cliente" htmlFor="rc-name"><Input id="rc-name" maxLength={160} value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="Consumidor" /></Field>
            <Field label="CPF/CNPJ" htmlFor="rc-doc"><Input id="rc-doc" maxLength={20} value={f.document} onChange={(e) => set('document', e.target.value)} /></Field>
            <Field label="Telefone" htmlFor="rc-phone"><Input id="rc-phone" maxLength={30} inputMode="tel" value={f.phone} onChange={(e) => set('phone', e.target.value)} /></Field>
            <Field label="Endereço" htmlFor="rc-addr"><Input id="rc-addr" maxLength={240} value={f.address} onChange={(e) => set('address', e.target.value)} /></Field>
            <Field label="Observações" htmlFor="rc-notes"><Textarea id="rc-notes" rows={3} maxLength={1000} value={f.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Ex.: entrega combinada para sábado" /></Field>
            <Field label="Data do recibo" htmlFor="rc-date"><Input id="rc-date" type="date" value={f.date} onChange={(e) => set('date', e.target.value || q.data!.date)} /></Field>
            <div>
              <p className="mb-1.5 text-xs font-medium text-muted">Formato</p>
              <div role="radiogroup" aria-label="Formato" className="grid grid-cols-2 gap-1 rounded-xl border border-line bg-bg p-1">
                {([['a4', 'Folha A4'], ['roll', 'Bobina 80 mm']] as const).map(([id, l]) => (
                  <button key={id} type="button" role="radio" aria-checked={f.format === id} onClick={() => set('format', id)} className={cx('rounded-lg px-2 py-1.5 text-sm font-medium', f.format === id ? 'bg-primary text-white' : 'text-muted hover:text-fg')}>{l}</button>
                ))}
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-[var(--color-primary)]" checked={f.warranty} onChange={(e) => set('warranty', e.target.checked)} />Mostrar garantia</label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-[var(--color-primary)]" checked={f.signatures} onChange={(e) => set('signatures', e.target.checked)} />Linhas de assinatura</label>
          </div>
          <div ref={box} className="min-w-0 overflow-hidden rounded-xl border border-line bg-[#2a2b36] p-3">
            <div style={{ width: W * scale, height: sheetH * scale, margin: '0 auto' }}>
              <div style={{ transform: `scale(${scale})`, transformOrigin: 'top left', width: W, boxShadow: '0 10px 30px rgba(0,0,0,.35)' }} aria-label="Prévia do recibo">
                <ReceiptSheet ref={sheet} d={q.data} f={f} />
              </div>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
