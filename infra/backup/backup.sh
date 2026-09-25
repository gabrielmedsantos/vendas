#!/usr/bin/env bash
# Backup lógico do PostgreSQL (pg_dump custom) + arquivos enviados, com checksum
# e teste de leitura. Opcionalmente criptografa (age) antes de enviar para fora da VPS.
# Não apaga nada além de backups locais mais antigos que RETENTION_DAYS.
#
# Uso (na raiz do repositório, na VPS):
#   BACKUP_DIR=/srv/gct-backups infra/backup/backup.sh
# Variáveis: BACKUP_DIR (obrigatória, fora do repositório/web root), ENV_FILE (.env.production),
#   AGE_RECIPIENT (chave pública age; se vazia, arquivos ficam SEM criptografia e o script avisa),
#   RETENTION_DAYS (padrão 14), COMPOSE (padrão "docker compose").
set -euo pipefail
: "${BACKUP_DIR:?defina BACKUP_DIR (ex.: /srv/gct-backups)}"
ENV_FILE="${ENV_FILE:-.env.production}"
COMPOSE="${COMPOSE:-docker compose} --env-file $ENV_FILE"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
DB_NAME="$(grep -E '^DB_NAME=' "$ENV_FILE" | cut -d= -f2- || true)"; DB_NAME="${DB_NAME:-gct}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="$BACKUP_DIR/$STAMP"
umask 077
mkdir -p "$OUT"

echo "[backup] banco $DB_NAME → $OUT/db.dump"
$COMPOSE exec -T db pg_dump -U postgres -d "$DB_NAME" --format=custom --compress=6 > "$OUT/db.dump"
# Teste de leitura: o índice do dump precisa ser listável.
$COMPOSE exec -T db pg_restore --list < "$OUT/db.dump" > "$OUT/db.list"
echo "[backup] $(grep -c 'TABLE DATA' "$OUT/db.list") tabelas com dados no dump"

echo "[backup] arquivos (fotos, PDFs, exportações)"
$COMPOSE exec -T worker tar -C /data -czf - storage > "$OUT/storage.tar.gz"
tar -tzf "$OUT/storage.tar.gz" > /dev/null

{
  echo "created_at=$STAMP"
  echo "app_version=$(grep -E '^APP_VERSION=' "$ENV_FILE" | cut -d= -f2- || echo desconhecida)"
  echo "migrations=$($COMPOSE exec -T db psql -U postgres -d "$DB_NAME" -Atc 'select max(version) from schema_migrations')"
} > "$OUT/manifest.txt"

if [ -n "${AGE_RECIPIENT:-}" ]; then
  for f in db.dump storage.tar.gz; do age -r "$AGE_RECIPIENT" -o "$OUT/$f.age" "$OUT/$f" && rm "$OUT/$f"; done
else
  echo "[backup] AVISO: AGE_RECIPIENT vazio; backup NÃO criptografado. Criptografe antes de enviar para fora da VPS." >&2
fi
(cd "$OUT" && sha256sum -- * > SHA256SUMS)
echo "[backup] concluído: $OUT"
echo "[backup] lembrete: copie $OUT para destino FORA da VPS (backup só local não é resiliente)."

# Retenção local (somente diretórios de backup com carimbo de data).
find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -name '20*T*Z' -mtime +"$RETENTION_DAYS" -print -exec rm -rf {} +
