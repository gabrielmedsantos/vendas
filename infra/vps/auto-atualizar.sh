#!/usr/bin/env bash
# Atualização automática da VPS a partir do GitHub (executado pelo timer systemd gct-atualizar.timer).
# Havendo commit novo no ramo: backup → código novo → build com imagens marcadas pelo commit → subida.
# Se o build falhar: mantém a versão no ar e não tenta o mesmo commit de novo.
# Se a subida falhar: volta para as imagens e o código anteriores (rollback) e registra.
# Nunca apaga volumes nem mexe em outros containers. Log: /var/log/gct-atualizar.log
{
set -euo pipefail
cd "$(dirname "$(readlink -f "$0")")/../.."
RAIZ=$(pwd)
RAMO="${GCT_RAMO:-claude/new-session-z10cuu}"
LOG="${GCT_LOG:-/var/log/gct-atualizar.log}"
ESTADO="$RAIZ/.deploy"
mkdir -p "$ESTADO"
exec 9>"$ESTADO/lock"
flock -n 9 || exit 0
log() { echo "$(date -Is) $*" >> "$LOG"; }

compose() {
  local extra=()
  [ -f compose.traefik.yaml ] && extra=(-f compose.yaml -f compose.traefik.yaml)
  docker compose --env-file .env.production "${extra[@]}" "$@"
}

git fetch -q origin "$RAMO"
NOVO=$(git rev-parse FETCH_HEAD)
ATUAL=$(cat "$ESTADO/implantado" 2>/dev/null || true)
[ "$NOVO" = "$ATUAL" ] && exit 0
[ "$NOVO" = "$(cat "$ESTADO/falhou" 2>/dev/null || true)" ] && exit 0

log "nova versão ${NOVO:0:12} (no ar: ${ATUAL:0:12})"
REV_ANTERIOR=$(git rev-parse HEAD)
TAG_ANTERIOR=$(sed -n 's/^APP_VERSION=//p' .env.production | tail -1)
TAG_ANTERIOR=${TAG_ANTERIOR:-local}
TAG=${NOVO:0:12}

falhou() {
  log "FALHA: $1"
  echo "$NOVO" > "$ESTADO/falhou"
  exit 1
}

if ! BACKUP_DIR="${GCT_BACKUP_DIR:-/srv/gct-backups}" bash infra/backup/backup.sh >> "$LOG" 2>&1; then
  falhou "backup não concluído; atualização adiada (versão no ar mantida)"
fi

git reset -q --hard "$NOVO"
export APP_VERSION="$TAG"
if [ "${GCT_PULAR_BUILD:-}" != 1 ] && ! compose build >> "$LOG" 2>&1; then
  git reset -q --hard "$REV_ANTERIOR"
  falhou "build de ${TAG} falhou; versão ${TAG_ANTERIOR} continua no ar"
fi

if ! compose up -d --wait >> "$LOG" 2>&1; then
  log "subida de ${TAG} falhou; voltando para ${TAG_ANTERIOR}"
  compose logs --tail 40 web migrate >> "$LOG" 2>&1 || true
  git reset -q --hard "$REV_ANTERIOR"
  export APP_VERSION="$TAG_ANTERIOR"
  compose up -d --wait >> "$LOG" 2>&1 || log "ATENÇÃO: rollback também não subiu; verificar manualmente"
  falhou "rollback para ${TAG_ANTERIOR} executado"
fi

if grep -q '^APP_VERSION=' .env.production; then
  sed -i "s/^APP_VERSION=.*/APP_VERSION=${TAG}/" .env.production
else
  echo "APP_VERSION=${TAG}" >> .env.production
fi
echo "$NOVO" > "$ESTADO/implantado"
rm -f "$ESTADO/falhou"
log "OK: ${TAG} no ar"

# Mantém só as 3 imagens mais recentes deste sistema (a em uso nunca é removida pelo Docker).
for repo in gct-web gct-worker gct-tts; do
  docker image ls "$repo" --format '{{.Tag}}' | tail -n +4 | while read -r t; do
    [ "$t" = "$TAG" ] || docker image rm "$repo:$t" >/dev/null 2>&1 || true
  done
done
exit 0
}
