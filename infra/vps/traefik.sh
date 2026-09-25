#!/usr/bin/env bash
# Liga o sistema a um Traefik que JÁ roda na VPS (não altera o Traefik).
# Copia o padrão de um container que já funciona com ele (entrypoint, certresolver,
# rede) e gera compose.traefik.yaml com rótulos para o domínio. Uso, na pasta /srv/gct:
#   bash infra/vps/traefik.sh --dominio lucromax.exemplo.com.br
set -euo pipefail
cd "$(dirname "$0")/../.."
DOMINIO=""; SIM=0
while [ $# -gt 0 ]; do case "$1" in --dominio) DOMINIO="${2:-}"; shift 2;; --sim) SIM=1; shift;; *) echo "Opção desconhecida: $1"; exit 1;; esac; done
[ -n "$DOMINIO" ] || { echo "Uso: bash infra/vps/traefik.sh --dominio seu.dominio.com.br"; exit 1; }
PROJ="${COMPOSE_PROJECT_NAME:-gct}"
erro() { printf '\n\033[31mERRO:\033[0m %s\n' "$*"; exit 1; }

TR=$(docker ps --format '{{.Names}} {{.Image}}' | awk 'tolower($2) ~ /(^|\/)traefik(:|@|$)/ {print $1; exit}' || true)
[ -n "$TR" ] || erro "Nenhum container do Traefik rodando."
echo "Traefik encontrado: $TR"
ARGS=$(docker inspect "$TR" --format '{{range .Config.Cmd}}{{println .}}{{end}}{{range .Args}}{{println .}}{{end}}')
echo "$ARGS" | grep -q 'providers.docker' || echo "  (aviso: não vi --providers.docker nos argumentos; se o Traefik usa arquivo de configuração, confira o resultado)"

# Padrão de um roteador que já funciona com certificado neste Traefik.
RES=""; EP=""; NET=""
for c in $(docker ps --format '{{.Names}}'); do
  [ "$c" = "$TR" ] && continue
  L=$(docker inspect "$c" --format '{{range $k,$v := .Config.Labels}}{{$k}}={{$v}}{{println}}{{end}}')
  r=$(echo "$L" | sed -n 's/^traefik\.http\.routers\.[^.]*\.tls\.certresolver=//p' | head -1 || true)
  if [ -n "$r" ] && [ -z "$RES" ]; then
    RES="$r"; MODELO="$c"
    EP=$(echo "$L" | sed -n 's/^traefik\.http\.routers\.[^.]*\.entrypoints=//p' | grep -v '^web$' | head -1 || true)
    [ -z "$EP" ] && EP=$(echo "$L" | sed -n 's/^traefik\.http\.routers\.[^.]*\.entrypoints=//p' | head -1)
    NET=$(echo "$L" | sed -n 's/^traefik\.docker\.network=//p' | head -1 || true)
  fi
done
# Sem modelo: tenta ler dos argumentos do Traefik.
[ -z "$RES" ] && RES=$(echo "$ARGS" | sed -n 's/^--certificatesresolvers\.\([^.]*\)\..*/\1/p' | head -1)
[ -z "$EP" ] && EP=$(echo "$ARGS" | sed -n 's/^--entrypoints\.\([^.]*\)\.address=:443.*/\1/p' | head -1)
HTTP_EP=$(echo "$ARGS" | sed -n 's/^--entrypoints\.\([^.]*\)\.address=:80$/\1/p' | head -1 || true)
if [ -z "$NET" ]; then
  NET=$(docker inspect "$TR" --format '{{range $k,$v := .NetworkSettings.Networks}}{{println $k}}{{end}}' | grep -vE '^(bridge|host|none)?$' | head -1 || true)
fi
RES="${TRAEFIK_RESOLVER:-$RES}"; EP="${TRAEFIK_ENTRYPOINT:-$EP}"; NET="${TRAEFIK_NETWORK:-$NET}"
[ -n "$EP" ] && [ -n "$NET" ] || erro "Não consegui detectar entrypoint/rede do Traefik. Informe: TRAEFIK_ENTRYPOINT=... TRAEFIK_NETWORK=... TRAEFIK_RESOLVER=..."
echo "  Modelo usado: ${MODELO:-argumentos do Traefik}"
echo "  Entrypoint HTTPS: $EP · certresolver: ${RES:-(nenhum)} · rede: $NET${HTTP_EP:+ · entrypoint HTTP: $HTTP_EP}"
if [ "$SIM" != 1 ]; then read -r -p "Gerar compose.traefik.yaml e publicar https://$DOMINIO por este Traefik? [s/N] " r; [[ "$r" =~ ^[sS] ]] || { echo "Cancelado."; exit 0; }; fi

ROT="gct-${PROJ}"
{
  echo "# Gerado por infra/vps/traefik.sh — publica o web pelo Traefik existente ($TR)."
  echo "services:"
  echo "  web:"
  echo "    networks: [internal, edge, traefik]"
  echo "    labels:"
  echo "      traefik.enable: \"true\""
  echo "      traefik.docker.network: \"$NET\""
  echo "      traefik.http.routers.${ROT}.rule: \"Host(\`$DOMINIO\`)\""
  echo "      traefik.http.routers.${ROT}.entrypoints: \"$EP\""
  # Prioridade alta: vence regras "pega-tudo" (ex.: *.dominio) de outros sites no mesmo Traefik.
  echo "      traefik.http.routers.${ROT}.priority: \"10000\""
  echo "      traefik.http.routers.${ROT}.tls: \"true\""
  [ -n "$RES" ] && echo "      traefik.http.routers.${ROT}.tls.certresolver: \"$RES\""
  echo "      traefik.http.routers.${ROT}.service: \"${ROT}\""
  echo "      traefik.http.services.${ROT}.loadbalancer.server.port: \"3000\""
  if [ -n "$HTTP_EP" ]; then
    echo "      traefik.http.routers.${ROT}-http.rule: \"Host(\`$DOMINIO\`)\""
    echo "      traefik.http.routers.${ROT}-http.entrypoints: \"$HTTP_EP\""
    echo "      traefik.http.routers.${ROT}-http.priority: \"10000\""
    echo "      traefik.http.routers.${ROT}-http.middlewares: \"${ROT}-https\""
    echo "      traefik.http.routers.${ROT}-http.service: \"${ROT}\""
    echo "      traefik.http.middlewares.${ROT}-https.redirectscheme.scheme: \"https\""
  fi
  echo "networks:"
  echo "  traefik:"
  echo "    external: true"
  echo "    name: \"$NET\""
} > compose.traefik.yaml
echo "Gerado compose.traefik.yaml"

C="docker compose --env-file .env.production -f compose.yaml -f compose.traefik.yaml"
$C up -d --wait web
echo "Aguardando o certificado (até 90 s)..."
for i in $(seq 1 18); do
  if curl -fsS -m 5 "https://$DOMINIO/healthz" >/dev/null 2>&1; then printf '\n\033[32mNo ar:\033[0m https://%s\n' "$DOMINIO"; exit 0; fi
  sleep 5
done
echo "Ainda não respondeu com HTTPS válido. Veja: docker logs --tail 40 $TR 2>&1 | grep -i -E 'error|acme|$DOMINIO'"
exit 1
