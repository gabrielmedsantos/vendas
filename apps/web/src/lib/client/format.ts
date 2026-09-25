import { formatBRL, formatBps, formatDateBR } from '@gct/shared';

export const brl = (v: string | bigint | null | undefined) => (v === null || v === undefined ? '—' : formatBRL(typeof v === 'string' ? v : v));
export const pct = (bps: number | null | undefined) => (bps === undefined ? '—' : formatBps(bps ?? null));
export const dateBR = (v: string | null | undefined) => (v ? formatDateBR(v.slice(0, 10)) : '—');
export const dateTimeBR = (v: string | null | undefined) =>
  v ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(v)) : '—';
export const intBR = (n: number | null | undefined) => (n === null || n === undefined ? '—' : new Intl.NumberFormat('pt-BR').format(n));

export const STATUS_LABEL: Record<string, string> = {
  draft: 'Rascunho', confirmed: 'Confirmada', canceled: 'Cancelada', partially_returned: 'Devolução parcial', returned: 'Devolvida', reversed: 'Revertida',
  approved: 'Aprovada', partially_received: 'Recebida parcialmente', received: 'Recebida',
  open: 'Em aberto', partially_settled: 'Parcial', settled: 'Liquidado',
  inspection: 'Em inspeção', available: 'Disponível', reserved: 'Reservado', sold: 'Vendido', repair: 'Em reparo', lost: 'Baixado', returned_to_supplier: 'Devolvido',
  active: 'Ativo', inactive: 'Inativo', archived: 'Arquivado', trialing: 'Teste', past_due: 'Pagamento pendente', suspended: 'Suspenso',
  pending: 'Pendente', ready: 'Pronto', failed: 'Falhou', done: 'Concluído', processing: 'Processando',
};

export const KIND_LABEL: Record<string, string> = {
  cash: 'Dinheiro', pix: 'Pix', debit: 'Débito', credit: 'Crédito', bank_transfer: 'Transferência', store_credit: 'Crédito da loja', installment: 'Crediário', trade_offset: 'Compensação de troca', boleto: 'Boleto', other: 'Outro',
  purchase_receipt: 'Compra', sale: 'Venda', sale_return: 'Devolução', trade_in: 'Entrada de troca', trade_out: 'Saída de troca', adjustment_in: 'Ajuste (entrada)', adjustment_out: 'Ajuste (saída)',
  loss: 'Perda', supplier_return: 'Devolução ao fornecedor', inspection_release: 'Liberação de inspeção', reversal: 'Estorno',
  settlement: 'Liquidação', transfer_in: 'Transferência (entrada)', transfer_out: 'Transferência (saída)', opening: 'Saldo inicial', capital_in: 'Aporte', withdrawal: 'Retirada', loan_in: 'Empréstimo recebido', loan_out: 'Pagamento de empréstimo', cash_adjustment: 'Ajuste de caixa',
};
