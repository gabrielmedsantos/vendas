#!/bin/sh
# Executado pelo entrypoint do Postgres apenas na PRIMEIRA inicialização (volume vazio).
# Cria papéis sem SUPERUSER/BYPASSRLS e o banco da aplicação. Senhas vêm do ambiente; nada é impresso.
set -eu
psql -v ON_ERROR_STOP=1 --username postgres --dbname postgres \
  -v owner_pw="$GCT_OWNER_PASSWORD" -v app_pw="$GCT_APP_PASSWORD" -v auth_pw="$GCT_AUTH_PASSWORD" \
  -v platform_pw="$GCT_PLATFORM_PASSWORD" -v public_pw="$GCT_PUBLIC_PASSWORD" -v db_name="$DB_NAME" \
  -f /gct/roles.sql >/dev/null
echo "gct: papéis e banco criados"
