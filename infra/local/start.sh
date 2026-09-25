#!/usr/bin/env bash
# Sobe o sistema completo no seu computador com Docker (Linux, macOS ou WSL).
# Uso, na raiz do repositório:  bash infra/local/start.sh
# Gera .env.production com senhas aleatórias se ainda não existir (arquivo ignorado pelo Git).
# Para parar sem apagar dados:  docker compose --env-file .env.production stop
set -euo pipefail
cd "$(dirname "$0")/../.."
PORT="${PORT:-3000}"
command -v docker >/dev/null || { echo "Instale o Docker Desktop (ou Docker Engine) primeiro."; exit 1; }

if [ ! -f .env.production ]; then
  if docker volume inspect "${COMPOSE_PROJECT_NAME:-gct}_db-data" >/dev/null 2>&1; then
    echo "Já existe um banco local (volume ${COMPOSE_PROJECT_NAME:-gct}_db-data) mas não há .env.production."
    echo "As senhas novas não abririam esse banco. Restaure o .env.production anterior; nada foi alterado."
    exit 1
  fi
  umask 077
  sed -e "s#^APP_URL=.*#APP_URL=http://localhost:${PORT}#" -e "s/^WEB_PORT=.*/WEB_PORT=${PORT}/" \
      -e "s/^BILLING_ENVIRONMENT=.*/BILLING_ENVIRONMENT=sandbox/" -e "s/^PLATFORM_REQUIRE_2FA=.*/PLATFORM_REQUIRE_2FA=true/" \
      .env.production.example | while IFS= read -r l; do
        case "$l" in *PASSWORD=|AUTH_SECRET=) echo "$l$(od -An -N24 -tx1 /dev/urandom | tr -d ' \n')";; *) echo "$l";; esac
      done > .env.production
  echo "Criado .env.production (senhas aleatórias locais)."
fi

[ "${SKIP_BUILD:-}" = 1 ] || docker compose --env-file .env.production build
docker compose --env-file .env.production up -d --wait
DEMO_PASSWORD="${DEMO_PASSWORD:-demo-senha-local}"
docker compose --env-file .env.production run --rm -e SEED_PASSWORD="$DEMO_PASSWORD" worker node dist/seed-demo.js || true

cat <<MSG

Pronto: abra http://localhost:${PORT}
  Loja com celulares, trocas e crediário:  demo-celulares@example.test
  Brechó:                                  demo-brecho@example.test
  Senha dos dois:                          ${DEMO_PASSWORD}
Ou crie sua própria conta em /cadastro.
Parar (mantendo os dados): docker compose --env-file .env.production stop
MSG
