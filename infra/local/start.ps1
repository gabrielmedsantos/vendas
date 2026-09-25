# Sobe o sistema completo no Windows com Docker Desktop.
# Uso, na raiz do repositorio (PowerShell):
#   powershell -ExecutionPolicy Bypass -File infra\local\start.ps1
# Parar sem apagar dados:  docker compose --env-file .env.production stop
# (Arquivo somente ASCII de proposito: Windows PowerShell 5.1 le .ps1 sem BOM como ANSI.)

# 'Continue': no PowerShell 5.1, mensagens normais do Docker no stderr virariam erro com 'Stop'.
$ErrorActionPreference = 'Continue'
Set-Location (Join-Path $PSScriptRoot '..\..')
$port = if ($env:PORT) { $env:PORT } else { '3380' }

function Fail($msg) { Write-Host ""; Write-Host "ERRO: $msg" -ForegroundColor Red; exit 1 }
function WriteLf($path, $lines) { [IO.File]::WriteAllText($path, (($lines -join "`n") + "`n")) }
function ToLf($path) {
  $full = Join-Path (Get-Location) $path
  $text = [IO.File]::ReadAllText($full)
  if ($text.Contains("`r")) { [IO.File]::WriteAllText($full, $text.Replace("`r`n", "`n")); Write-Host "Ajustado fim de linha (CRLF -> LF): $path" }
}

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { Fail 'Docker nao encontrado. Instale o Docker Desktop e abra-o antes de rodar.' }
docker info *> $null
if ($LASTEXITCODE -ne 0) { Fail 'O Docker Desktop nao esta rodando. Abra o Docker Desktop, espere ficar "running" e rode de novo.' }

# Arquivos usados dentro dos containers Linux: o Git no Windows pode ter convertido para CRLF.
foreach ($f in @('infra\db\initdb\10-gct-roles.sh', 'infra\db\roles.sql', 'infra\caddy\Caddyfile', '.env.production.example')) { ToLf $f }

# Porta ocupada por outro programa (ex.: outro sistema em localhost:3000)?
if (Test-Path .env.production) { docker compose --env-file .env.production stop web *> $null }
function PortBusy($p) {
  foreach ($h in @('127.0.0.1', '::1')) {
    $c = New-Object Net.Sockets.TcpClient
    try { if ($c.ConnectAsync($h, [int]$p).Wait(700)) { return $true } } catch {} finally { $c.Dispose() }
  }
  return $false
}
if (PortBusy $port) {
  $who = ''
  if (Get-Command Get-NetTCPConnection -ErrorAction SilentlyContinue) {
    $who = (Get-NetTCPConnection -State Listen -LocalPort ([int]$port) -ErrorAction SilentlyContinue | ForEach-Object { (Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue).ProcessName } | Select-Object -Unique) -join ', '
  }
  Fail "A porta $port ja esta em uso por outro programa ($who). Rode de novo com outra porta:  `$env:PORT='3480'; powershell -ExecutionPolicy Bypass -File infra\local\start.ps1"
}

$proj = if ($env:COMPOSE_PROJECT_NAME) { $env:COMPOSE_PROJECT_NAME } else { 'gct' }
if (-not (Test-Path .env.production)) {
  docker volume inspect "${proj}_db-data" *> $null
  if ($LASTEXITCODE -eq 0) { Fail "Ja existe um banco local (${proj}_db-data) mas nao ha .env.production nesta pasta. Rode o script na pasta onde ele foi criado da primeira vez." }
  $lines = Get-Content .env.production.example | ForEach-Object {
    if ($_ -match '^(\w*PASSWORD|AUTH_SECRET)=$') { $_ + (-join ((1..24) | ForEach-Object { '{0:x2}' -f (Get-Random -Maximum 256) })) }
    elseif ($_ -match '^BILLING_ENVIRONMENT=') { 'BILLING_ENVIRONMENT=sandbox' }
    else { $_ }
  }
  WriteLf (Join-Path (Get-Location) '.env.production') $lines
  Write-Host 'Criado .env.production (senhas aleatorias locais).'
}

# Endereco/porta nao sao segredo: mantem .env.production alinhado com a porta escolhida.
$envLines = Get-Content .env.production | ForEach-Object {
  if ($_ -match '^APP_URL=') { "APP_URL=http://localhost:$port" } elseif ($_ -match '^WEB_PORT=') { "WEB_PORT=$port" } else { $_ }
}
WriteLf (Join-Path (Get-Location) '.env.production') $envLines

if ($env:SKIP_BUILD -ne '1') {
  Write-Host 'Construindo as imagens (a primeira vez leva alguns minutos)...'
  docker compose --env-file .env.production build
  if ($LASTEXITCODE -ne 0) { Fail 'Falha no build das imagens. Copie as ultimas linhas acima e envie.' }
}

docker compose --env-file .env.production up -d --wait
if ($LASTEXITCODE -ne 0) {
  Write-Host ""
  Write-Host '--- Situacao dos servicos ---'
  docker compose --env-file .env.production ps -a
  Write-Host '--- Ultimas linhas do banco e da migracao ---'
  docker compose --env-file .env.production logs --tail 25 db migrate
  $mig = (docker compose --env-file .env.production logs migrate 2>&1) -join "`n"
  if ($mig -match 'password authentication failed|role "gct_\w+" does not exist|database "\w+" does not exist') {
    Write-Host ""
    Write-Host "O banco local foi criado numa tentativa anterior que falhou (sem os usuarios do sistema)." -ForegroundColor Yellow
    Write-Host "Ele so tem dados de teste. Para recria-lo do zero (APAGA esse banco local de teste):" -ForegroundColor Yellow
    Write-Host "  docker compose --env-file .env.production down -v" -ForegroundColor Yellow
    Write-Host "e depois rode este script de novo." -ForegroundColor Yellow
  }
  Fail 'Os servicos nao ficaram prontos. Envie as linhas acima para diagnostico.'
}

$demo = if ($env:DEMO_PASSWORD) { $env:DEMO_PASSWORD } else { 'demo-senha-local' }
docker compose --env-file .env.production run --rm -e SEED_PASSWORD=$demo worker node dist/seed-demo.js

try { $code = (Invoke-WebRequest -UseBasicParsing -TimeoutSec 10 "http://127.0.0.1:$port/healthz").StatusCode } catch { $code = $_.Exception.Message }
Write-Host ""
Write-Host "Teste interno: http://127.0.0.1:$port/healthz -> $code"
Write-Host "Pronto: abra http://localhost:$port" -ForegroundColor Green
Write-Host "  Loja com celulares, trocas e crediario:  demo-celulares@example.test"
Write-Host "  Brecho:                                  demo-brecho@example.test"
Write-Host "  Senha dos dois:                          $demo"
Write-Host "Parar (mantendo os dados): docker compose --env-file .env.production stop"
