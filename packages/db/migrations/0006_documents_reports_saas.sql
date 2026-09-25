-- Documentos, relatórios, catálogo público, pedidos, serviços e SaaS (planos/assinaturas/plataforma).

create table documents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id),
  doc_type text not null check (doc_type in ('sale_receipt', 'purchase_term', 'trade_summary', 'quote', 'return_receipt', 'warranty')),
  number bigint not null,
  source_type text not null,
  source_id uuid not null,
  template_version text not null,
  snapshot jsonb not null,
  sha256 text,
  storage_key text,
  status text not null default 'pending' check (status in ('pending', 'ready', 'failed')),
  attempts integer not null default 0,
  last_error text,
  created_by text,
  created_at timestamptz not null default now(),
  generated_at timestamptz,
  unique (tenant_id, id),
  unique (tenant_id, doc_type, number),
  unique (tenant_id, doc_type, source_id)
);
select gct_tenant_table('documents');

create table report_jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id),
  kind text not null,
  format text not null check (format in ('csv', 'pdf')),
  filters jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'processing', 'done', 'failed')),
  storage_key text,
  row_count integer,
  expires_at timestamptz,
  error text,
  requested_by text,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (tenant_id, id)
);
create index report_jobs_tenant_idx on report_jobs (tenant_id, created_at desc);
select gct_tenant_table('report_jobs');

create table daily_stock_snapshots (
  tenant_id uuid not null references tenants (id),
  snapshot_date date not null,
  variant_id uuid not null,
  physical_qty integer not null,
  cost_cents bigint not null,
  primary key (tenant_id, snapshot_date, variant_id),
  foreign key (tenant_id, variant_id) references product_variants (tenant_id, id)
);
select gct_tenant_table('daily_stock_snapshots', 'select, insert, update');

-- Catálogo público --------------------------------------------------------------
create table catalogs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{2,47}$'),
  title text not null,
  description text,
  theme jsonb not null default '{}'::jsonb,
  contact_whatsapp text,
  show_prices boolean not null default true,
  published boolean not null default false,
  published_at timestamptz,
  accept_orders boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id)
);
create trigger catalogs_touch before update on catalogs for each row execute function touch_updated_at();
select gct_tenant_table('catalogs', 'select, insert, update, delete');
create policy public_lookup on catalogs for select to gct_public using (published);

create table catalog_items (
  tenant_id uuid not null references tenants (id),
  catalog_id uuid not null,
  variant_id uuid not null,
  position integer not null default 0,
  primary key (tenant_id, catalog_id, variant_id),
  foreign key (tenant_id, catalog_id) references catalogs (tenant_id, id) on delete cascade,
  foreign key (tenant_id, variant_id) references product_variants (tenant_id, id)
);
select gct_tenant_table('catalog_items', 'select, insert, update, delete');

create table catalog_events (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references tenants (id),
  catalog_id uuid not null,
  kind text not null check (kind in ('view', 'product_view', 'contact_click', 'order_request')),
  variant_id uuid,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, catalog_id) references catalogs (tenant_id, id) on delete cascade
);
create index catalog_events_idx on catalog_events (tenant_id, catalog_id, created_at);
select gct_tenant_table('catalog_events', 'select, insert');

create table public_orders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id),
  catalog_id uuid not null,
  number bigint not null,
  contact_name text not null check (length(contact_name) between 2 and 120),
  contact_phone text not null check (length(contact_phone) between 8 and 30),
  notes text,
  status text not null default 'pending' check (status in ('pending', 'reserved', 'converted', 'canceled', 'expired')),
  total_cents bigint not null check (total_cents >= 0),
  reservation_expires_at timestamptz,
  sale_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, number),
  foreign key (tenant_id, catalog_id) references catalogs (tenant_id, id),
  foreign key (tenant_id, sale_id) references sales (tenant_id, id)
);
create trigger public_orders_touch before update on public_orders for each row execute function touch_updated_at();
select gct_tenant_table('public_orders');

create table public_order_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id),
  order_id uuid not null,
  variant_id uuid not null,
  description text not null,
  quantity integer not null check (quantity between 1 and 999),
  unit_price_cents bigint not null check (unit_price_cents >= 0),
  unique (tenant_id, id),
  foreign key (tenant_id, order_id) references public_orders (tenant_id, id) on delete cascade,
  foreign key (tenant_id, variant_id) references product_variants (tenant_id, id)
);
select gct_tenant_table('public_order_items', 'select, insert');

-- Grants mínimos do papel público: somente colunas publicáveis.
grant select (id, tenant_id, slug, title, description, theme, contact_whatsapp, show_prices, published, accept_orders) on catalogs to gct_public;
grant select on catalog_items to gct_public;
grant select (id, tenant_id, name, description, brand, category_id, status, kind) on products to gct_public;
grant select (id, tenant_id, product_id, label, attributes, retail_price_cents, status) on product_variants to gct_public;
grant select (id, tenant_id, name) on categories to gct_public;
grant select (tenant_id, product_id, attachment_id, position) on product_images to gct_public;
grant select (id, tenant_id, storage_key, mime, is_public) on attachments to gct_public;
grant select (tenant_id, variant_id, on_hand, reserved) on stock_balances to gct_public;
grant insert on catalog_events to gct_public;
grant insert, select on public_orders, public_order_items to gct_public;
grant select, update on document_sequences to gct_public;
grant insert on document_sequences to gct_public;

-- Barreira restritiva: papel público só enxerga itens de catálogos publicados.
create policy public_catalog_only on product_variants as restrictive for select to gct_public
  using (exists (select 1 from catalog_items ci join catalogs c on c.tenant_id = ci.tenant_id and c.id = ci.catalog_id
                 where ci.tenant_id = product_variants.tenant_id and ci.variant_id = product_variants.id and c.published));
create policy public_catalog_only on products as restrictive for select to gct_public
  using (exists (select 1 from product_variants v
                 join catalog_items ci on ci.tenant_id = v.tenant_id and ci.variant_id = v.id
                 join catalogs c on c.tenant_id = ci.tenant_id and c.id = ci.catalog_id
                 where v.tenant_id = products.tenant_id and v.product_id = products.id and c.published));
create policy public_images_only on attachments as restrictive for select to gct_public using (is_public);

-- Serviços simples ----------------------------------------------------------------
create table service_orders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id),
  number bigint not null,
  party_id uuid,
  sale_id uuid,
  title text not null,
  description text,
  status text not null default 'open' check (status in ('open', 'in_progress', 'done', 'delivered', 'canceled')),
  price_cents bigint not null default 0 check (price_cents >= 0),
  due_date date,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, number),
  foreign key (tenant_id, party_id) references parties (tenant_id, id),
  foreign key (tenant_id, sale_id) references sales (tenant_id, id)
);
create trigger service_orders_touch before update on service_orders for each row execute function touch_updated_at();
select gct_tenant_table('service_orders');

-- SaaS: planos globais, assinaturas por tenant, eventos de cobrança -----------------
create table plans (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z0-9_-]{2,32}$'),
  name text not null,
  description text,
  active boolean not null default true,
  public boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table plan_versions (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references plans (id),
  version integer not null,
  price_monthly_cents bigint not null check (price_monthly_cents >= 0),
  price_yearly_cents bigint check (price_yearly_cents >= 0),
  currency char(3) not null default 'BRL',
  trial_days integer not null default 0 check (trial_days between 0 and 90),
  -- {"users": 3, "products": 500, "storage_mb": 500, "monthly_sales": 1000}; null = ilimitado
  limits jsonb not null default '{}'::jsonb,
  features text[] not null default '{}',
  valid_from timestamptz not null default now(),
  valid_to timestamptz,
  created_at timestamptz not null default now(),
  unique (plan_id, version)
);
grant select on plans, plan_versions to gct_app, gct_public;
grant select, insert, update on plans, plan_versions to gct_platform;

create table subscriptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null unique references tenants (id),
  plan_version_id uuid not null references plan_versions (id),
  status text not null check (status in ('trialing', 'active', 'past_due', 'suspended', 'canceled')),
  billing_interval text not null default 'monthly' check (billing_interval in ('monthly', 'yearly')),
  trial_ends_at timestamptz,
  current_period_start timestamptz not null,
  current_period_end timestamptz not null,
  grace_days integer not null default 7,
  cancel_at_period_end boolean not null default false,
  canceled_at timestamptz,
  provider text not null default 'manual',
  provider_customer_id text,
  provider_subscription_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger subscriptions_touch before update on subscriptions for each row execute function touch_updated_at();
alter table subscriptions enable row level security;
alter table subscriptions force row level security;
create policy tenant_read on subscriptions for select to gct_app using (tenant_id = (select app_tenant_id()));
create policy tenant_cancel on subscriptions for update to gct_app
  using (tenant_id = (select app_tenant_id())) with check (tenant_id = (select app_tenant_id()));
create policy platform_all on subscriptions to gct_platform using (true) with check (true);
grant select on subscriptions to gct_app;
grant update (cancel_at_period_end) on subscriptions to gct_app;
grant select, insert, update on subscriptions to gct_platform;

create table subscription_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id),
  subscription_id uuid not null references subscriptions (id),
  from_status text,
  to_status text not null,
  reason text not null,
  actor text,
  idempotency_key text unique,
  created_at timestamptz not null default now()
);
alter table subscription_events enable row level security;
alter table subscription_events force row level security;
create policy tenant_read on subscription_events for select to gct_app using (tenant_id = (select app_tenant_id()));
create policy platform_all on subscription_events to gct_platform using (true) with check (true);
grant select on subscription_events to gct_app;
grant select, insert on subscription_events to gct_platform;

create table billing_invoices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id),
  subscription_id uuid not null references subscriptions (id),
  period_start date not null,
  period_end date not null,
  amount_cents bigint not null check (amount_cents >= 0),
  currency char(3) not null default 'BRL',
  status text not null default 'open' check (status in ('open', 'paid', 'void', 'refunded')),
  due_date date not null,
  paid_at timestamptz,
  provider text not null default 'manual',
  provider_invoice_id text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, period_start)
);
create trigger billing_invoices_touch before update on billing_invoices for each row execute function touch_updated_at();
alter table billing_invoices enable row level security;
alter table billing_invoices force row level security;
create policy tenant_read on billing_invoices for select to gct_app using (tenant_id = (select app_tenant_id()));
create policy platform_all on billing_invoices to gct_platform using (true) with check (true);
grant select on billing_invoices to gct_app;
grant select, insert, update on billing_invoices to gct_platform;

create table webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  external_id text not null,
  event_type text not null,
  payload jsonb not null,
  signature_valid boolean not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  result text,
  unique (provider, external_id)
);
grant select, insert, update on webhook_events to gct_platform;

create table trial_claims (
  user_id text primary key references "user" ("id"),
  tenant_id uuid not null references tenants (id),
  created_at timestamptz not null default now()
);
grant select, insert on trial_claims to gct_platform;

create table platform_admins (
  user_id text primary key references "user" ("id"),
  role text not null default 'admin' check (role in ('admin', 'support')),
  created_at timestamptz not null default now()
);
grant select on platform_admins to gct_platform;

create table platform_audit (
  id bigint generated always as identity primary key,
  admin_user_id text not null,
  action text not null,
  tenant_id uuid,
  reason text not null,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
grant select, insert on platform_audit to gct_platform;

create table help_articles (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  category text not null check (category in ('primeiros-passos', 'vendas', 'trocas', 'estoque', 'financeiro', 'seguranca')),
  title text not null,
  summary text not null,
  body text not null,
  published boolean not null default false,
  reading_minutes integer not null default 3,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select on help_articles to gct_app;
grant select, insert, update on help_articles to gct_platform;

create table referral_codes (
  tenant_id uuid primary key references tenants (id),
  code text not null unique,
  created_at timestamptz not null default now()
);
create table referrals (
  id uuid primary key default gen_random_uuid(),
  referrer_tenant_id uuid not null references tenants (id),
  referred_tenant_id uuid not null unique references tenants (id),
  status text not null default 'pending' check (status in ('pending', 'qualified', 'rewarded', 'rejected')),
  created_at timestamptz not null default now()
);
alter table referral_codes enable row level security;
alter table referral_codes force row level security;
create policy tenant_read on referral_codes for select to gct_app using (tenant_id = (select app_tenant_id()));
create policy platform_all on referral_codes to gct_platform using (true) with check (true);
grant select on referral_codes to gct_app;
grant select, insert on referral_codes to gct_platform;
alter table referrals enable row level security;
alter table referrals force row level security;
create policy tenant_read on referrals for select to gct_app using (referrer_tenant_id = (select app_tenant_id()));
create policy platform_all on referrals to gct_platform using (true) with check (true);
grant select on referrals to gct_app;
grant select, insert, update on referrals to gct_platform;
