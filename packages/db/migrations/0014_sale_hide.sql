-- "Excluir venda": a venda é cancelada (estorno vinculado, nada é apagado) e marcada como excluída,
-- saindo das listas, do Início e do fluxo de caixa. O registro fica para auditoria (aba Excluídas).
-- Só acrescenta colunas: não remove nem altera dados existentes.
alter table sales add column deleted_at timestamptz;
alter table sales add column deleted_by text;
alter table sales add column deleted_reason text;
create index sales_deleted_idx on sales (tenant_id, deleted_at) where deleted_at is not null;
