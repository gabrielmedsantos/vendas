-- Movimento de caixa ligado a venda excluída (o recebimento da venda e o reembolso do estorno).
-- Usado para tirar esses pares das listas e dos totais de entradas/saídas; o saldo não muda
-- porque o par se anula. SECURITY INVOKER (padrão): respeita o RLS de cada empresa.
create function movement_of_deleted_sale(p_origin_type text, p_origin_id uuid) returns boolean
language sql stable as $$
  select p_origin_type in ('settlement', 'settlement_reversal') and exists (
    select 1
    from settlement_allocations sa
    join financial_titles t on t.id = sa.title_id
    left join returns r on t.origin_type = 'refund' and r.id = t.origin_id
    join sales s on s.id = case when t.origin_type = 'sale' then t.origin_id when t.origin_type = 'refund' then r.sale_id end
    where sa.settlement_id = p_origin_id and s.deleted_at is not null
  )
$$;
grant execute on function movement_of_deleted_sale(text, uuid) to gct_app;
