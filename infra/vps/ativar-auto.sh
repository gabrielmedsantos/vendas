#!/usr/bin/env bash
# Liga a atualização automática na VPS (rodar uma vez, como root):
#   curl -fsSL https://raw.githubusercontent.com/gabrielmedsantos/vendas/claude/new-session-z10cuu/infra/vps/ativar-auto.sh | bash
# Aponta /srv/gct para o GitHub, instala o timer systemd (a cada 2 min) e faz a primeira atualização.
# Não mexe no Traefik, em outros containers nem em volumes. Senhas (.env.production) são mantidas.
{
set -euo pipefail
DIR="${GCT_DIR:-/srv/gct}"
RAMO="${GCT_RAMO:-claude/new-session-z10cuu}"
REPO="${GCT_REPO:-https://github.com/gabrielmedsantos/vendas.git}"
[ "$(id -u)" = 0 ] || { echo "Rode como root."; exit 1; }
[ -d "$DIR/.git" ] && [ -f "$DIR/.env.production" ] || { echo "Não encontrei a instalação em $DIR (.git e .env.production)."; exit 1; }
cd "$DIR"

echo "== 1. Ligando $DIR ao GitHub ($RAMO)"
if git remote get-url origin >/dev/null 2>&1; then git remote set-url origin "$REPO"; else git remote add origin "$REPO"; fi
git fetch -q origin "$RAMO" || { echo "Não consegui baixar do GitHub. Se o repositório for privado, configure uma deploy key antes."; exit 1; }
# Arquivos rastreados passam a ser exatamente os do GitHub (os pacotes aplicados à mão já estão lá).
# .env.production, compose.traefik.yaml e os dados não são rastreados e ficam intactos.
# reset --hard primeiro: sobrescreve também arquivos copiados à mão (ex.: traefik.sh) que agora são rastreados.
git reset -q --hard FETCH_HEAD
git checkout -q -B "$RAMO"
echo "   código em $(git rev-parse --short HEAD)"

echo "== 2. Instalando o timer (verifica a cada 2 minutos)"
cat > /etc/systemd/system/gct-atualizar.service <<UNIT
[Unit]
Description=Gestão Compra e Troca - atualização automática a partir do GitHub
After=docker.service network-online.target
Wants=network-online.target

[Service]
Type=oneshot
WorkingDirectory=$DIR
Environment=GCT_RAMO=$RAMO
ExecStart=/usr/bin/env bash $DIR/infra/vps/auto-atualizar.sh
Nice=10
TimeoutStartSec=45min
UNIT
cat > /etc/systemd/system/gct-atualizar.timer <<UNIT
[Unit]
Description=Verifica atualizações do Gestão Compra e Troca a cada 2 minutos

[Timer]
OnBootSec=3min
OnUnitActiveSec=2min
Unit=gct-atualizar.service

[Install]
WantedBy=timers.target
UNIT
systemctl daemon-reload
systemctl enable --now gct-atualizar.timer >/dev/null

echo "== 3. Backup diário (03:17), se ainda não houver"
mkdir -p /srv/gct-backups && chmod 700 /srv/gct-backups
if command -v crontab >/dev/null && ! crontab -l 2>/dev/null | grep -q infra/backup/backup.sh; then
  ( crontab -l 2>/dev/null; echo "17 3 * * * cd $DIR && BACKUP_DIR=/srv/gct-backups infra/backup/backup.sh >> /srv/gct-backups/backup.log 2>&1" ) | crontab -
  echo "   agendado"
else
  echo "   já existia (ou cron indisponível)"
fi

echo "== 4. Primeira atualização agora (backup + build + subida; alguns minutos)"
rm -f .deploy/falhou
if bash infra/vps/auto-atualizar.sh; then :; fi
tail -5 /var/log/gct-atualizar.log 2>/dev/null || true
echo
if grep -q "OK: " /var/log/gct-atualizar.log 2>/dev/null && [ -f .deploy/implantado ]; then
  echo "ATIVADO: versão $(cut -c1-12 .deploy/implantado) no ar. Próximas atualizações entram sozinhas."
else
  echo "ATENÇÃO: a primeira atualização não confirmou. Veja: tail -40 /var/log/gct-atualizar.log"
fi
echo "Ver situação: systemctl list-timers gct-atualizar.timer ; tail -f /var/log/gct-atualizar.log"
echo "Desligar:     systemctl disable --now gct-atualizar.timer"
exit 0
}
