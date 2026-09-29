-- Contrato de venda (novo tipo de documento) e link de compartilhamento para o cliente.
-- Alteração aditiva: nenhum dado existente é alterado ou apagado.

alter table documents drop constraint if exists documents_doc_type_check;
alter table documents add constraint documents_doc_type_check
  check (doc_type in ('sale_receipt', 'purchase_term', 'trade_summary', 'quote', 'return_receipt', 'warranty', 'sale_contract'));

-- Link público de um documento: guarda só o hash do token (o token vai no link e não é recuperável).
create table document_shares (
  token_hash text primary key check (token_hash ~ '^[0-9a-f]{64}$'),
  tenant_id uuid not null references tenants (id),
  document_id uuid not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_by text,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, document_id) references documents (tenant_id, id)
);
create index document_shares_document on document_shares (tenant_id, document_id);
select gct_tenant_table('document_shares', 'select, insert, update');

-- Acesso público (sem login): acha o link pelo hash; só links válidos.
create policy public_lookup on document_shares for select to gct_public using (revoked_at is null and expires_at > now());
grant select (token_hash, tenant_id, document_id, expires_at, revoked_at) on document_shares to gct_public;

-- Dentro da empresa do link, o papel público só enxerga documento com link válido (política restritiva).
grant select (id, tenant_id, doc_type, number, status, storage_key) on documents to gct_public;
create policy public_shared_only on documents as restrictive for select to gct_public
  using (exists (select 1 from document_shares s where s.tenant_id = documents.tenant_id and s.document_id = documents.id and s.revoked_at is null and s.expires_at > now()));
