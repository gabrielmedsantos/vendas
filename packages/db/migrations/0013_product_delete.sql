-- Excluir produto cadastrado por engano (nunca usado). As chaves estrangeiras de estoque, compras,
-- vendas e catálogo continuam impedindo excluir produto com histórico. Alteração só de permissão.
grant delete on products, product_variants to gct_app;
