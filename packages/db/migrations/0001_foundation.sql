-- Fundação: helpers de contexto, identidade (Better Auth), tenants, membros,
-- auditoria, outbox, idempotência e numeração de documentos.

create or replace function app_tenant_id() returns uuid
  language sql stable parallel safe
  as $$ select nullif(current_setting('app.tenant_id', true), '')::uuid $$;

create or replace function app_user_id() returns text
  language sql stable parallel safe
  as $$ select nullif(current_setting('app.user_id', true), '') $$;

create or replace function touch_updated_at() returns trigger
  language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- Ativa isolamento por tenant: RLS forçado + política única + grants do runtime.
create or replace function gct_tenant_table(t regclass, app_privs text default 'select, insert, update')
  returns void language plpgsql as $$
begin
  execute format('alter table %s enable row level security', t);
  execute format('alter table %s force row level security', t);
  execute format(
    'create policy tenant_isolation on %s using (tenant_id = (select app_tenant_id())) with check (tenant_id = (select app_tenant_id()))',
    t);
  execute format('grant %s on %s to gct_app', app_privs, t);
end $$;

-- ---------------------------------------------------------------------------
-- Identidade (schema gerado a partir do Better Auth 1.7.6 com plugin twoFactor)
-- Acesso somente pelo papel gct_auth (e leitura restrita via view).
create table "user" (
  "id" text not null primary key,
  "name" text not null,
  "email" text not null unique,
  "emailVerified" boolean not null,
  "image" text,
  "createdAt" timestamptz default current_timestamp not null,
  "updatedAt" timestamptz default current_timestamp not null,
  "twoFactorEnabled" boolean
);
create table "session" (
  "id" text not null primary key,
  "expiresAt" timestamptz not null,
  "token" text not null unique,
  "createdAt" timestamptz default current_timestamp not null,
  "updatedAt" timestamptz not null,
  "ipAddress" text,
  "userAgent" text,
  "userId" text not null references "user" ("id") on delete cascade
);
create table "account" (
  "id" text not null primary key,
  "accountId" text not null,
  "providerId" text not null,
  "userId" text not null references "user" ("id") on delete cascade,
  "accessToken" text,
  "refreshToken" text,
  "idToken" text,
  "accessTokenExpiresAt" timestamptz,
  "refreshTokenExpiresAt" timestamptz,
  "scope" text,
  "password" text,
  "createdAt" timestamptz default current_timestamp not null,
  "updatedAt" timestamptz not null
);
create table "verification" (
  "id" text not null primary key,
  "identifier" text not null,
  "value" text not null,
  "expiresAt" timestamptz not null,
  "createdAt" timestamptz default current_timestamp not null,
  "updatedAt" timestamptz default current_timestamp not null
);
create table "twoFactor" (
  "id" text not null primary key,
  "secret" text not null,
  "backupCodes" text not null,
  "userId" text not null references "user" ("id") on delete cascade,
  "verified" boolean,
  "failedVerificationCount" integer,
  "lockedUntil" timestamptz
);
create index "session_userId_idx" on "session" ("userId");
create index "account_userId_idx" on "account" ("userId");
create index "verification_identifier_idx" on "verification" ("identifier");
create index "twoFactor_secret_idx" on "twoFactor" ("secret");
create index "twoFactor_userId_idx" on "twoFactor" ("userId");

grant select, insert, update, delete on "user", "session", "account", "verification", "twoFactor" to gct_auth;

-- ---------------------------------------------------------------------------
-- Tenants (empresas)
create table tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 2 and 120),
  legal_name text,
  document text,
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,47}$'),
  timezone text not null default 'America/Sao_Paulo',
  currency char(3) not null default 'BRL',
  status text not null default 'active' check (status in ('active', 'suspended', 'archived')),
  status_reason text,
  email text,
  phone text,
  address jsonb not null default '{}'::jsonb,
  settings jsonb not null default '{}'::jsonb,
  onboarding jsonb not null default '{}'::jsonb,
  created_by text references "user" ("id"),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger tenants_touch before update on tenants for each row execute function touch_updated_at();

create table memberships (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id),
  user_id text not null references "user" ("id"),
  role text not null check (role in ('owner', 'manager', 'seller', 'stock', 'finance', 'viewer')),
  grants text[] not null default '{}',
  revokes text[] not null default '{}',
  status text not null default 'active' check (status in ('active', 'removed')),
  discount_limit_bps integer not null default 1000 check (discount_limit_bps between 0 and 10000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, user_id),
  unique (tenant_id, id)
);
create index memberships_user_idx on memberships (user_id) where status = 'active';
create trigger memberships_touch before update on memberships for each row execute function touch_updated_at();

create table invites (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id),
  email text not null,
  role text not null check (role in ('manager', 'seller', 'stock', 'finance', 'viewer', 'owner')),
  token_hash text not null unique,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_by text references "user" ("id"),
  revoked_at timestamptz,
  created_by text not null references "user" ("id"),
  created_at timestamptz not null default now(),
  unique (tenant_id, id)
);

-- RLS de tenants/memberships: runtime vê a empresa atual e as próprias participações.
alter table tenants enable row level security;
alter table tenants force row level security;
create policy tenant_self on tenants for select to gct_app
  using (id = (select app_tenant_id())
         or id in (select m.tenant_id from memberships m where m.user_id = (select app_user_id()) and m.status = 'active'));
create policy tenant_update on tenants for update to gct_app
  using (id = (select app_tenant_id())) with check (id = (select app_tenant_id()));
create policy platform_all on tenants to gct_platform using (true) with check (true);
create policy public_read on tenants for select to gct_public using (id = (select app_tenant_id()));
grant select on tenants to gct_app;
grant update (name, legal_name, document, timezone, email, phone, address, settings, onboarding) on tenants to gct_app;
grant select, insert, update on tenants to gct_platform;
grant select (id, name, slug, timezone, currency, status) on tenants to gct_public;

alter table memberships enable row level security;
alter table memberships force row level security;
create policy member_tenant on memberships to gct_app
  using (tenant_id = (select app_tenant_id())) with check (tenant_id = (select app_tenant_id()));
create policy member_self on memberships for select to gct_app using (user_id = (select app_user_id()));
create policy platform_all on memberships to gct_platform using (true) with check (true);
create policy member_view on memberships for select to gct_owner using (tenant_id = (select app_tenant_id()));
grant select, insert, update on memberships to gct_app, gct_platform;

alter table invites enable row level security;
alter table invites force row level security;
create policy tenant_isolation on invites to gct_app
  using (tenant_id = (select app_tenant_id())) with check (tenant_id = (select app_tenant_id()));
create policy platform_all on invites to gct_platform using (true) with check (true);
grant select, insert, update on invites to gct_app;
grant select, update on invites to gct_platform;

-- Diretório de membros: expõe nome/e-mail somente de usuários da empresa atual.
-- A view roda como o dono (gct_owner), sujeito a FORCE RLS em memberships.
create view member_directory with (security_barrier) as
  select m.id as membership_id, m.tenant_id, m.user_id, m.role, m.grants, m.revokes, m.status,
         m.discount_limit_bps, m.created_at, u.name, u.email
  from memberships m
  join "user" u on u.id = m.user_id
  where m.tenant_id = (select app_tenant_id());
grant select on member_directory to gct_app;

-- ---------------------------------------------------------------------------
-- Controle: auditoria (append-only), outbox, idempotência, sequências.
create table audit_events (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references tenants (id),
  user_id text,
  action text not null,
  entity text not null,
  entity_id text,
  data jsonb not null default '{}'::jsonb,
  request_id text,
  created_at timestamptz not null default now()
);
create index audit_events_tenant_idx on audit_events (tenant_id, created_at desc, id desc);
select gct_tenant_table('audit_events', 'select, insert');

create table outbox_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id),
  type text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'processing', 'done', 'dead')),
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  locked_until timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (tenant_id, id)
);
create index outbox_pending_idx on outbox_events (available_at) where status in ('pending', 'processing');
select gct_tenant_table('outbox_events', 'select, insert');
create policy platform_all on outbox_events to gct_platform using (true) with check (true);
grant select, update on outbox_events to gct_platform;

create table idempotency_keys (
  tenant_id uuid not null references tenants (id),
  operation text not null,
  key uuid not null,
  request_hash text not null,
  status_code integer,
  response jsonb,
  created_at timestamptz not null default now(),
  primary key (tenant_id, operation, key)
);
select gct_tenant_table('idempotency_keys', 'select, insert, update');

create table document_sequences (
  tenant_id uuid not null references tenants (id),
  doc_type text not null,
  next_number bigint not null default 1 check (next_number > 0),
  primary key (tenant_id, doc_type)
);
select gct_tenant_table('document_sequences', 'select, insert, update');

create table notifications (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id),
  user_id text,
  kind text not null,
  severity text not null default 'info' check (severity in ('info', 'success', 'warning', 'danger')),
  title text not null,
  body text,
  link text,
  dedupe_key text,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  unique (tenant_id, dedupe_key)
);
create index notifications_tenant_idx on notifications (tenant_id, created_at desc);
select gct_tenant_table('notifications', 'select, insert, update');
