-- Cria/atualiza os papéis do banco. Executar como superusuário (initdb ou manutenção).
-- Variáveis psql obrigatórias: owner_pw, app_pw, auth_pw, platform_pw, public_pw, db_name
-- Nenhum papel recebe SUPERUSER ou BYPASSRLS.
\set ON_ERROR_STOP on

select format('create role %I login', r)
from unnest(array['gct_owner','gct_app','gct_auth','gct_platform','gct_public']) as r
where not exists (select 1 from pg_roles where rolname = r)
\gexec

alter role gct_owner    with login nosuperuser nocreatedb nocreaterole nobypassrls password :'owner_pw';
alter role gct_app      with login nosuperuser nocreatedb nocreaterole nobypassrls password :'app_pw';
alter role gct_auth     with login nosuperuser nocreatedb nocreaterole nobypassrls password :'auth_pw';
alter role gct_platform with login nosuperuser nocreatedb nocreaterole nobypassrls password :'platform_pw';
alter role gct_public   with login nosuperuser nocreatedb nocreaterole nobypassrls password :'public_pw';

select format('create database %I owner gct_owner', :'db_name')
where not exists (select 1 from pg_database where datname = :'db_name')
\gexec

\connect :db_name
revoke all on schema public from public;
alter schema public owner to gct_owner;
grant usage on schema public to gct_app, gct_auth, gct_platform, gct_public;
revoke all on database :"db_name" from public;
grant connect on database :"db_name" to gct_owner, gct_app, gct_auth, gct_platform, gct_public;
