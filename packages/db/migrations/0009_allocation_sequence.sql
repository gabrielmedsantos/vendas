-- Ordem determinística das alocações de custo de uma venda (a devolução
-- reverte da última alocação para a primeira). O id é UUID aleatório e não
-- serve para ordenar. Coluna aditiva; não altera dados existentes.
alter table sale_cost_allocations add column seq bigint generated always as identity;
create index sale_cost_allocations_item_seq on sale_cost_allocations (sale_item_id, seq);
