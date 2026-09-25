import PDFDocument from 'pdfkit';
import { formatBRL, formatDateBR } from '@gct/shared';
import type { DocType } from './documents';

type Snap = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const TITLES: Record<DocType, string> = {
  sale_receipt: 'RECIBO DE VENDA',
  purchase_term: 'TERMO COMERCIAL DE AQUISIÇÃO',
  trade_summary: 'RESUMO DA TROCA',
  quote: 'ORÇAMENTO',
  return_receipt: 'COMPROVANTE DE DEVOLUÇÃO',
  warranty: 'TERMO DE GARANTIA COMERCIAL',
};

const brl = (v: unknown) => formatBRL(String(v ?? '0'));
const date = (v: unknown) => (typeof v === 'string' ? formatDateBR(v) : v ? formatDateBR(new Date(v as string).toISOString()) : '');
const PAYMENT_LABEL: Record<string, string> = {
  cash: 'Dinheiro', pix: 'Pix', debit: 'Débito', credit: 'Crédito', bank_transfer: 'Transferência', store_credit: 'Crédito da loja', installment: 'Crediário', trade_offset: 'Compensação de troca',
};

/** Renderiza PDF comercial (não fiscal) a partir do snapshot congelado. */
export function renderDocumentPdf(type: DocType, s: Snap, templateVersion: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48, info: { Title: TITLES[type], Producer: 'Gestão Compra e Troca' } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    try {
      const company = s.company ?? {};
      doc.font('Helvetica-Bold').fontSize(14).text(company.name ?? '', { continued: false });
      doc.font('Helvetica').fontSize(9).fillColor('#444');
      const line = [company.legalName, company.document ? `Doc.: ${company.document}` : null, company.phone, company.email].filter(Boolean).join(' · ');
      if (line) doc.text(line);
      const addr = company.address ?? {};
      const addrLine = [addr.street, addr.number, addr.district, addr.city, addr.state].filter(Boolean).join(', ');
      if (addrLine) doc.text(addrLine);
      doc.moveDown(0.8).fillColor('#000');
      doc.font('Helvetica-Bold').fontSize(12).text(`${TITLES[type]} Nº ${s.docNumber ?? ''}`);
      doc.font('Helvetica').fontSize(9).fillColor('#555').text('Documento comercial sem valor fiscal.');
      doc.fillColor('#000').moveDown(0.6);

      const party = s.customer ?? s.supplier ?? s.party;
      if (party) {
        const label = type === 'purchase_term' ? 'Vendedor (pessoa que entrega o item)' : 'Cliente';
        doc.font('Helvetica-Bold').fontSize(10).text(label);
        doc.font('Helvetica').text([party.name, party.document ? `Doc.: ${party.document}` : null, party.phone].filter(Boolean).join(' · '));
        doc.moveDown(0.5);
      }
      if (s.date) doc.fontSize(10).text(`Data: ${date(s.date)}${s.number ? ` · Operação nº ${s.number}` : ''}`);
      if (s.validUntil) doc.text(`Válido até: ${date(s.validUntil)}`);
      doc.moveDown(0.5);

      const table = (rows: [string, string, string, string][], header: [string, string, string, string]) => {
        const x = [48, 300, 360, 450];
        const w = [250, 55, 85, 97];
        doc.font('Helvetica-Bold').fontSize(9);
        let y = doc.y;
        header.forEach((h, i) => doc.text(h, x[i]!, y, { width: w[i]!, align: i === 0 ? 'left' : 'right' }));
        doc.moveTo(48, doc.y + 2).lineTo(547, doc.y + 2).strokeColor('#bbb').stroke();
        doc.moveDown(0.4);
        doc.font('Helvetica');
        for (const r of rows) {
          y = doc.y;
          r.forEach((c, i) => doc.text(c, x[i]!, y, { width: w[i]!, align: i === 0 ? 'left' : 'right' }));
          doc.moveDown(0.2);
        }
        doc.x = 48;
        doc.moveDown(0.5);
      };
      const idText = (ids: { kind: string; value: string }[] | undefined) =>
        ids && ids.length ? ` (${ids.map((i) => `${i.kind.toUpperCase()}: ${i.value}`).join(', ')})` : '';
      const total = (label: string, value: unknown, bold = false) => {
        doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(10).text(`${label}: ${brl(value)}`, { align: 'right' });
      };

      switch (type) {
        case 'sale_receipt':
        case 'quote': {
          table(
            (s.items ?? []).map((i: Snap) => [`${i.description}${idText(i.identifiers)}`, String(i.quantity), brl(i.unit_price_cents), brl(i.total_cents)]),
            ['Item', 'Qtd', 'Preço', 'Total'],
          );
          total('Subtotal', s.subtotalCents);
          if (BigInt(s.discountCents ?? 0) > 0n) total('Descontos', s.discountCents);
          if (BigInt(s.shippingCents ?? 0) > 0n) total('Frete', s.shippingCents);
          total('Total', s.totalCents, true);
          if ((s.payments ?? []).length) {
            doc.moveDown(0.5).font('Helvetica-Bold').text('Pagamento');
            doc.font('Helvetica');
            for (const p of s.payments) doc.text(`${p.method_name ?? PAYMENT_LABEL[p.kind]}: ${brl(p.amount_cents)}${p.installments > 1 ? ` em ${p.installments}x` : ''}`);
          }
          const withWarranty = (s.items ?? []).filter((i: Snap) => i.warranty_days > 0);
          if (withWarranty.length) {
            doc.moveDown(0.5).font('Helvetica-Bold').text('Garantia comercial');
            doc.font('Helvetica');
            for (const i of withWarranty) doc.text(`${i.description}: ${i.warranty_days} dias a partir da data da venda.`);
            if (company.warrantyTerms) doc.text(company.warrantyTerms);
          }
          break;
        }
        case 'purchase_term': {
          for (const i of s.items ?? []) {
            doc.font('Helvetica-Bold').fontSize(10).text(`${i.description} — ${i.quantity} un. × ${brl(i.unitCostCents)}`);
            doc.font('Helvetica').fontSize(9);
            for (const u of i.units ?? []) {
              doc.text(`Unidade ${u.internal_code}${idText(u.identifiers)} · condição: ${u.condition ?? 'não informada'}${u.battery_health_pct != null ? ` · bateria ${u.battery_health_pct}%` : ''}`);
              if (u.accessories) doc.text(`Acessórios: ${u.accessories}`);
              if (u.defects) doc.text(`Defeitos observados: ${u.defects}`);
            }
            doc.moveDown(0.3);
          }
          total('Valor total acordado', s.totalCents, true);
          doc.moveDown(0.8).fontSize(9).text(s.declaration ?? '');
          doc.moveDown(2).text('______________________________            ______________________________');
          doc.text('Vendedor                                                           Empresa');
          break;
        }
        case 'trade_summary': {
          doc.font('Helvetica-Bold').fontSize(10).text('Produtos entregues ao cliente');
          table((s.outgoing ?? []).map((i: Snap) => [`${i.description}${idText(i.identifiers)}`, String(i.quantity), brl(i.unit_price_cents), brl(i.total_cents)]), ['Item', 'Qtd', 'Preço', 'Total']);
          doc.font('Helvetica-Bold').fontSize(10).text('Produtos recebidos do cliente');
          table((s.incoming ?? []).map((i: Snap) => [`${i.description}${idText(i.identifiers)}${i.condition ? ` · ${i.condition}` : ''}`, String(i.quantity), '', brl(i.agreed_cents)]), ['Item', 'Qtd', '', 'Avaliação']);
          total('Valor dos produtos entregues (S)', s.saleTotalCents);
          total('Avaliação dos produtos recebidos (P)', s.purchaseTotalCents);
          total('Compensado sem dinheiro', s.offsetCents);
          const d = BigInt(s.differenceCents ?? 0);
          doc.moveDown(0.3).font('Helvetica-Bold').fontSize(11);
          if (d > 0n) doc.text(`Cliente paga à empresa: ${brl(d)}`, { align: 'right' });
          else if (d < 0n) doc.text(`Empresa ${s.differencePolicy === 'store_credit' ? 'concede crédito da loja ao cliente' : 'paga ao cliente'}: ${brl(-d)}`, { align: 'right' });
          else doc.text('Sem diferença: nenhum pagamento.', { align: 'right' });
          if ((s.differencePayments ?? []).length) {
            doc.font('Helvetica').fontSize(9);
            for (const p of s.differencePayments) doc.text(`${p.method_name}: ${brl(p.amount_cents)}${p.installments > 1 ? ` em ${p.installments}x` : ''}`, { align: 'right' });
          }
          doc.moveDown(2).font('Helvetica').fontSize(9).text('______________________________            ______________________________');
          doc.text('Cliente                                                              Empresa');
          break;
        }
        case 'return_receipt': {
          doc.fontSize(10).text(`${s.kind === 'cancellation' ? 'Cancelamento' : 'Devolução'} referente à venda nº ${s.saleNumber} de ${date(s.saleDate)}`);
          doc.text(`Motivo: ${s.reason}`);
          doc.moveDown(0.5);
          table((s.items ?? []).map((i: Snap) => [i.description, String(i.quantity ?? ''), '', brl(i.revenue_cents)]), ['Item', 'Qtd', '', 'Valor']);
          total('Valor devolvido', s.revenueCents, true);
          if (BigInt(s.reducedBalanceCents ?? 0) > 0n) total('Abatido de saldo em aberto', s.reducedBalanceCents);
          if (BigInt(s.refundCents ?? 0) > 0n) total('Reembolso ao cliente', s.refundCents);
          if (BigInt(s.storeCreditCents ?? 0) > 0n) total('Crédito da loja concedido', s.storeCreditCents);
          break;
        }
        case 'warranty': {
          doc.fontSize(10).text(s.description ?? '');
          if (s.terms) doc.moveDown(0.5).text(`Termos: ${s.terms}`);
          break;
        }
      }
      if (company.receiptFooter) doc.moveDown(1).fontSize(8).fillColor('#555').text(company.receiptFooter);
      doc.fontSize(7).fillColor('#888').text(`Modelo ${templateVersion}`, 48, 800, { align: 'left' });
      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}
