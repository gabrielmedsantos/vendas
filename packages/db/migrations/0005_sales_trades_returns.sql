-- Vendas, trocas e devoluções.

create table sales (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id),
  number bigint,
  customer_id uuid,
  seller_user_id text,
  channel_id uuid,
  status text not null default 'draft'
    check (status in ('draft', 'confirmed', 'canceled', 'partially_returned', 'returned', 'reversed')),
  origin text not null default 'sale' check (origin in ('sale', 'trade', 'store')),
  sale_date date not null,
  valid_until date,
  confirmed_at timestamptz,
  subtotal_cents bigint not null default 0 check (subtotal_cents >= 0),
  discount_cents bigint not null default 0 check (discount_cents >= 0),
  shipping_cents bigint not null default 0 check (shipping_cents >= 0),
  total_cents bigint not null default 0 check (total_cents >= 0),
  cost_total_cents bigint not null default 0 check (cost_total_cents >= 0),
  fees_total_cents bigint not null default 0 check (fees_total_cents >= 0),
  channel_cost_cents bigint not null default 0 check (channel_cost_cents >= 0),
  channel_commission_bps integer not null default 0,
  returned_revenue_cents bigint not null default 0 check (returned_revenue_cents >= 0),
  returned_cost_cents bigint not null default 0 check (returned_cost_cents >= 0),
  trade_id uuid,
  discount_approved_by text,
  notes text,
  draft_payload jsonb not null default '{}'::jsonb,
  created_by text,
  canceled_at timestamptz,
  cancel_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  unique (tenant_id, id),
  check (returned_revenue_cents <= total_cents),
  check (returned_cost_cents <= cost_total_cents),
  foreign key (tenant_id, customer_id) references parties (tenant_id, id),
  foreign key (tenant_id, channel_id) references sales_channels (tenant_id, id)
);
create unique index sales_number_uq on sales (tenant_id, number) where number is not null;
create index sales_date_idx on sales (tenant_id, status, sale_date, id);
create index sales_customer_idx on sales (tenant_id, customer_id);
create trigger sales_touch before update on sales for each row execute function touch_updated_at();
select gct_tenant_table('sales', 'select, insert, update, delete');

create table sale_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id),
  sale_id uuid not null,
  position integer not null,
  variant_id uuid not null,
  product_kind text not null check (product_kind in ('physical', 'service')),
  unit_id uuid,
  description text not null,
  sku text not null,
  quantity integer not null check (quantity > 0),
  unit_price_cents bigint not null check (unit_price_cents >= 0),
  gross_cents bigint not null check (gross_cents >= 0),
  line_discount_cents bigint not null default 0 check (line_discount_cents >= 0),
  order_discount_share_cents bigint not null default 0 check (order_discount_share_cents >= 0),
  shipping_share_cents bigint not null default 0 check (shipping_share_cents >= 0),
  total_cents bigint not null check (total_cents >= 0),
  cost_cents bigint not null default 0 check (cost_cents >= 0),
  returned_qty integer not null default 0,
  returned_revenue_cents bigint not null default 0,
  returned_cost_cents bigint not null default 0,
  unique (tenant_id, id),
  check (returned_qty between 0 and quantity),
  check (returned_revenue_cents between 0 and total_cents),
  check (returned_cost_cents between 0 and cost_cents),
  foreign key (tenant_id, sale_id) references sales (tenant_id, id) on delete cascade,
  foreign key (tenant_id, variant_id) references product_variants (tenant_id, id),
  foreign key (tenant_id, unit_id) references inventory_units (tenant_id, id)
);
create index sale_items_sale_idx on sale_items (tenant_id, sale_id);
create index sale_items_variant_idx on sale_items (tenant_id, variant_id);
select gct_tenant_table('sale_items', 'select, insert, update, delete');

create table sale_cost_allocations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id),
  sale_item_id uuid not null,
  lot_id uuid not null,
  unit_id uuid,
  quantity integer not null check (quantity > 0),
  cost_cents bigint not null check (cost_cents >= 0),
  returned_qty integer not null default 0,
  returned_cost_cents bigint not null default 0,
  unique (tenant_id, id),
  check (returned_qty between 0 and quantity),
  check (returned_cost_cents between 0 and cost_cents),
  foreign key (tenant_id, sale_item_id) references sale_items (tenant_id, id),
  foreign key (tenant_id, lot_id) references inventory_lots (tenant_id, id),
  foreign key (tenant_id, unit_id) references inventory_units (tenant_id, id)
);
create index sale_cost_allocations_item_idx on sale_cost_allocations (tenant_id, sale_item_id);
create index sale_cost_allocations_lot_idx on sale_cost_allocations (tenant_id, lot_id);
select gct_tenant_table('sale_cost_allocations');

-- Snapshot da composição do pagamento na confirmação (taxas congeladas).
create table sale_payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id),
  sale_id uuid not null,
  position integer not null,
  kind text not null check (kind in ('cash', 'pix', 'debit', 'credit', 'bank_transfer', 'store_credit', 'installment', 'trade_offset')),
  payment_method_id uuid,
  method_name text not null,
  amount_cents bigint not null check (amount_cents > 0),
  installments integer not null default 1 check (installments between 1 and 48),
  fee_bps integer not null default 0 check (fee_bps between 0 and 10000),
  fee_cents bigint not null default 0 check (fee_cents >= 0),
  account_id uuid,
  first_due_date date,
  settled_now boolean not null default false,
  unique (tenant_id, id),
  foreign key (tenant_id, sale_id) references sales (tenant_id, id) on delete cascade,
  foreign key (tenant_id, payment_method_id) references payment_methods (tenant_id, id),
  foreign key (tenant_id, account_id) references financial_accounts (tenant_id, id)
);
select gct_tenant_table('sale_payments', 'select, insert, delete');

create table trades (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id),
  number bigint not null,
  party_id uuid not null,
  sale_id uuid not null,
  purchase_id uuid not null,
  sale_total_cents bigint not null check (sale_total_cents >= 0),
  purchase_total_cents bigint not null check (purchase_total_cents >= 0),
  offset_cents bigint not null check (offset_cents >= 0),
  difference_cents bigint not null,
  difference_policy text not null check (difference_policy in ('receive', 'pay', 'store_credit', 'none')),
  offset_id uuid,
  status text not null default 'confirmed' check (status in ('confirmed', 'reversed')),
  notes text,
  created_by text,
  confirmed_at timestamptz not null default now(),
  reversed_at timestamptz,
  reversal_reason text,
  unique (tenant_id, id),
  unique (tenant_id, number),
  check (difference_cents = sale_total_cents - purchase_total_cents),
  check (offset_cents = least(sale_total_cents, purchase_total_cents)),
  foreign key (tenant_id, party_id) references parties (tenant_id, id),
  foreign key (tenant_id, sale_id) references sales (tenant_id, id),
  foreign key (tenant_id, purchase_id) references purchases (tenant_id, id),
  foreign key (tenant_id, offset_id) references offsets (tenant_id, id)
);
create index trades_date_idx on trades (tenant_id, confirmed_at desc, id);
select gct_tenant_table('trades');

alter table sales add foreign key (tenant_id, trade_id) references trades (tenant_id, id);
alter table purchases add foreign key (tenant_id, trade_id) references trades (tenant_id, id);

create table trade_valuations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id),
  trade_id uuid not null,
  position integer not null,
  variant_id uuid not null,
  purchase_item_id uuid not null,
  unit_id uuid,
  agreed_cents bigint not null check (agreed_cents >= 0),
  estimated_extra_cost_cents bigint not null default 0 check (estimated_extra_cost_cents >= 0),
  suggested_price_cents bigint check (suggested_price_cents >= 0),
  condition text,
  identifiers jsonb not null default '[]'::jsonb,
  checklist jsonb not null default '{}'::jsonb,
  destination text not null default 'inspection' check (destination in ('inspection', 'available')),
  notes text,
  unique (tenant_id, id),
  foreign key (tenant_id, trade_id) references trades (tenant_id, id),
  foreign key (tenant_id, variant_id) references product_variants (tenant_id, id),
  foreign key (tenant_id, purchase_item_id) references purchase_items (tenant_id, id),
  foreign key (tenant_id, unit_id) references inventory_units (tenant_id, id)
);
select gct_tenant_table('trade_valuations', 'select, insert');

create table returns (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id),
  number bigint not null,
  sale_id uuid not null,
  kind text not null default 'return' check (kind in ('return', 'cancellation')),
  reason text not null,
  revenue_cents bigint not null check (revenue_cents >= 0),
  cost_cents bigint not null check (cost_cents >= 0),
  -- como o valor foi tratado: redução de saldo aberto, reembolso, crédito de loja
  reduced_balance_cents bigint not null default 0 check (reduced_balance_cents >= 0),
  refund_cents bigint not null default 0 check (refund_cents >= 0),
  store_credit_cents bigint not null default 0 check (store_credit_cents >= 0),
  refund_title_id uuid,
  created_by text,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, number),
  check (reduced_balance_cents + refund_cents + store_credit_cents <= revenue_cents),
  foreign key (tenant_id, sale_id) references sales (tenant_id, id),
  foreign key (tenant_id, refund_title_id) references financial_titles (tenant_id, id)
);
create index returns_date_idx on returns (tenant_id, created_at, id);
select gct_tenant_table('returns', 'select, insert');

create table return_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id),
  return_id uuid not null,
  sale_item_id uuid not null,
  quantity integer not null check (quantity > 0),
  revenue_cents bigint not null check (revenue_cents >= 0),
  cost_cents bigint not null check (cost_cents >= 0),
  unit_id uuid,
  lot_id uuid,
  unique (tenant_id, id),
  foreign key (tenant_id, return_id) references returns (tenant_id, id),
  foreign key (tenant_id, sale_item_id) references sale_items (tenant_id, id),
  foreign key (tenant_id, unit_id) references inventory_units (tenant_id, id),
  foreign key (tenant_id, lot_id) references inventory_lots (tenant_id, id)
);
select gct_tenant_table('return_items', 'select, insert');

create table warranty_cases (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id),
  number bigint not null,
  sale_id uuid not null,
  sale_item_id uuid,
  party_id uuid,
  status text not null default 'open' check (status in ('open', 'in_progress', 'resolved', 'rejected')),
  description text not null,
  resolution text,
  warranty_terms_snapshot text,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, number),
  foreign key (tenant_id, sale_id) references sales (tenant_id, id),
  foreign key (tenant_id, sale_item_id) references sale_items (tenant_id, id),
  foreign key (tenant_id, party_id) references parties (tenant_id, id)
);
create trigger warranty_cases_touch before update on warranty_cases for each row execute function touch_updated_at();
select gct_tenant_table('warranty_cases');
