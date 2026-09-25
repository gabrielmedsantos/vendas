-- Financeiro: títulos, liquidações, compensações, caixa, crédito de loja, despesas e períodos.

create table financial_titles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id),
  direction text not null check (direction in ('receivable', 'payable')),
  party_id uuid,
  origin_type text not null check (origin_type in ('sale', 'purchase', 'expense', 'refund', 'trade', 'acquisition_cost', 'manual')),
  origin_id uuid,
  description text not null,
  category text,
  competence_date date not null,
  due_date date not null,
  installment_number integer not null default 1 check (installment_number > 0),
  installment_count integer not null default 1 check (installment_count > 0),
  original_cents bigint not null check (original_cents > 0),
  balance_cents bigint not null,
  status text not null default 'open' check (status in ('open', 'partially_settled', 'settled', 'canceled')),
  canceled_at timestamptz,
  cancel_reason text,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  check (balance_cents between 0 and original_cents),
  foreign key (tenant_id, party_id) references parties (tenant_id, id)
);
create index financial_titles_due_idx on financial_titles (tenant_id, direction, status, due_date);
create index financial_titles_origin_idx on financial_titles (tenant_id, origin_type, origin_id);
create index financial_titles_party_idx on financial_titles (tenant_id, party_id);
create trigger financial_titles_touch before update on financial_titles for each row execute function touch_updated_at();
select gct_tenant_table('financial_titles');

-- Liquidação real (dinheiro/banco). Imutável; estorno = nova liquidação com reversal_of.
create table settlements (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id),
  direction text not null check (direction in ('in', 'out')),
  method text not null check (method in ('cash', 'pix', 'debit', 'credit', 'bank_transfer', 'boleto', 'other')),
  account_id uuid not null,
  party_id uuid,
  settled_on date not null,
  gross_cents bigint not null check (gross_cents > 0),
  fee_cents bigint not null default 0 check (fee_cents >= 0),
  net_cents bigint not null check (net_cents >= 0),
  reference text,
  notes text,
  reversal_of uuid,
  reversal_reason text,
  created_by text,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  check (gross_cents = net_cents + fee_cents),
  foreign key (tenant_id, account_id) references financial_accounts (tenant_id, id),
  foreign key (tenant_id, party_id) references parties (tenant_id, id),
  foreign key (tenant_id, reversal_of) references settlements (tenant_id, id)
);
create unique index settlements_reversal_uq on settlements (tenant_id, reversal_of) where reversal_of is not null;
create index settlements_date_idx on settlements (tenant_id, settled_on, id);
select gct_tenant_table('settlements', 'select, insert');

create table settlement_allocations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id),
  settlement_id uuid not null,
  title_id uuid not null,
  amount_cents bigint not null check (amount_cents > 0),
  unique (tenant_id, id),
  unique (tenant_id, settlement_id, title_id),
  foreign key (tenant_id, settlement_id) references settlements (tenant_id, id),
  foreign key (tenant_id, title_id) references financial_titles (tenant_id, id)
);
create index settlement_allocations_title_idx on settlement_allocations (tenant_id, title_id);
select gct_tenant_table('settlement_allocations', 'select, insert');

-- Ajustes de saldo sem dinheiro (redução por devolução, cancelamento, perdão autorizado).
create table title_adjustments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id),
  title_id uuid not null,
  kind text not null check (kind in ('return_reduction', 'cancellation', 'write_off', 'reversal')),
  -- positivo reduz o saldo; negativo (reversal) restaura
  amount_cents bigint not null check (amount_cents <> 0),
  origin_type text not null,
  origin_id uuid,
  reason text,
  created_by text,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, title_id) references financial_titles (tenant_id, id)
);
create index title_adjustments_title_idx on title_adjustments (tenant_id, title_id);
select gct_tenant_table('title_adjustments', 'select, insert');

-- Compensação não monetária entre títulos opostos da mesma pessoa (troca).
create table offsets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id),
  party_id uuid not null,
  amount_cents bigint not null check (amount_cents > 0),
  origin_type text not null,
  origin_id uuid,
  reversal_of uuid,
  created_by text,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, party_id) references parties (tenant_id, id),
  foreign key (tenant_id, reversal_of) references offsets (tenant_id, id)
);
create unique index offsets_reversal_uq on offsets (tenant_id, reversal_of) where reversal_of is not null;
select gct_tenant_table('offsets', 'select, insert');

create table offset_allocations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id),
  offset_id uuid not null,
  title_id uuid not null,
  amount_cents bigint not null check (amount_cents > 0),
  unique (tenant_id, id),
  unique (tenant_id, offset_id, title_id),
  foreign key (tenant_id, offset_id) references offsets (tenant_id, id),
  foreign key (tenant_id, title_id) references financial_titles (tenant_id, id)
);
select gct_tenant_table('offset_allocations', 'select, insert');

-- Compensação exige a mesma pessoa no título e no offset.
create or replace function offset_allocation_same_party() returns trigger language plpgsql as $$
declare
  o_party uuid;
  t_party uuid;
begin
  select party_id into o_party from offsets where tenant_id = new.tenant_id and id = new.offset_id;
  select party_id into t_party from financial_titles where tenant_id = new.tenant_id and id = new.title_id;
  if o_party is distinct from t_party then
    raise exception 'Compensação exige a mesma pessoa no título' using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger offset_allocations_party before insert on offset_allocations
  for each row execute function offset_allocation_same_party();

-- Movimento de caixa/banco: único por origem/tipo/conta. Append-only.
create table cash_movements (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id),
  account_id uuid not null,
  direction text not null check (direction in ('in', 'out')),
  amount_cents bigint not null check (amount_cents > 0),
  kind text not null check (kind in (
    'settlement', 'transfer_in', 'transfer_out', 'opening', 'capital_in', 'withdrawal',
    'loan_in', 'loan_out', 'cash_adjustment', 'reversal')),
  origin_type text not null,
  origin_id uuid,
  occurred_on date not null,
  description text,
  reversal_of uuid,
  created_by text,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, account_id) references financial_accounts (tenant_id, id),
  foreign key (tenant_id, reversal_of) references cash_movements (tenant_id, id)
);
create unique index cash_movements_origin_uq on cash_movements (tenant_id, origin_type, origin_id, account_id, kind)
  where origin_id is not null;
create unique index cash_movements_reversal_uq on cash_movements (tenant_id, reversal_of) where reversal_of is not null;
create index cash_movements_account_idx on cash_movements (tenant_id, account_id, occurred_on, id);
select gct_tenant_table('cash_movements', 'select, insert');

create table account_transfers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id),
  from_account_id uuid not null,
  to_account_id uuid not null,
  amount_cents bigint not null check (amount_cents > 0),
  occurred_on date not null,
  description text,
  created_by text,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  check (from_account_id <> to_account_id),
  foreign key (tenant_id, from_account_id) references financial_accounts (tenant_id, id),
  foreign key (tenant_id, to_account_id) references financial_accounts (tenant_id, id)
);
select gct_tenant_table('account_transfers', 'select, insert');

-- Crédito de loja: passivo comercial. Saldo materializado nunca negativo.
create table store_credit_balances (
  tenant_id uuid not null references tenants (id),
  party_id uuid not null,
  balance_cents bigint not null default 0 check (balance_cents >= 0),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, party_id),
  foreign key (tenant_id, party_id) references parties (tenant_id, id)
);
select gct_tenant_table('store_credit_balances');

create table store_credit_entries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id),
  party_id uuid not null,
  kind text not null check (kind in ('issue', 'use', 'reversal', 'adjustment')),
  -- positivo aumenta o crédito; negativo consome
  amount_cents bigint not null check (amount_cents <> 0),
  balance_after_cents bigint not null check (balance_after_cents >= 0),
  origin_type text not null,
  origin_id uuid,
  title_id uuid,
  expires_on date,
  reason text,
  created_by text,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, party_id) references parties (tenant_id, id),
  foreign key (tenant_id, title_id) references financial_titles (tenant_id, id)
);
create index store_credit_entries_party_idx on store_credit_entries (tenant_id, party_id, created_at);
select gct_tenant_table('store_credit_entries', 'select, insert');

create table expense_categories (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id),
  name text not null,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  unique (tenant_id, id)
);
create unique index expense_categories_name_uq on expense_categories (tenant_id, lower(name)) where archived_at is null;
select gct_tenant_table('expense_categories');

create table recurring_expenses (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id),
  description text not null,
  category_id uuid,
  amount_cents bigint not null check (amount_cents > 0),
  day_of_month integer not null check (day_of_month between 1 and 28),
  party_id uuid,
  active boolean not null default true,
  last_generated_period char(7),
  created_by text,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, category_id) references expense_categories (tenant_id, id),
  foreign key (tenant_id, party_id) references parties (tenant_id, id)
);
select gct_tenant_table('recurring_expenses');

create table expenses (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id),
  kind text not null default 'operating' check (kind in ('operating', 'inventory_loss', 'other')),
  description text not null,
  category_id uuid,
  party_id uuid,
  competence_date date not null,
  amount_cents bigint not null check (amount_cents > 0),
  title_id uuid,
  recurring_id uuid,
  source_type text,
  source_id uuid,
  status text not null default 'active' check (status in ('active', 'canceled')),
  canceled_at timestamptz,
  cancel_reason text,
  notes text,
  created_by text,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, category_id) references expense_categories (tenant_id, id),
  foreign key (tenant_id, party_id) references parties (tenant_id, id),
  foreign key (tenant_id, title_id) references financial_titles (tenant_id, id),
  foreign key (tenant_id, recurring_id) references recurring_expenses (tenant_id, id)
);
create unique index expenses_recurring_uq on expenses (tenant_id, recurring_id, competence_date) where recurring_id is not null;
create index expenses_competence_idx on expenses (tenant_id, competence_date, id);
select gct_tenant_table('expenses');

create table cash_sessions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id),
  account_id uuid not null,
  opened_at timestamptz not null default now(),
  opened_by text,
  opening_counted_cents bigint not null check (opening_counted_cents >= 0),
  closed_at timestamptz,
  closed_by text,
  expected_cents bigint,
  counted_cents bigint check (counted_cents >= 0),
  difference_cents bigint,
  justification text,
  unique (tenant_id, id),
  foreign key (tenant_id, account_id) references financial_accounts (tenant_id, id)
);
create unique index cash_sessions_open_uq on cash_sessions (tenant_id, account_id) where closed_at is null;
select gct_tenant_table('cash_sessions');

create table financial_periods (
  tenant_id uuid not null references tenants (id),
  period char(7) not null check (period ~ '^\d{4}-\d{2}$'),
  status text not null check (status in ('closed', 'reopened')),
  closed_at timestamptz,
  closed_by text,
  reopened_at timestamptz,
  reopened_by text,
  reason text,
  primary key (tenant_id, period)
);
select gct_tenant_table('financial_periods');
