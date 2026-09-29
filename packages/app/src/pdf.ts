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
  sale_contract: 'CONTRATO DE COMPRA E VENDA',
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

      const party = type === 'sale_contract' ? null : s.customer ?? s.supplier ?? s.party;
      if (party) {
        const label = type === 'purchase_term' ? 'Vendedor (pessoa que entrega o item)' : 'Cliente';
        doc.font('Helvetica-Bold').fontSize(10).text(label);
        doc.font('Helvetica').text([party.name, party.document ? `Doc.: ${party.document}` : null, party.phone].filter(Boolean).join(' · '));
        doc.moveDown(0.5);
      }
      if (s.date && type !== 'sale_contract') doc.fontSize(10).text(`Data: ${date(s.date)}${s.number ? ` · Operação nº ${s.number}` : ''}`);
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
        case 'sale_contract': {
          renderSaleContract(doc, s, company);
          break;
        }
        case 'warranty': {
          doc.fontSize(10).text(s.description ?? '');
          if (s.terms) doc.moveDown(0.5).text(`Termos: ${s.terms}`);
          break;
        }
      }
      if (company.receiptFooter) doc.moveDown(1).fontSize(8).fillColor('#555').text(company.receiptFooter);
      // Rodapé fora da área útil: zera a margem inferior para não abrir página nova só com ele.
      const bottom = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      doc.fontSize(7).fillColor('#888').text(`Modelo ${templateVersion}`, 48, doc.page.height - 36, { align: 'left', lineBreak: false });
      doc.page.margins.bottom = bottom;
      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}

const CONDITION: Record<string, string> = { new: 'Novo', used: 'Seminovo/usado', refurbished: 'Recondicionado', defective: 'Com defeito' };
const ID_LABEL: Record<string, string> = { imei1: 'IMEI 1', imei2: 'IMEI 2', serial: 'Nº de série' };

/** Contrato de compra e venda preenchido com a venda confirmada (modelo contrato-venda@1). */
function renderSaleContract(doc: PDFKit.PDFDocument, s: Snap, company: Snap) {
  const L = 48;
  const W = 499;
  let n = 0;
  const section = (title: string) => {
    if (doc.y > 720) doc.addPage();
    doc.moveDown(0.6).font('Helvetica-Bold').fontSize(10.5).fillColor('#000').text(`${++n}. ${title}`, L, doc.y, { width: W });
    doc.moveDown(0.25).font('Helvetica').fontSize(9.5);
  };
  const para = (t: string) => doc.font('Helvetica').fontSize(9.5).fillColor('#000').text(t, L, doc.y, { width: W, align: 'justify' }).moveDown(0.3);
  const field = (label: string, value: string | null | undefined) => {
    doc.font('Helvetica-Bold').fontSize(9.5).text(`${label}: `, L, doc.y, { continued: true, width: W }).font('Helvetica').text(value && String(value).trim() ? String(value) : '______________________________');
  };
  const addr = (a: Snap | undefined) => (a ? [a.street, a.number, a.district, a.city, a.state, a.zip].filter(Boolean).join(', ') : '');
  const customer = s.customer ?? {};
  const items: Snap[] = s.items ?? [];

  doc.font('Helvetica').fontSize(9.5).text(`Venda nº ${s.number ?? '—'} · Data ${date(s.date)}`, L, doc.y, { width: W });

  section('Partes');
  doc.font('Helvetica-Bold').text('LOJA VENDEDORA', L, doc.y);
  field('Nome/razão social', company.legalName || company.name);
  field('CNPJ/CPF', company.document);
  field('Endereço', addr(company.address));
  field('Contato', [company.phone, company.email].filter(Boolean).join(' · '));
  doc.moveDown(0.3).font('Helvetica-Bold').text('COMPRADOR', L, doc.y);
  field('Nome', customer.name);
  field('CPF/CNPJ', customer.document);
  field('Endereço', addr(customer.address));
  field('Contato', [customer.phone, customer.email].filter(Boolean).join(' · '));

  section('Objeto: produto vendido');
  for (const i of items) {
    doc.font('Helvetica-Bold').fontSize(9.5).text(`${i.description}${i.quantity > 1 ? ` (${i.quantity} un.)` : ''}`, L, doc.y, { width: W });
    doc.font('Helvetica');
    const ids = (i.identifiers ?? []).map((x: Snap) => `${ID_LABEL[x.kind] ?? x.kind.toUpperCase()}: ${x.value}`).join(' · ');
    const lines = [
      i.brand ? `Marca: ${i.brand}` : null,
      ids || null,
      i.condition ? `Condição: ${CONDITION[i.condition] ?? i.condition}${i.battery_health_pct != null ? ` · saúde da bateria ${i.battery_health_pct}%` : ''}` : null,
      i.accessories ? `Acessórios entregues: ${i.accessories}` : null,
      i.defects ? `Avarias/marcas informadas ao comprador (não cobertas pela garantia): ${i.defects}` : null,
    ].filter(Boolean) as string[];
    for (const l of lines) doc.text(l, L + 10, doc.y, { width: W - 10 });
    doc.moveDown(0.3);
  }

  section('Preço e forma de pagamento');
  for (const i of items) doc.text(`${i.description}: ${i.quantity} × ${brl(i.unit_price_cents)} = ${brl(i.total_cents)}`, L, doc.y, { width: W });
  if (BigInt(s.discountCents ?? 0) > 0n) doc.text(`Desconto: ${brl(s.discountCents)}`, L, doc.y);
  if (BigInt(s.shippingCents ?? 0) > 0n) doc.text(`Frete: ${brl(s.shippingCents)}`, L, doc.y);
  doc.font('Helvetica-Bold').text(`Valor total: ${brl(s.totalCents)}`, L, doc.y).font('Helvetica');
  for (const p of s.payments ?? []) {
    if (p.kind === 'trade_offset') { doc.text(`Aparelho usado recebido como parte do pagamento: ${brl(p.amount_cents)}`, L, doc.y); continue; }
    doc.text(`${p.method_name ?? PAYMENT_LABEL[p.kind] ?? p.kind}: ${brl(p.amount_cents)}${p.installments > 1 ? ` em ${p.installments}x` : ''}${p.kind === 'installment' && p.first_due_date ? ` · 1º vencimento ${date(p.first_due_date)}` : ''}`, L, doc.y, { width: W });
  }
  const hasInstallment = (s.payments ?? []).some((p: Snap) => p.kind === 'installment');

  section('Entrega e conferência');
  para('O comprador recebe o produto descrito acima, confere com a loja o funcionamento, os identificadores e os acessórios, e declara que o recebeu nas condições informadas neste contrato. A loja entrega o aparelho sem contas vinculadas, sem Bloqueio de Ativação e sem gestão empresarial.');

  section('Procedência');
  para('A loja declara que o produto tem origem lícita, que seus identificadores não foram adulterados e que não havia restrição de IMEI conhecida na data da venda. Se surgir bloqueio, apreensão ou restrição por fato anterior à venda, a loja, comprovado o fato e notificada pelo comprador, substituirá o produto por outro equivalente ou restituirá o valor pago, à escolha do comprador, em até 10 dias úteis, sem prejuízo de outros direitos previstos em lei.');

  section('Garantia');
  const withWarranty = items.filter((i) => Number(i.warranty_days) > 0);
  if (withWarranty.length) {
    for (const i of withWarranty) {
      const d = Number(i.warranty_days);
      doc.text(`${i.description}: ${d % 30 === 0 ? `${d / 30} ${d / 30 === 1 ? 'mês' : 'meses'} (${d} dias)` : `${d} dias`} a partir da entrega.`, L, doc.y, { width: W });
    }
    doc.moveDown(0.2);
    para(company.warrantyTerms ?? '');
  } else {
    para('Sem garantia comercial adicional da loja para os itens acima.');
  }
  if (!String(company.warrantyTerms ?? '').includes('Código de Defesa do Consumidor') || !withWarranty.length) {
    para('Esta garantia não substitui nem reduz a garantia legal e os demais direitos do consumidor previstos no Código de Defesa do Consumidor.');
  }

  if (hasInstallment) {
    section('Pagamento parcelado pela loja');
    para('Havendo saldo no crediário da loja, o comprador pagará as parcelas nos vencimentos acordados. O atraso gera multa de 2% (dois por cento) e juros de mora de 1% (um por cento) ao mês, proporcionais aos dias de atraso. O comprador pode antecipar parcelas com redução proporcional dos juros e encargos. A cobrança será feita somente pelos meios legais, sem retomada forçada do produto nem exposição do comprador.');
  }

  section('Arrependimento');
  para('Na compra feita fora do estabelecimento (internet, telefone ou mensagem com entrega), o comprador pode desistir em até 7 (sete) dias do recebimento, com devolução integral dos valores pagos.');

  section('Dados pessoais');
  para('A loja trata os dados pessoais para executar esta venda e a garantia, prevenir fraudes, cumprir a lei e exercer direitos, com acesso restrito e compartilhamento somente quando exigido por lei. O titular pode exercer seus direitos pelo contato da loja. Não se autoriza publicidade nem acesso ao conteúdo pessoal do aparelho.');

  // Aceite e assinaturas sempre juntos.
  if (doc.y > 600) doc.addPage();
  section('Aceite');
  para('As partes leram e concordam com este contrato e confirmam os dados acima.');
  const city = company.address?.city;
  doc.text(`${city ? `${city}, ` : 'Local: ____________________, '}${date(s.date)}.`, L, doc.y).moveDown(3);
  const y = doc.y;
  doc.moveTo(L, y).lineTo(L + 220, y).strokeColor('#000').stroke();
  doc.moveTo(L + 279, y).lineTo(L + W, y).stroke();
  doc.fontSize(9).text('LOJA VENDEDORA', L, y + 4, { width: 220, align: 'center' });
  doc.text('COMPRADOR', L + 279, y + 4, { width: 220, align: 'center' });
  doc.fontSize(8.5).fillColor('#444');
  doc.text(company.legalName || company.name || '', L, y + 17, { width: 220, align: 'center' });
  doc.text(customer.name ?? '', L + 279, y + 17, { width: 220, align: 'center' });
  doc.fillColor('#000').text('', L, y + 40);
}
