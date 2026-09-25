#!/usr/bin/env bash
# Cria papéis e banco locais de desenvolvimento/teste. Requer psql com acesso de superusuário.
# Uso: ADMIN_URL=postgres://postgres:postgres@localhost:5432/postgres DB_NAME=gct_dev infra/db/setup-local.sh
set -euo pipefail
: "${ADMIN_URL:?defina ADMIN_URL (superusuário)}"
DB_NAME="${DB_NAME:-gct_dev}"
psql "$ADMIN_URL" -v ON_ERROR_STOP=1 \
  -v owner_pw="${GCT_OWNER_PASSWORD:-dev_owner}" \
  -v app_pw="${GCT_APP_PASSWORD:-dev_app}" \
  -v auth_pw="${GCT_AUTH_PASSWORD:-dev_auth}" \
  -v platform_pw="${GCT_PLATFORM_PASSWORD:-dev_platform}" \
  -v public_pw="${GCT_PUBLIC_PASSWORD:-dev_public}" \
  -v db_name="$DB_NAME" \
  -f "$(dirname "$0")/roles.sql"
