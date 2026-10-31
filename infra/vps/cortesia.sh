#!/usr/bin/env bash
# Libera uma empresa para sempre (cortesia), ex.: a do dono da plataforma. Não apaga nada; fica auditado.
# Uso:  sudo /srv/gct/infra/vps/cortesia.sh "Nome da empresa"             → mostra a empresa encontrada
#       sudo /srv/gct/infra/vps/cortesia.sh "Nome da empresa" --aplicar   → libera
set -euo pipefail
cd "$(dirname "$(readlink -f "$0")")/../.."
extra=()
[ -f compose.traefik.yaml ] && extra=(-f compose.yaml -f compose.traefik.yaml)
# Usa a imagem do worker que está no ar (APP_VERSION do .env.production); não sobe nem para serviços.
exec docker compose --env-file .env.production "${extra[@]}" run --rm --no-deps -T worker node dist/cortesia.js "$@"
