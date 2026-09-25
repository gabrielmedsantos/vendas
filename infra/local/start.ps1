# Sobe o sistema completo no Windows com Docker Desktop.
# Uso, na raiz do repositório (PowerShell):  powershell -ExecutionPolicy Bypass -File infra\local\start.ps1
# Para parar sem apagar dados:  docker compose --env-file .env.production stop
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..\..')
$port = if ($env:PORT) { $env:PORT } else { '3000' }
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw 'Instale o Docker Desktop primeiro.' }

if (-not (Test-Path .env.production)) {
  $proj = if ($env:COMPOSE_PROJECT_NAME) { $env:COMPOSE_PROJECT_NAME } else { 'gct' }
  docker volume inspect "${proj}_db-data" *> $null
  if ($LASTEXITCODE -eq 0) { throw "Já existe um banco local (${proj}_db-data) mas não há .env.production. Restaure o arquivo anterior; nada foi alterado." }
  $lines = Get-Content .env.production.example | ForEach-Object {
    if ($_ -match '^(\w*PASSWORD|AUTH_SECRET)=$') { $_ + (-join ((1..24) | ForEach-Object { '{0:x2}' -f (Get-Random -Maximum 256) })) }
    elseif ($_ -match '^APP_URL=') { "APP_URL=http://localhost:$port" }
    elseif ($_ -match '^WEB_PORT=') { "WEB_PORT=$port" }
    elseif ($_ -match '^BILLING_ENVIRONMENT=') { 'BILLING_ENVIRONMENT=sandbox' }
    else { $_ }
  }
  [IO.File]::WriteAllLines((Join-Path (Get-Location) '.env.production'), $lines)
  Write-Host 'Criado .env.production (senhas aleatórias locais).'
}

docker compose --env-file .env.production build
if ($LASTEXITCODE) { throw 'Falha no build.' }
docker compose --env-file .env.production up -d --wait
if ($LASTEXITCODE) { throw 'Falha ao subir os serviços.' }
$demo = if ($env:DEMO_PASSWORD) { $env:DEMO_PASSWORD } else { 'demo-senha-local' }
docker compose --env-file .env.production run --rm -e SEED_PASSWORD=$demo worker node dist/seed-demo.js

Write-Host ""
Write-Host "Pronto: abra http://localhost:$port"
Write-Host "  Loja com celulares, trocas e crediário:  demo-celulares@example.test"
Write-Host "  Brechó:                                  demo-brecho@example.test"
Write-Host "  Senha dos dois:                          $demo"
Write-Host "Parar (mantendo os dados): docker compose --env-file .env.production stop"
