# Gestão Compra e Troca

SaaS multiempresa para lojas que **compram, vendem e trocam** (celulares, eletrônicos, roupas, usados): estoque por lote e por número de série, troca com compensação de valores, contas a pagar e receber, caixa, lucro, relatórios, documentos em PDF, catálogo público e administração de assinaturas. Interface em português (pt-BR), valores em reais.

> Nome provisório. Estado atual, testes executados e próximos passos: [`docs/STATUS.md`](docs/STATUS.md).

## O que o sistema garante
- **Isolamento por empresa** no banco (RLS forçado, papéis sem `BYPASSRLS`), não só na interface.
- **Dinheiro em centavos inteiros**; histórico confirmado é imutável e corrigido por estorno vinculado.
- **Troca = venda + compra + compensação**: só a diferença movimenta caixa; o item recebido entra com o valor avaliado como custo.
- **Sem venda duplicada**: chaves de idempotência e bloqueio na disputa pela última unidade.
- Custos e lucro ficam ocultos para quem não tem permissão (inclusive pela API).

## Estrutura
| Pasta | Conteúdo |
|---|---|
| `apps/web` | Next.js 16 (interface + API `/api/v1`, rotas públicas do catálogo, webhook de cobrança) |
| `apps/worker` | fila (PDFs, exportações, avisos), rotinas de assinatura e reservas |
| `packages/domain` | regras puras (troca, FIFO, parcelas, métricas) com testes unitários |
| `packages/app` | casos de uso (transações, permissões, auditoria) |
| `packages/db` | migrações SQL, papéis, cliente Kysely |
| `tests` | integração em PostgreSQL real e E2E Playwright |
| `infra` | papéis do banco, init do Postgres, backup/restauração, Caddy |
| `docs` | plano, decisões (`DECISOES.md`), status, runbook de operação |

## Rodar localmente
Requisitos: Node 22.12+, pnpm 10, PostgreSQL 16+ com um superusuário local.
```bash
pnpm install
ADMIN_URL=postgres://postgres:postgres@localhost:5432/postgres DB_NAME=gct_dev infra/db/setup-local.sh
MIGRATION_DATABASE_URL=postgres://gct_owner:dev_owner@localhost:5432/gct_dev pnpm db:migrate
cp .env.example apps/web/.env.local     # troque SENHA pelas senhas dev e gere AUTH_SECRET (openssl rand -hex 32)
pnpm dev                                # http://localhost:3000
pnpm worker                             # em outro terminal (PDFs e rotinas)
SEED_PASSWORD='uma-senha-local' pnpm db:seed   # opcional: duas empresas fictícias
```

## Testes
```bash
pnpm lint && pnpm -r run typecheck
pnpm test          # unitários
pnpm test:int      # integração (recria o banco gct_test a cada execução)
cd tests && PW_CHROMIUM=/caminho/do/chromium npx playwright test   # E2E com o app rodando em :3000
```

## Produção
Imagens Docker (`Dockerfile`, alvos `web` e `worker`) e `compose.yaml` com banco privado, job de migração, healthchecks e backup. **Leia [`docs/RUNBOOK.md`](docs/RUNBOOK.md) antes de qualquer instalação**: começa pelo inventário da VPS e nunca apaga volumes.

Integrações externas (e-mail, gateway de cobrança) ficam desligadas até haver credenciais reais configuradas no servidor.
