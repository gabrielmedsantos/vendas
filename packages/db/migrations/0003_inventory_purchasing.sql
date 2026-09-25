-- Estoque (saldos, lotes FIFO, unidades serializadas, livro de movimentos) e compras.

create table locations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id),
  name text not null,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  unique (tenant_id, id)
);
create unique index locations_default_uq on locations (tenant_id) where is_default;
select gct_tenant_table('locations');

-- Saldo materializado. on_hand = físico vendável (inclui reservado);
-- inspection = físico em inspeção/quarentena (não disponível).
create table stock_balances (
  tenant_id uuid not null references tenants (id),
  variant_id uuid not null,
  location_id uuid not null,
  on_hand integer not null default 0 check (on_hand >= 0),
  reserved integer not null default 0 check (reserved >= 0),
  inspection integer not null default 0 check (inspection >= 0),
  version bigint not null default 0,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, variant_id, location_id),
  check (reserved <= on_hand),
  foreign key (tenant_id, variant_id) references product_variants (tenant_id, id),
  foreign key (tenant_id, location_id) references locations (tenant_id, id)
);
select gct_tenant_table('stock_balances');

create table inventory_units (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id),
  variant_id uuid not null,
  location_id uuid not null,
  internal_code text not null,
  status text not null check (status in ('inspection', 'available', 'reserved', 'sold', 'repair', 'lost', 'returned_to_supplier')),
  condition text check (condition in ('new', 'used', 'refurbished', 'defective')),
  battery_health_pct integer check (battery_health_pct between 0 and 100),
  accessories text,
  defects text,
  checklist jsonb not null default '{}'::jsonb,
  notes text,
  current_lot_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  unique (tenant_id, id),
  unique (tenant_id, internal_code),
  foreign key (tenant_id, variant_id) references product_variants (tenant_id, id),
  foreign key (tenant_id, location_id) references locations (tenant_id, id)
);
create index inventory_units_variant_idx on inventory_units (tenant_id, variant_id, status);
create trigger inventory_units_touch before update on inventory_units for each row execute function touch_updated_at();
select gct_tenant_table('inventory_units');

create table unit_identifiers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id),
  unit_id uuid not null,
  kind text not null check (kind in ('imei1', 'imei2', 'serial', 'other')),
  value text not null,
  normalized text not null check (length(normalized) between 1 and 64),
  created_at timestamptz not null default now(),
  unique (tenant_id, kind, normalized),
  unique (tenant_id, unit_id, kind),
  foreign key (tenant_id, unit_id) references inventory_units (tenant_id, id)
);
create index unit_identifiers_value_idx on unit_identifiers (tenant_id, normalized);
select gct_tenant_table('unit_identifiers', 'select, insert');

-- Lote = ciclo de entrada (compra, troca, devolução, ajuste). FIFO por received_at, id.
create table inventory_lots (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id),
  variant_id uuid not null,
  location_id uuid not null,
  unit_id uuid,
  source_type text not null check (source_type in ('purchase_receipt', 'trade_in', 'sale_return', 'adjustment', 'opening')),
  source_id uuid,
  status text not null default 'available' check (status in ('available', 'inspection')),
  received_at timestamptz not null default now(),
  qty_received integer not null check (qty_received > 0),
  qty_remaining integer not null,
  cost_received_cents bigint not null check (cost_received_cents >= 0),
  cost_remaining_cents bigint not null check (cost_remaining_cents >= 0),
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  check (qty_remaining between 0 and qty_received),
  check (qty_remaining > 0 or cost_remaining_cents = 0),
  check (unit_id is null or qty_received = 1),
  foreign key (tenant_id, variant_id) references product_variants (tenant_id, id),
  foreign key (tenant_id, location_id) references locations (tenant_id, id),
  foreign key (tenant_id, unit_id) references inventory_units (tenant_id, id)
);
create index inventory_lots_fifo_idx on inventory_lots (tenant_id, variant_id, location_id, received_at, id)
  where qty_remaining > 0 and status = 'available';
select gct_tenant_table('inventory_lots');

alter table inventory_units add foreign key (tenant_id, current_lot_id) references inventory_lots (tenant_id, id);

-- Livro de movimentos: append-only (runtime não tem UPDATE/DELETE).
create table stock_movements (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id),
  variant_id uuid not null,
  location_id uuid not null,
  lot_id uuid,
  unit_id uuid,
  direction text not null check (direction in ('in', 'out')),
  kind text not null check (kind in (
    'purchase_receipt', 'sale', 'sale_return', 'trade_in', 'trade_out',
    'adjustment_in', 'adjustment_out', 'loss', 'supplier_return',
    'inspection_release', 'inspection_hold', 'reversal')),
  -- 'available' ou 'inspection': qual saldo foi afetado
  bucket text not null default 'available' check (bucket in ('available', 'inspection')),
  quantity integer not null check (quantity > 0),
  cost_cents bigint not null default 0 check (cost_cents >= 0),
  physical_after integer not null check (physical_after >= 0),
  source_type text not null,
  source_id uuid,
  reversal_of uuid,
  reason text,
  created_by text,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, variant_id) references product_variants (tenant_id, id),
  foreign key (tenant_id, location_id) references locations (tenant_id, id),
  foreign key (tenant_id, lot_id) references inventory_lots (tenant_id, id),
  foreign key (tenant_id, unit_id) references inventory_units (tenant_id, id),
  foreign key (tenant_id, reversal_of) references stock_movements (tenant_id, id)
);
create unique index stock_movements_reversal_uq on stock_movements (tenant_id, reversal_of) where reversal_of is not null;
create index stock_movements_variant_idx on stock_movements (tenant_id, variant_id, created_at desc, id);
create index stock_movements_source_idx on stock_movements (tenant_id, source_type, source_id);
select gct_tenant_table('stock_movements', 'select, insert');

create table reservations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id),
  source_type text not null,
  source_id uuid not null,
  variant_id uuid not null,
  location_id uuid not null,
  unit_id uuid,
  quantity integer not null check (quantity > 0),
  status text not null default 'active' check (status in ('active', 'released', 'consumed', 'expired')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, variant_id) references product_variants (tenant_id, id),
  foreign key (tenant_id, location_id) references locations (tenant_id, id),
  foreign key (tenant_id, unit_id) references inventory_units (tenant_id, id)
);
create unique index reservations_unit_active_uq on reservations (tenant_id, unit_id) where status = 'active' and unit_id is not null;
create index reservations_expiry_idx on reservations (expires_at) where status = 'active';
create trigger reservations_touch before update on reservations for each row execute function touch_updated_at();
select gct_tenant_table('reservations');
create policy platform_expire on reservations to gct_platform using (true) with check (true);
grant select, update on reservations to gct_platform;

-- Compras ---------------------------------------------------------------------
create table purchases (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id),
  number bigint,
  supplier_id uuid not null,
  status text not null default 'draft' check (status in ('draft', 'approved', 'partially_received', 'received', 'canceled')),
  purchase_date date not null,
  items_cents bigint not null default 0 check (items_cents >= 0),
  discount_cents bigint not null default 0 check (discount_cents >= 0),
  extra_costs_cents bigint not null default 0 check (extra_costs_cents >= 0),
  total_cents bigint not null default 0 check (total_cents >= 0),
  payment_terms jsonb not null default '{}'::jsonb,
  notes text,
  origin text not null default 'purchase' check (origin in ('purchase', 'trade')),
  trade_id uuid,
  created_by text,
  approved_at timestamptz,
  canceled_at timestamptz,
  cancel_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  unique (tenant_id, id),
  foreign key (tenant_id, supplier_id) references parties (tenant_id, id)
);
create unique index purchases_number_uq on purchases (tenant_id, number) where number is not null;
create index purchases_tenant_idx on purchases (tenant_id, created_at desc, id);
create trigger purchases_touch before update on purchases for each row execute function touch_updated_at();
select gct_tenant_table('purchases', 'select, insert, update, delete');

create table purchase_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id),
  purchase_id uuid not null,
  position integer not null,
  variant_id uuid not null,
  description text not null,
  quantity integer not null check (quantity > 0),
  unit_cost_cents bigint not null check (unit_cost_cents >= 0),
  discount_cents bigint not null default 0 check (discount_cents >= 0),
  discount_share_cents bigint not null default 0 check (discount_share_cents >= 0),
  extra_share_cents bigint not null default 0 check (extra_share_cents >= 0),
  landed_cost_cents bigint not null default 0 check (landed_cost_cents >= 0),
  received_qty integer not null default 0,
  received_cost_cents bigint not null default 0,
  -- serializado: especificação de cada unidade (identificadores, condição...)
  unit_specs jsonb not null default '[]'::jsonb,
  unique (tenant_id, id),
  check (received_qty between 0 and quantity),
  check (received_cost_cents between 0 and landed_cost_cents),
  foreign key (tenant_id, purchase_id) references purchases (tenant_id, id) on delete cascade,
  foreign key (tenant_id, variant_id) references product_variants (tenant_id, id)
);
create index purchase_items_purchase_idx on purchase_items (tenant_id, purchase_id);
select gct_tenant_table('purchase_items', 'select, insert, update, delete');

create table goods_receipts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id),
  purchase_id uuid not null,
  received_at timestamptz not null default now(),
  notes text,
  created_by text,
  unique (tenant_id, id),
  foreign key (tenant_id, purchase_id) references purchases (tenant_id, id)
);
select gct_tenant_table('goods_receipts', 'select, insert');

create table goods_receipt_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id),
  receipt_id uuid not null,
  purchase_item_id uuid not null,
  quantity integer not null check (quantity > 0),
  cost_cents bigint not null check (cost_cents >= 0),
  lot_id uuid,
  unit_id uuid,
  destination text not null default 'available' check (destination in ('available', 'inspection')),
  unique (tenant_id, id),
  foreign key (tenant_id, receipt_id) references goods_receipts (tenant_id, id),
  foreign key (tenant_id, purchase_item_id) references purchase_items (tenant_id, id),
  foreign key (tenant_id, lot_id) references inventory_lots (tenant_id, id),
  foreign key (tenant_id, unit_id) references inventory_units (tenant_id, id)
);
select gct_tenant_table('goods_receipt_items', 'select, insert');

-- Custos adicionais realizados (ex.: reparo antes da revenda) e ajustes de custo.
create table acquisition_costs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id),
  lot_id uuid not null,
  description text not null,
  amount_cents bigint not null check (amount_cents > 0),
  to_inventory_cents bigint not null check (to_inventory_cents >= 0),
  to_cogs_cents bigint not null check (to_cogs_cents >= 0),
  party_id uuid,
  title_id uuid,
  occurred_on date not null,
  created_by text,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  check (to_inventory_cents + to_cogs_cents = amount_cents),
  foreign key (tenant_id, lot_id) references inventory_lots (tenant_id, id),
  foreign key (tenant_id, party_id) references parties (tenant_id, id)
);
select gct_tenant_table('acquisition_costs', 'select, insert');

-- Inventário físico: contagem revisável antes de confirmar ajustes.
create table inventory_counts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id),
  location_id uuid not null,
  status text not null default 'draft' check (status in ('draft', 'confirmed', 'canceled')),
  notes text,
  created_by text,
  confirmed_by text,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, location_id) references locations (tenant_id, id)
);
select gct_tenant_table('inventory_counts');

create table inventory_count_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id),
  count_id uuid not null,
  variant_id uuid not null,
  expected_qty integer not null,
  counted_qty integer not null check (counted_qty >= 0),
  unique (tenant_id, id),
  unique (tenant_id, count_id, variant_id),
  foreign key (tenant_id, count_id) references inventory_counts (tenant_id, id) on delete cascade,
  foreign key (tenant_id, variant_id) references product_variants (tenant_id, id)
);
select gct_tenant_table('inventory_count_items', 'select, insert, update, delete');
