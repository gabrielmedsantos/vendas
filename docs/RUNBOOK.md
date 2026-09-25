# Runbook de operação — Gestão Compra e Troca

> **Estado: nenhuma implantação foi feita.** A VPS ainda não foi inspecionada. Este runbook foi testado
> localmente com Docker (build, subida, migração, venda, PDF, backup e teste de restauração), não em servidor real.

## 0. Regras que não mudam

- Nunca: `docker compose down -v`, `docker system prune --volumes`, `DROP`/`TRUNCATE`, restore sobre o banco em uso,
  editar migração já aplicada. `down` sem `-v` preserva volumes; mesmo assim prefira `stop`.
- Segredos só no `.env.production` **da VPS** (`chmod 600`, dono = usuário do deploy). Nunca em Git, imagem, log ou chat.
- Antes de qualquer release: backup sob demanda + `restore-test.sh` OK.

## 1. Inventário da VPS (fazer ANTES de instalar qualquer coisa)

Executar via SSH já configurado, sem `sudo` quando não for necessário, e **anotar** as respostas:

```bash
uname -m; cat /etc/os-release | head -3          # arquitetura (amd64/arm64) e SO
nproc; free -h; df -h /                           # CPU, RAM, disco livre (mínimo sugerido: 2 vCPU, 2 GB RAM, 20 GB livres)
docker version --format '{{.Server.Version}}'; docker compose version
sudo ss -ltnp | grep -E ':(80|443|3000|5432)\b'  # o que já escuta nessas portas
docker ps --format '{{.Names}}\t{{.Image}}\t{{.Ports}}'
systemctl is-active nginx caddy traefik apache2 2>/dev/null
sudo ufw status 2>/dev/null || sudo nft list ruleset | head
```

Decisões a partir do inventário:

| Situação encontrada | Ação |
|---|---|
| Nginx/Traefik/Caddy/painel já termina TLS | **Não** usar o perfil `caddy`. Criar um site/rota apontando para `127.0.0.1:${WEB_PORT}` e testar. |
| Nada nas portas 80/443 | Pode usar `--profile caddy` (certificado automático; exige DNS apontado). |
| Porta 3000 ocupada | Definir `WEB_PORT` livre no `.env.production`. |
| Já existe PostgreSQL no host | Não mexer nele. O compose sobe um Postgres próprio sem porta publicada. |
| < 2 GB RAM | Build fora da VPS (CI) e só `pull` na VPS; ou limitar `DB_POOL_MAX`. |

## 2. Instalação automatizada (recomendada)

Na VPS, com o código na pasta `/srv/gct`:
```bash
bash infra/vps/instalar.sh --dominio seu.dominio.com.br
```
O script faz o inventário da seção 1 (só leitura), mostra o plano e pede confirmação; gera `.env.production`
com segredos criados no próprio servidor (0600); usa o Caddy do projeto **apenas** se 80/443 estiverem livres
(senão gera `infra/vps/gerado/nginx-<domínio>.conf` e mostra como ligar no proxy existente, sem alterá-lo);
compila, sobe, verifica e oferece agendar backup diário. Rodar de novo atualiza mantendo senhas e dados.
`--demo` cria as empresas fictícias (senha aleatória exibida no fim).

Testado em contêiner (2026-09-25): instalação nova com Caddy (HTTPS e login com cookie `Secure`), segunda
execução preservando dados, e servidor com a porta 80 já ocupada (modo proxy externo). Não testado ainda na VPS real.

## 2b. Primeira instalação manual

```bash
git clone <repo> /srv/gct && cd /srv/gct
cp .env.production.example .env.production && chmod 600 .env.production
# Preencher: senhas com `openssl rand -hex 32` (hex: entram em URLs), AUTH_SECRET, APP_URL/APP_DOMAIN.
docker compose --env-file .env.production build
docker compose --env-file .env.production up -d        # db → migrate (job único) → web + worker
docker compose --env-file .env.production ps           # migrate: Exited (0); web: healthy
curl -fsS http://127.0.0.1:${WEB_PORT:-3000}/readyz
```

Pós-instalação:
1. Criar a conta do operador em `/cadastro`, ativar 2FA em Configurações › Plano e segurança.
2. Conceder administração da plataforma (usa o papel dono do banco, dentro da rede interna):
   `docker compose --env-file .env.production run --rm migrate node dist/platform-admin.js email@dominio admin`
3. Acessar `/plataforma`; revisar planos (preços do piloto são provisórios).
4. Rodar backup + teste de restauração (seção 4) e registrar.
5. E-mail (SMTP) e webhook de cobrança continuam **desligados** até haver credenciais reais verificadas em sandbox.

## 3. Release e rollback

```bash
cd /srv/gct
grep APP_VERSION .env.production                         # anotar versão vigente (rollback)
BACKUP_DIR=/srv/gct-backups infra/backup/backup.sh        # backup sob demanda
infra/backup/restore-test.sh /srv/gct-backups/<carimbo>   # prova de leitura
git fetch && git checkout <sha-da-release>
sed -i "s/^APP_VERSION=.*/APP_VERSION=<sha-curto>/" .env.production
docker compose --env-file .env.production build
docker compose --env-file .env.production up -d           # migrate roda antes; web só sobe se migrate der 0
docker compose --env-file .env.production ps && curl -fsS http://127.0.0.1:${WEB_PORT:-3000}/readyz
```

Verificar: login, abrir dashboard, criar venda em empresa de teste, PDF gerado, logs sem erro
(`docker compose logs --since 10m web worker`).

**Rollback de aplicação** (migrações são aditivas, então código anterior continua compatível):
`APP_VERSION=<anterior>` + `git checkout <sha-anterior>` + `docker compose ... up -d`. Imagens antigas ficam
no host enquanto não forem removidas manualmente — não rodar prune durante a janela de release.

Se código incompatível já gravou dados errados: **não** tentar resolver com rollback de container. Parar escrita
(`docker compose stop web worker`), preservar o volume, avaliar com o backup e um restore isolado.

## 4. Backup e restauração

- `infra/backup/backup.sh`: `pg_dump` formato custom + tar dos arquivos + manifesto + SHA256; teste de leitura do dump.
  Com `AGE_RECIPIENT` definido, criptografa com [age](https://age-encryption.org) antes de sair da VPS.
- Agendar (usuário do deploy): `17 3 * * * cd /srv/gct && BACKUP_DIR=/srv/gct-backups AGE_RECIPIENT=age1... infra/backup/backup.sh >> /srv/gct-backups/backup.log 2>&1`
- Cópia para fora da VPS (obrigatória): `rclone`/`rsync` do diretório criptografado para armazenamento externo,
  com retenção 14 diárias / 8 semanais / 6 mensais (ajustável). RPO inicial 24 h; RTO alvo < 8 h.
- **Mensal:** `infra/backup/restore-test.sh <dir>` restaura em banco temporário, confere contagens e RLS, e apaga
  o banco temporário. Registrar data, duração, checksum e resultado.

Restauração de desastre (somente com janela aprovada): parar `web`/`worker`, restaurar em banco **novo**
(`pg_restore -d gct_novo`), validar, então apontar `DB_NAME` para ele e subir. O banco antigo fica preservado
até a validação terminar.

Medido localmente (2026-09-25, base de teste pequena): backup ~2 s, restore-test 3 s.

## 5. Monitoramento mínimo

- `/healthz` (processo vivo) e `/readyz` (banco acessível) — sem versão ou detalhes.
- `/plataforma` › Visão geral: fila pendente, eventos em falha (dead letter), webhooks com erro, assinaturas.
- Logs JSON com rotação (10 MB × 5 por serviço). Worker registra `eventos em dead letter`.
- Disco: `df -h` e `docker system df` (apenas leitura). Certificado: data de expiração no proxy.

## 6. Integrações desligadas por padrão

| Integração | Como ligar | Estado |
|---|---|---|
| E-mail | `SMTP_URL`, `SMTP_FROM` | desligado — convites e redefinição mostram link na tela para o dono |
| Webhook de cobrança | `BILLING_WEBHOOK_SECRET`, `BILLING_PROVIDER`, `BILLING_ENVIRONMENT` | desligado — cobrança manual em `/plataforma` › Faturas |
| Gateway de pagamento | adaptador a escrever quando o gateway for escolhido | não implementado |

Contrato do webhook genérico: `POST /api/webhooks/billing`, cabeçalhos `x-gct-timestamp` (epoch s) e
`x-gct-signature` = hex(HMAC-SHA256(segredo, `${timestamp}.${corpo}`)); janela de 5 min; corpo
`{"id","type":"invoice.paid|invoice.payment_failed|subscription.canceled","environment","data":{"tenantId","periodStart","periodEnd","amountCents"}}`.
