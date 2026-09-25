#!/usr/bin/env bash
# Instalador para a VPS (rodar NA VPS, na pasta do projeto). Nada é apagado.
#
#   bash infra/vps/instalar.sh --dominio lucromax.exemplo.com.br [--demo]
#
# Etapas: 1) inventário do servidor (só leitura)  2) confirma com você
#         3) .env.production com segredos gerados no servidor (chmod 600)
#         4) proxy HTTPS: usa o Caddy do projeto SÓ se 80/443 estiverem livres;
#            se já houver Nginx/Apache/Traefik/outro, gera a configuração e
#            mostra como ligar, sem mexer no serviço existente
#         5) build + subida + verificação  6) backup diário (opcional)
set -euo pipefail
cd "$(dirname "$0")/../.."
DOMINIO=""; DEMO=0; SIM=0
while [ $# -gt 0 ]; do
  case "$1" in
    --dominio) DOMINIO="${2:-}"; shift 2 ;;
    --demo) DEMO=1; shift ;;
    --sim) SIM=1; shift ;;   # responde "sim" às confirmações (uso avançado)
    *) echo "Opção desconhecida: $1"; exit 1 ;;
  esac
done
[ -n "$DOMINIO" ] || { echo "Uso: bash infra/vps/instalar.sh --dominio seu.dominio.com.br [--demo]"; exit 1; }
PORTA_APP="${WEB_PORT:-3380}"
C="docker compose --env-file .env.production"
[ -f compose.traefik.yaml ] && C="$C -f compose.yaml -f compose.traefik.yaml"
ok()   { printf '  \033[32mOK\033[0m   %s\n' "$*"; }
av()   { printf '  \033[33mAVISO\033[0m %s\n' "$*"; }
erro() { printf '\n\033[31mERRO:\033[0m %s\n' "$*"; exit 1; }
pergunta() { [ "$SIM" = 1 ] && return 0; read -r -p "$1 [s/N] " r; [[ "$r" =~ ^[sS] ]]; }
# Teste de conexão real (não depende de ss/netstat estarem instalados).
escutando() { timeout 2 bash -c "exec 3<>/dev/tcp/127.0.0.1/$1" 2>/dev/null || timeout 2 bash -c "exec 3<>/dev/tcp/::1/$1" 2>/dev/null; }
SUDO=""; [ "$(id -u)" -ne 0 ] && command -v sudo >/dev/null && SUDO="sudo"

echo "== 1. Inventário do servidor (somente leitura) =="
. /etc/os-release 2>/dev/null || true
echo "  Sistema: ${PRETTY_NAME:-desconhecido} · arquitetura $(uname -m)"
MEM_MB=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
DISCO_GB=$(df -BG --output=avail . | tail -1 | tr -dc 0-9 || true)
echo "  Memória: ${MEM_MB} MB · disco livre aqui: ${DISCO_GB} GB · CPUs: $(nproc)"
[ "$MEM_MB" -lt 1800 ] && av "Pouca memória para compilar (< 2 GB). Se o build falhar, crie swap de 2 GB ou compile em outra máquina."
[ "$DISCO_GB" -lt 8 ] && av "Pouco disco livre (< 8 GB)."
case "$(uname -m)" in x86_64|aarch64) ;; *) erro "Arquitetura $(uname -m) não suportada pelas imagens.";; esac
if command -v docker >/dev/null && docker compose version >/dev/null 2>&1; then
  ok "Docker $(docker version --format '{{.Server.Version}}' 2>/dev/null || echo '?') com Compose $(docker compose version --short)"
else
  av "Docker/Compose não encontrado."
  DOCKER_FALTA=1
fi
echo "  Serviços web ativos:"; for s in nginx apache2 httpd caddy traefik; do systemctl is-active --quiet "$s" 2>/dev/null && echo "    - $s (systemd)"; done
if command -v docker >/dev/null; then docker ps --format '    - container {{.Names}} ({{.Image}}) {{.Ports}}' 2>/dev/null | grep -v '^$' || true; fi
P80=0; P443=0; escutando 80 && P80=1; escutando 443 && P443=1
echo "  Porta 80: $([ $P80 = 1 ] && echo ocupada || echo livre) · porta 443: $([ $P443 = 1 ] && echo ocupada || echo livre) · porta interna ${PORTA_APP}: $(escutando "$PORTA_APP" && echo OCUPADA || echo livre)"
escutando "$PORTA_APP" && [ ! -f .env.production ] && erro "Porta ${PORTA_APP} já usada por outro programa. Rode com WEB_PORT=3480 bash infra/vps/instalar.sh ..."
IP_DNS=$(getent ahostsv4 "$DOMINIO" | awk 'NR==1{print $1}' || true)
IP_AQUI=$(curl -4 -fsS -m 5 https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}' || true)
if [ -n "$IP_DNS" ] && [ "$IP_DNS" = "$IP_AQUI" ]; then ok "DNS: $DOMINIO → $IP_DNS (este servidor)"; else av "DNS: $DOMINIO → ${IP_DNS:-sem resposta}; IP deste servidor: ${IP_AQUI:-?}. O HTTPS só funciona quando apontar para cá."; fi
if command -v ufw >/dev/null && $SUDO ufw status 2>/dev/null | grep -q "Status: active"; then
  $SUDO ufw status | grep -qE '^(80|443|80,443)[/ ].*ALLOW' && ok "Firewall (ufw) libera 80/443" || av "ufw ativo: confirme que 80 e 443 estão liberados (sudo ufw allow 80,443/tcp)."
fi

if [ "${DOCKER_FALTA:-0}" = 1 ]; then
  echo
  echo "O Docker é necessário. Instalação oficial: https://docs.docker.com/engine/install/"
  pergunta "Instalar agora pelo script oficial do Docker (get.docker.com)?" || erro "Instale o Docker e rode de novo."
  curl -fsSL https://get.docker.com | $SUDO sh
  [ -n "$SUDO" ] && $SUDO usermod -aG docker "$USER" && av "Seu usuário entrou no grupo docker; se o próximo passo falhar por permissão, saia e entre de novo no SSH."
  C="$SUDO $C"
fi
docker info >/dev/null 2>&1 || C="$SUDO $C"

echo; echo "== 2. Plano =="
PROJ="${COMPOSE_PROJECT_NAME:-gct}"
NOSSO_CADDY=0; docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "${PROJ}-caddy-1" && NOSSO_CADDY=1
if [ $NOSSO_CADDY = 1 ] || { [ $P80 = 0 ] && [ $P443 = 0 ]; }; then MODO=caddy; echo "  HTTPS pelo Caddy do projeto (certificado automático para $DOMINIO)."
elif TRAEFIK=$(docker ps --format '{{.Names}} {{.Image}}' 2>/dev/null | awk 'tolower($2) ~ /(^|\/)traefik(:|@|$)/ {print $1; exit}') && [ -n "$TRAEFIK" ]; then
  MODO=traefik; echo "  As portas 80/443 são do Traefik ($TRAEFIK): o sistema será publicado por ele, com rótulos só no container novo (o Traefik e os outros sites não são alterados)."
else MODO=externo; echo "  Já existe algo nas portas 80/443: o app fica em 127.0.0.1:${PORTA_APP} e você liga o proxy existente (nada será alterado nele)."; fi
echo "  Banco PostgreSQL próprio, sem porta pública. Dados em volumes Docker (${PROJ}_db-data, ${PROJ}_app-storage)."
pergunta "Continuar com a instalação?" || { echo "Cancelado. Nada foi alterado."; exit 0; }

echo; echo "== 3. Configuração =="
if [ -f .env.production ]; then
  ok ".env.production já existe; mantido (senhas preservadas)."
else
  if docker volume inspect "${PROJ}_db-data" >/dev/null 2>&1 || $SUDO docker volume inspect "${PROJ}_db-data" >/dev/null 2>&1; then
    erro "Existe o volume ${PROJ}_db-data mas não o .env.production: restaure o arquivo original (senhas do banco)."
  fi
  umask 077
  sed -e "s#^APP_URL=.*#APP_URL=https://${DOMINIO}#" -e "s/^APP_DOMAIN=.*/APP_DOMAIN=${DOMINIO}/" -e "s/^WEB_PORT=.*/WEB_PORT=${PORTA_APP}/" \
      -e "s/^REQUIRE_EMAIL_VERIFICATION=.*/REQUIRE_EMAIL_VERIFICATION=false/" .env.production.example \
    | while IFS= read -r l; do case "$l" in *PASSWORD=|AUTH_SECRET=) echo "$l$(openssl rand -hex 32)";; *) echo "$l";; esac; done > .env.production
  chmod 600 .env.production
  ok ".env.production criado (segredos gerados aqui, permissão 600). Guarde uma cópia segura: sem ele o banco não abre."
fi
sed -i -e "s#^APP_URL=.*#APP_URL=https://${DOMINIO}#" -e "s/^APP_DOMAIN=.*/APP_DOMAIN=${DOMINIO}/" .env.production

echo; echo "== 4. Build e subida (a primeira compilação leva alguns minutos) =="
[ "${SKIP_BUILD:-}" = 1 ] || $C build
if [ "$MODO" = caddy ]; then $C --profile caddy up -d --wait; else $C up -d --wait; fi
curl -fsS "http://127.0.0.1:${PORTA_APP}/readyz" >/dev/null && ok "Aplicação respondendo em 127.0.0.1:${PORTA_APP}" || erro "A aplicação não respondeu. Veja: $C logs --tail 50 web migrate db"

if [ "$DEMO" = 1 ]; then
  SENHA_DEMO=$(openssl rand -hex 6)
  $C run --rm -e SEED_ALLOW_REMOTE=1 -e SEED_PASSWORD="demo-$SENHA_DEMO" worker node dist/seed-demo.js && \
    echo "  Empresas demo: demo-celulares@example.test / demo-brecho@example.test · senha: demo-$SENHA_DEMO"
fi

if [ "$MODO" = traefik ]; then
  echo; echo "== 5. Publicar pelo Traefik =="
  if [ -f compose.traefik.yaml ] && ! grep -q '\.priority:' compose.traefik.yaml; then
    # Versão antiga sem prioridade: aplica a prioridade alta nas regras do sistema.
    sed -i -E 's/^(\s*)traefik\.http\.routers\.([^.]+)\.rule: .*/&\n\1traefik.http.routers.\2.priority: "10000"/' compose.traefik.yaml
    $C up -d --wait web && ok "Prioridade alta aplicada no Traefik (vence regras pega-tudo de outros sites)."
  fi
  if [ -f compose.traefik.yaml ]; then ok "compose.traefik.yaml já existe (mantido)."
    curl -fsS -m 15 "https://${DOMINIO}/healthz" >/dev/null 2>&1 && ok "https://${DOMINIO} no ar." || av "https://${DOMINIO} ainda não respondeu; veja os logs do Traefik."
  else
    SIMFLAG=""; [ "$SIM" = 1 ] && SIMFLAG="--sim"
    COMPOSE_PROJECT_NAME="$PROJ" bash infra/vps/traefik.sh --dominio "$DOMINIO" $SIMFLAG || av "Publicação pelo Traefik não confirmada; veja a mensagem acima."
  fi
elif [ "$MODO" = externo ]; then
  mkdir -p infra/vps/gerado
  cat > infra/vps/gerado/nginx-${DOMINIO}.conf <<NGX
server {
    listen 80;
    server_name ${DOMINIO};
    client_max_body_size 8m;
    location / {
        proxy_pass http://127.0.0.1:${PORTA_APP};
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-Host \$host;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Real-IP \$remote_addr;
    }
}
NGX
  echo; echo "== 5. Ligar no proxy que já existe (não foi alterado) =="
  echo "  Se for Nginx:"
  echo "    sudo cp infra/vps/gerado/nginx-${DOMINIO}.conf /etc/nginx/sites-available/${DOMINIO}"
  echo "    sudo ln -s /etc/nginx/sites-available/${DOMINIO} /etc/nginx/sites-enabled/"
  echo "    sudo nginx -t && sudo systemctl reload nginx"
  echo "    sudo certbot --nginx -d ${DOMINIO}      # certificado HTTPS"
  echo "  Outro proxy/painel: aponte ${DOMINIO} para http://127.0.0.1:${PORTA_APP} repassando Host e X-Forwarded-Proto."
else
  echo; echo "== 5. HTTPS =="
  sleep 5
  if curl -fsS -m 30 "https://${DOMINIO}/healthz" >/dev/null 2>&1; then ok "https://${DOMINIO} no ar com certificado."
  else av "Certificado ainda sendo emitido ou DNS/firewall pendente. Veja: $C logs --tail 30 caddy"; fi
fi

echo; echo "== 6. Backup diário =="
if ! command -v crontab >/dev/null; then
  av "cron não instalado; backup não agendado. Instale (sudo apt install cron) e rode de novo, ou use infra/backup/backup.sh manualmente."
elif pergunta "Agendar backup diário às 03:17 em /srv/gct-backups (banco + arquivos, retenção 14 dias)?"; then
  $SUDO mkdir -p /srv/gct-backups && $SUDO chown "$(id -u):$(id -g)" /srv/gct-backups && chmod 700 /srv/gct-backups
  LINHA="17 3 * * * cd $(pwd) && BACKUP_DIR=/srv/gct-backups infra/backup/backup.sh >> /srv/gct-backups/backup.log 2>&1"
  ( crontab -l 2>/dev/null | grep -v 'infra/backup/backup.sh'; echo "$LINHA" ) | crontab -
  ok "Agendado. Copie /srv/gct-backups para fora da VPS periodicamente (backup só no servidor não protege contra perda dele)."
fi

cat <<FIM

Pronto. Acesse https://${DOMINIO} e crie a conta do proprietário em /cadastro.
Comandos úteis (nesta pasta):
  Situação:   $C ps
  Logs:       $C logs --tail 50 web worker
  Parar:      $C stop            (nunca use "down -v": apaga banco e arquivos)
  Atualizar:  copie o código novo e rode de novo este script (dados e senhas são mantidos)
FIM
