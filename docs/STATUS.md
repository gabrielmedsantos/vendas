# Status da implementação

Atualizado em 25/09/2026. Decisões em `docs/DECISOES.md`; operação em `docs/RUNBOOK.md`.

## Resumo
Fases 0–8 implementadas e testadas localmente. **Nada foi implantado na VPS** (inventário ainda não feito). Git: commits locais no branch `claude/new-session-z10cuu`; push bloqueado por falta de acesso do app GitHub ao repositório.

| Fase | Estado | Evidência |
|---|---|---|
| 0 Fundação | feito | monorepo pnpm, lint, typecheck, Compose, `docs/LEITURA_VISUAL.md` (16 VM, 16 FP, BR-01) |
| 1 Tenant/auth | feito | Better Auth + 2FA, empresas, convites, papéis, RLS forçado; T-001…T-003 |
| 2 Catálogo/pessoas | feito | produtos/variantes/serial/categorias/fotos/clientes/fornecedores |
| 3 Compras/estoque | feito | pedido, recebimento parcial idempotente, custo de aquisição, lotes FIFO, serial, inspeção, inventário |
| 4 Venda/pós-venda | feito | modalidades, parcelas, crediário, devolução parcial, cancelamento, crédito da loja; T-004…T-006, T-014, T-015 |
| 5 Troca/financeiro | feito | troca unificada com compensação; exemplos A/B/C; pagar/receber, caixa, taxas, despesas; T-007…T-013, T-016, T-017 |
| 6 Métricas/documentos | feito | dashboard, 13 relatórios, CSV, PDFs não fiscais (snapshot + hash), auditoria, onboarding; T-018 |
| 7 SaaS + VPS | feito (sem deploy) | planos/limites, `/plataforma` (2FA), faturas manuais, webhook HMAC (T-022), Dockerfile, compose, backup + teste de restauração, CI |
| 8 Catálogo/crescimento | feito | catálogo público + pedido pendente (T-020), ordens de serviço, garantia com termo da época, central de ajuda (conteúdo próprio), indicação com recompensa manual auditada |
| 9 Integrações | não iniciado | depende de gateway, fiscal e credenciais reais |

## Verificado de fato (comandos executados nesta sessão)
- `pnpm lint` — limpo. `pnpm -r run typecheck` — limpo.
- `pnpm test` — 28 testes unitários passando (dinheiro, rateio, troca, FIFO, parcelas, métricas, estados).
- `pnpm test:int` — 55 testes de integração passando em PostgreSQL real (suíte completa repetida 4× sem falha intermitente): isolamento/RLS (11), compra/venda/financeiro/devolução (18), troca (8), catálogo público (5), plataforma/webhook/indicação (7), pós-venda/ajuda/indicação (6).
- E2E Playwright (`tests/e2e/journey.spec.ts`, 9 etapas): cadastro → produtos → compra com IMEI → venda Pix → troca com diferença → crediário + recebimento parcial + devolução → relatório → ordem de serviço → central de ajuda. Passando.
- Visual (`tests/e2e/visual.spec.ts`): 8 telas × 4 larguras sem erro de console nem rolagem horizontal. `/plataforma` conferida em 1440 px e 390 px (com 2FA TOTP real).
- Seed de demonstração (`pnpm db:seed`): duas empresas fictícias; login do usuário demo e números do painel conferidos à mão (vendas R$ 3.917,70; CMV R$ 2.836,00; entradas de caixa R$ 2.737,90).
- Docker: `docker build --target web|worker` OK (≈74 MB cada, conteúdo); `docker compose up` com Postgres 17.6: migração 0001–0009 aplicada pelo job, web `healthy`, venda + foto + PDF gerado pelo worker, FS somente leitura.
- `infra/backup/backup.sh` + `infra/backup/restore-test.sh`: dump + arquivos + SHA256; restauração em banco temporário, contagens batem, RLS ativo, banco temporário removido.

## Não verificado / limitações conhecidas
- VPS: sem inventário, sem deploy. CI escrito, mas não executado no GitHub (push bloqueado).
- E-mail real e gateway de cobrança: não configurados (adaptadores prontos, desligados).
- BrikLucro: só a página pública (BR-01) foi vista; área interna não.
- Preços dos planos são provisórios (R$ 0 no piloto).

## Testar localmente com Docker
`bash infra/local/start.sh` (ou `infra\local\start.ps1` no Windows): gera `.env.production` local, sobe banco/migração/web/worker e cria as empresas demo (senha `demo-senha-local`). Verificado em clone limpo nesta sessão: login demo e painel sem erros de console.

## Como retomar
```bash
pnpm install
ADMIN_URL=postgres://postgres:postgres@localhost:5432/postgres DB_NAME=gct_dev infra/db/setup-local.sh
MIGRATION_DATABASE_URL=postgres://gct_owner:dev_owner@localhost:5432/gct_dev pnpm db:migrate
cp .env.example apps/web/.env.local   # ajustar senhas dev e AUTH_SECRET
pnpm dev            # web em :3000
pnpm worker         # outro terminal
pnpm test && pnpm test:int
```

## Próximos passos
1. Liberar acesso do app GitHub ao repositório → push do branch → acompanhar o CI (`.github/workflows/ci.yml`).
2. Quando autorizado: inventário da VPS (`docs/RUNBOOK.md` §1, via `prompts/03_PREPARAR_VPS.md`) e plano de instalação — sem deploy antes disso.
3. Definir preços reais dos planos, provedor de e-mail (SMTP) e gateway de cobrança; ligar em sandbox e validar (fase 9).
4. Referência BrikLucro: quando houver capturas da área interna, `prompts/04_ATUALIZAR_REFERENCIA_2.md`.
