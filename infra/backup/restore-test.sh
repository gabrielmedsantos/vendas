#!/usr/bin/env bash
# Teste de restauração ISOLADO: restaura um backup em um banco temporário
# (gct_restore_test_<data>) no mesmo servidor Postgres, confere contagens e
# isolamento por RLS, e remove o banco temporário ao fim.
# NUNCA restaura sobre o banco em uso. Para desastre real, siga docs/RUNBOOK.md.
#
# Uso: infra/backup/restore-test.sh /srv/gct-backups/20260101T030000Z
set -euo pipefail
SRC="${1:?informe o diretório do backup}"
ENV_FILE="${ENV_FILE:-.env.production}"
COMPOSE="${COMPOSE:-docker compose} --env-file $ENV_FILE"
TMPDB="gct_restore_test_$(date -u +%Y%m%d%H%M%S)"
DUMP="$SRC/db.dump"
if [ -f "$SRC/db.dump.age" ]; then
  : "${AGE_IDENTITY:?backup criptografado: defina AGE_IDENTITY (arquivo da chave privada)}"
  DUMP="$(mktemp)"; trap 'rm -f "$DUMP"' EXIT
  age -d -i "$AGE_IDENTITY" -o "$DUMP" "$SRC/db.dump.age"
fi
(cd "$SRC" && sha256sum -c SHA256SUMS)

started=$(date +%s)
psqlc() { $COMPOSE exec -T db psql -U postgres -v ON_ERROR_STOP=1 "$@"; }
cleanup() { psqlc -d postgres -qc "drop database if exists \"$TMPDB\"" >/dev/null 2>&1 || true; }
trap cleanup EXIT
psqlc -d postgres -qc "create database \"$TMPDB\" owner gct_owner"
psqlc -d "$TMPDB" -qc "revoke all on database \"$TMPDB\" from public"
$COMPOSE exec -T db pg_restore -U postgres -d "$TMPDB" --exit-on-error < "$DUMP"

echo "[restore-test] contagens:"
psqlc -d "$TMPDB" -Atc "select 'empresas', count(*) from tenants union all select 'vendas', count(*) from sales union all select 'trocas', count(*) from trades union all select 'movimentos de estoque', count(*) from stock_movements union all select 'migrações aplicadas', count(*) from schema_migrations" | sed 's/|/: /'
echo "[restore-test] RLS: papel da aplicação sem empresa definida não enxerga vendas:"
psqlc -d "$TMPDB" -Atc "set role gct_app; select count(*) from sales;"
psqlc -d "$TMPDB" -Atc "select 'papéis com BYPASSRLS/SUPERUSER (esperado 0): ' || count(*) from pg_roles where rolname like 'gct_%' and (rolbypassrls or rolsuper)"
echo "[restore-test] duração: $(( $(date +%s) - started ))s — registre no controle de testes de restauração."
