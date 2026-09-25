-- Pedido do catálogo público gera aviso para a empresa (somente inserção).
grant insert on notifications to gct_public;
-- Lookup de catálogo por slug também precisa dos itens publicados.
create policy public_items_lookup on catalog_items for select to gct_public
  using (exists (select 1 from catalogs c where c.tenant_id = catalog_items.tenant_id and c.id = catalog_items.catalog_id and c.published));
