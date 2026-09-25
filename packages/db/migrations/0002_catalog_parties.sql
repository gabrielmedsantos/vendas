-- Cadastros: categorias, produtos, variantes, arquivos, pessoas, canais e formas de pagamento.

create table attachments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id),
  storage_key text not null,
  original_name text,
  mime text not null check (mime in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'text/csv')),
  size_bytes bigint not null check (size_bytes > 0),
  sha256 text not null,
  width integer,
  height integer,
  owner_type text not null,
  owner_id uuid,
  is_public boolean not null default false,
  created_by text,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (storage_key)
);
create index attachments_owner_idx on attachments (tenant_id, owner_type, owner_id);
select gct_tenant_table('attachments', 'select, insert, update, delete');

create table categories (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id),
  name text not null check (length(name) between 1 and 80),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id)
);
create unique index categories_name_uq on categories (tenant_id, lower(name)) where archived_at is null;
create trigger categories_touch before update on categories for each row execute function touch_updated_at();
select gct_tenant_table('categories');

create table products (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id),
  kind text not null default 'physical' check (kind in ('physical', 'service')),
  tracking text not null default 'quantity' check (tracking in ('quantity', 'serialized', 'none')),
  name text not null check (length(name) between 1 and 160),
  description text,
  brand text,
  category_id uuid,
  status text not null default 'active' check (status in ('active', 'inactive', 'archived')),
  condition_default text check (condition_default in ('new', 'used', 'refurbished')),
  warranty_days integer not null default 0 check (warranty_days >= 0),
  identifier_kinds text[] not null default '{}',
  search_text text not null default '',
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  unique (tenant_id, id),
  foreign key (tenant_id, category_id) references categories (tenant_id, id),
  check ((kind = 'service') = (tracking = 'none'))
);
create index products_tenant_idx on products (tenant_id, status, name, id);
create index products_category_idx on products (tenant_id, category_id);
create trigger products_touch before update on products for each row execute function touch_updated_at();
select gct_tenant_table('products');

create table product_variants (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id),
  product_id uuid not null,
  sku text not null check (length(sku) between 1 and 64),
  barcode text,
  attributes jsonb not null default '{}'::jsonb,
  label text not null default '',
  retail_price_cents bigint not null default 0 check (retail_price_cents >= 0),
  wholesale_price_cents bigint check (wholesale_price_cents >= 0),
  wholesale_min_qty integer check (wholesale_min_qty > 0),
  suggested_price_cents bigint check (suggested_price_cents >= 0),
  min_stock integer not null default 0 check (min_stock >= 0),
  is_default boolean not null default true,
  status text not null default 'active' check (status in ('active', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, product_id) references products (tenant_id, id)
);
create unique index product_variants_sku_uq on product_variants (tenant_id, lower(sku));
create unique index product_variants_barcode_uq on product_variants (tenant_id, barcode) where barcode is not null;
create index product_variants_product_idx on product_variants (tenant_id, product_id);
create trigger product_variants_touch before update on product_variants for each row execute function touch_updated_at();
select gct_tenant_table('product_variants');

create table product_images (
  tenant_id uuid not null references tenants (id),
  product_id uuid not null,
  attachment_id uuid not null,
  position integer not null default 0,
  primary key (tenant_id, product_id, attachment_id),
  foreign key (tenant_id, product_id) references products (tenant_id, id),
  foreign key (tenant_id, attachment_id) references attachments (tenant_id, id) on delete cascade
);
select gct_tenant_table('product_images', 'select, insert, update, delete');

create table parties (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id),
  person_type text not null default 'PF' check (person_type in ('PF', 'PJ')),
  name text not null check (length(name) between 1 and 160),
  trade_name text,
  document text,
  document_normalized text,
  email text,
  phone text,
  phone_normalized text,
  address jsonb not null default '{}'::jsonb,
  city text,
  state text,
  is_customer boolean not null default false,
  is_supplier boolean not null default false,
  status text not null default 'active' check (status in ('active', 'archived')),
  notes text,
  search_text text not null default '',
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  check (is_customer or is_supplier)
);
create unique index parties_document_uq on parties (tenant_id, document_normalized) where document_normalized is not null;
create index parties_tenant_idx on parties (tenant_id, status, name, id);
create index parties_phone_idx on parties (tenant_id, phone_normalized);
create trigger parties_touch before update on parties for each row execute function touch_updated_at();
select gct_tenant_table('parties');

create table sales_channels (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id),
  name text not null,
  commission_bps integer not null default 0 check (commission_bps between 0 and 10000),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, id)
);
create unique index sales_channels_name_uq on sales_channels (tenant_id, lower(name));
select gct_tenant_table('sales_channels');

create table financial_accounts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id),
  name text not null,
  kind text not null check (kind in ('cash', 'bank', 'card_transit', 'other')),
  status text not null default 'active' check (status in ('active', 'archived')),
  created_at timestamptz not null default now(),
  unique (tenant_id, id)
);
create unique index financial_accounts_name_uq on financial_accounts (tenant_id, lower(name));
select gct_tenant_table('financial_accounts');

create table payment_methods (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id),
  name text not null,
  kind text not null check (kind in ('cash', 'pix', 'debit', 'credit', 'bank_transfer', 'store_credit', 'installment')),
  fee_bps integer not null default 0 check (fee_bps between 0 and 10000),
  -- taxa por número de parcelas: {"2": 399, "3": 459}
  installment_fee_bps jsonb not null default '{}'::jsonb,
  settlement_days integer not null default 0 check (settlement_days >= 0),
  account_id uuid,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, account_id) references financial_accounts (tenant_id, id)
);
create unique index payment_methods_name_uq on payment_methods (tenant_id, lower(name));
select gct_tenant_table('payment_methods');
