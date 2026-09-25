# Decisões de arquitetura (ADR resumidos)

Formato: decisão · motivo · reversível? · como reverter. Datas em 25/09/2026 salvo indicação.

## ADR-001 — Monólito modular em monorepo pnpm
- `apps/web` (Next.js: UI + API REST `/api/v1`), `apps/worker` (outbox, PDFs, rotinas), `packages/shared` (dinheiro, datas, permissões), `packages/domain` (regras puras), `packages/db` (Kysely, migrações SQL, RLS), `packages/app` (casos de uso transacionais usados por web e worker), `tests` (integração/E2E), `infra` (Compose, Caddy, scripts).
- `packages/app` foi acrescentado à organização do CLAUDE.md para que web e worker compartilhem os mesmos casos de uso (o worker não reimplementa regras).
- Reversível: sim (pacotes podem ser separados em serviços).

## ADR-002 — Versões (verificadas no registro npm em 25/09/2026)
- Node 22 LTS (22.22 local; imagem `node:22.22-alpine`), pnpm 10.33, Next.js 16.3.6, React 19.3, TypeScript **5.9.3** (a tag `latest` já é 7.0, reescrita nativa; mantida 5.9 até Next/typescript-eslint confirmarem suporte), Kysely 0.29.6, pg 8.23, Better Auth 1.7.6, Zod 4.6, Vitest 4.1, Playwright 1.63, pdfkit 0.20, PostgreSQL 17.6 (Compose) — testes locais rodaram em PostgreSQL 16.13.
- Lockfile `pnpm-lock.yaml` versionado; imagens com tag de versão (trocar por digest no deploy).

## ADR-003 — Kysely + SQL explícito em vez de Prisma
- Motivo: o domínio depende de RLS forçado, `FOR UPDATE` em ordem canônica, `SKIP LOCKED`, FKs compostas `(tenant_id, id)`, índices parciais, políticas por papel e grants por coluna — tudo SQL manual mesmo com Prisma. Além disso, a tag `latest` do Prisma no npm apontava para `8.0.0-rc.17` (release candidate) no dia da verificação. Kysely dá SQL tipado sem esconder o SQL, e os tipos são gerados do banco real (`kysely-codegen`).
- Migrações: arquivos `packages/db/migrations/NNNN_*.sql`, aplicados em ordem por runner próprio com advisory lock, transação por arquivo e checksum (arquivo aplicado não pode mudar).
- Reversível: sim, com custo (reescrever repositórios). O schema SQL continua válido.

## ADR-004 — Papéis PostgreSQL e RLS sem BYPASSRLS
| Papel | Uso | Acesso |
|---|---|---|
| `gct_owner` | migrações, dono das tabelas | sujeito a FORCE RLS |
| `gct_app` | runtime empresarial | RLS por `app.tenant_id`; sem UPDATE/DELETE em livros (movimentos de estoque, caixa, liquidações, auditoria) |
| `gct_auth` | Better Auth | apenas tabelas de identidade |
| `gct_platform` | control plane (criar empresa, assinaturas, outbox, expiração de reservas) | políticas `to gct_platform` só nessas tabelas; não lê vendas/estoque |
| `gct_public` | catálogo público | colunas publicáveis por GRANT de coluna + política restritiva "só itens de catálogo publicado" |
- Nenhum papel é superuser nem BYPASSRLS. Contexto via `set_config('app.tenant_id', …, true)` local à transação.

## ADR-005 — Autenticação: Better Auth 1.7.6
- E-mail/senha com hash da biblioteca, sessões em banco revogáveis, cookies HttpOnly; plugin 2FA (TOTP) para administradores da plataforma. Schema gerado pela própria biblioteca (`getMigrations`) e versionado na migração 0001.
- Empresas, membros, papéis e convites são próprios (não usamos o plugin de organização) para manter RLS e permissões granulares sob nosso controle.
- Empresa selecionada vem de cookie, **sempre** revalidada contra membership ativa no servidor.

## ADR-006 — Dinheiro e datas
- `bigint` centavos no banco → `BigInt` no Node (parser do pg) → string decimal na API. Percentuais em bps. Half-up e maior resto em `packages/shared`.
- `date` do Postgres volta como `'AAAA-MM-DD'` (sem fuso implícito). Datas de negócio locais no fuso da empresa.

## ADR-007 — Troca = venda + compra + compensação
- Venda com pagamento `trade_offset` de min(S,P) + diferença; compra vinculada com títulos a pagar; `offsets` com alocações nos dois títulos (mesma pessoa, direções opostas, trigger). Caixa só na diferença. D<0: conta a pagar (padrão) ou pagar agora ou crédito de loja (explícito).
- Reversão bloqueada se item recebido foi vendido/consumido/recebeu custo adicional.

## ADR-008 — Reconhecimento de taxas
- Taxa esperada congelada em `sale_payments` na confirmação (margem projetada). Taxa **realizada** entra no resultado pela liquidação (`settlements.fee_cents`): título baixado pelo bruto, banco recebe líquido. Evita contar a taxa duas vezes.

## ADR-009 — Ajustes de saldo de título
- Tabela `title_adjustments` registra reduções sem dinheiro (devolução, cancelamento, perdão). Saldo do título é sempre reconciliável: original − liquidações − compensações − créditos usados − ajustes (+ estornos).

## ADR-010 — Fila PostgreSQL (outbox)
- `outbox_events` gravado na mesma transação; worker reivindica com `FOR UPDATE SKIP LOCKED`, lease de 2 min, backoff exponencial com jitter, dead letter após 8 tentativas. Sem Redis.

## ADR-011 — Documentos
- Snapshot congelado na transação (sem custo/margem), numeração por empresa/tipo, versão do modelo, hash SHA-256 do PDF. PDF gerado pelo worker (pdfkit, fonte Helvetica embutida). Falha no PDF não desfaz a operação. "Documento comercial sem valor fiscal".

## ADR-012 — Integrações desligadas por padrão
- E-mail: `DisabledMailer` sem `SMTP_URL` (links de convite aparecem para o dono copiar). Cobrança SaaS: provedor `manual` (operador registra pagamento); nenhum checkout falso. Webhook genérico com assinatura HMAC pronto para o gateway escolhido. Armazenamento: volume privado local; interface compatível com S3.

## ADR-013 — Planos provisórios
- Migração 0007 cria `piloto` (trial 14 dias, limites amplos) e `gratuito` (limites reduzidos), ambos com preço 0 e rotulados como provisórios. Valores comerciais reais são configurados no painel da plataforma.

## ADR-014 — Paginação
- Cursor opaco (offset codificado) com ordenação estável campo+id; limite 25 padrão, 100 máximo. Keyset pode substituir sem mudar o contrato.

## ADR-015 — Estoque
- FIFO por lote para quantidade; custo específico por unidade (lote de 1) para serializado. Entrada de troca vai para inspeção por padrão. Devolução volta ao custo histórico em inspeção. Perda gera despesa `inventory_loss` na competência.

## ADR-016 — Catálogo público por papel próprio
Rotas públicas (`/c/[slug]`, `/api/public/catalog/*`) usam o papel `gct_public`, com GRANT por coluna (sem custo, IMEI, fornecedor) e policy restritiva que só expõe itens de catálogo publicado. O DTO é montado por allowlist explícita. Pedido público entra como pendente, com preço congelado, e **não** reserva estoque até o operador confirmar. Reversível: basta despublicar.

## ADR-017 — Imagens
Upload validado por conteúdo (sharp), convertido para WebP, metadados (EXIF/GPS) removidos, até 5 MB e 10 por produto, em armazenamento local privado (volume). Servidas só por rota autenticada ou, se o produto estiver em catálogo publicado, pela rota pública. Troca para S3 compatível fica atrás da interface `Storage`.

## ADR-018 — Administração da plataforma e cobrança
Acesso à `/plataforma` exige registro em `platform_admins` (concedido por CLI com papel dono) **e** 2FA ativo. Toda ação exige motivo e grava `platform_audit`; o painel não lê dados operacionais das empresas. Planos são versionados (nova versão não altera assinaturas existentes). Cobrança do piloto é manual (fatura + registro de pagamento); webhook genérico com HMAC sobre o corpo bruto, janela de 5 min, ambiente esperado e idempotência por id do provedor fica pronto e desligado até existir segredo. Evento "pago" de um período prevalece sobre "falhou" que chegue depois.

## ADR-019 — Empacotamento e implantação
Uma `Dockerfile` com alvos `web` (Next standalone) e `worker` (bundle esbuild; `@gct/*` embutidos, dependências externas declaradas no pacote do worker). O mesmo alvo `worker` executa migrações como job único antes de web/worker. Banco sem porta publicada; web publicada só em loopback para o proxy existente; Caddy opcional por perfil. Imagens base fixadas por digest. Nada é implantado sem inventário da VPS (docs/RUNBOOK.md).

## ADR-020 — Ordem das alocações de custo
UUID aleatório não serve para ordenar. `sale_cost_allocations.seq` (identity) define a ordem; devolução reverte da última alocação para a primeira. Encontrado por teste intermitente (T-014).
