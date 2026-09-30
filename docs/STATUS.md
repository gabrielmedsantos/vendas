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

## Produção (piloto) — instalado em 25/09/2026
- URL: https://lucromax.alfamaxdigital.com.br · VPS 76.13.166.123 · código em `/srv/gct` (clone do branch `claude/new-session-z10cuu`).
- A VPS é compartilhada com outros sistemas (n8n, Água Clara, alfamax, gerador de sites `bm-site-gen` etc.).
  As portas 80/443 são do Traefik `n8n-traefik-1`; este sistema é publicado por ele via `compose.traefik.yaml`
  (gerado por `infra/vps/traefik.sh`, com `priority=10000` para vencer a regra pega-tudo `*.alfamaxdigital.com.br`).
- Segredos só em `/srv/gct/.env.production` (0600). Nunca commitar.
- Comandos na VPS (em `/srv/gct`): `docker compose --env-file .env.production -f compose.yaml -f compose.traefik.yaml ps|logs|up -d`.
  Nunca `down -v`, nunca mexer no Traefik nem nos containers de outros sistemas.
- **Atualização automática (GitHub → VPS):** repositório `github.com/gabrielmedsantos/vendas`, branch `claude/new-session-z10cuu`.
  Ativar uma vez na VPS (root): `curl -fsSL https://raw.githubusercontent.com/gabrielmedsantos/vendas/claude/new-session-z10cuu/infra/vps/ativar-auto.sh | bash`.
  Isso aponta `/srv/gct` para o GitHub, instala `gct-atualizar.timer` (a cada 2 min), agenda o backup diário (03:17, `/srv/gct-backups`) e faz a primeira atualização.
  A cada commit novo, `infra/vps/auto-atualizar.sh` faz: backup → código novo → build com imagens marcadas pelo commit (`APP_VERSION`) → `up -d --wait`.
  Build falhou: versão no ar mantida. Subida falhou: rollback automático para a versão anterior. Commit que falhou não é tentado de novo; o próximo commit é.
  Log: `/var/log/gct-atualizar.log`; estado em `/srv/gct/.deploy/`. Desligar: `systemctl disable --now gct-atualizar.timer`.
  Testado em réplica local com docker simulado (sucesso, sem novidade, rollback, build quebrado, correção seguinte). Ativação na VPS real: pendente de o usuário rodar o comando.
- Repositório GitHub está **público**: recomendado torná-lo privado; nesse caso a VPS precisa de uma deploy key (somente leitura) para o `git fetch`.
- Pendente: cópia externa dos backups; remover a chave `claude-sessao-gct` de `/root/.ssh/authorized_keys` (não é usada).
- Modelos de contrato (Word/PDF) em `docs/modelos/`: compra ou troca (do usuário), venda e termo de garantia de 3 meses.
- Anúncios: botão "Anunciar" no produto gera título, descrição curta e completa (`packages/shared/src/listing.ts`); padrão da empresa em `tenants.settings.listing` (novo, 3 meses de garantia, entrega na cidade da empresa, 12x no cartão). Publicação no Marketplace é manual, na conta do usuário (sem automação de contas).
- Encarte digital: Catálogo → aba "Encarte digital" (`components/flyer/`, `packages/shared/src/flyer.ts`, `packages/app/src/flyer.ts`). Usa produtos ativos com saldo disponível (`GET flyer/products`, sem custo), logo da empresa (`POST/DELETE tenant/logo`, `settings.brandLogoId`), cores `settings.brandColors` (tiradas da logo no navegador, ajustáveis) e textos `settings.flyer`. Páginas 1080×1350; exporta PNG (modern-screenshot 4.7.0), PDF (jspdf 4.2.1) e compartilhamento nativo. Testes: `tests/integration/flyer.test.ts`, `tests/e2e/flyer.spec.ts`.
- Contrato de venda: botão "Gerar contrato de venda" na venda confirmada (doc_type `sale_contract`, modelo contrato-venda@1, PDF em `packages/app/src/pdf.ts`). "Enviar ao cliente" em qualquer documento pronto: link público `/d/<token>` válido 30 dias (tabela `document_shares`, só o hash do token no banco; papel público só lê documento com link válido), WhatsApp (wa.me) e compartilhamento do PDF. Migração 0012 (aditiva). Testes: `tests/integration/contract.test.ts` e jornada E2E.
- Conta única: empresa nova nasce só com "Conta da loja" (tipo banco; dinheiro, Pix e cartões entram nela). Empresas antigas: Financeiro → "Unificar contas" (`unifyAccounts`): saldo das outras vai por transferência interna, formas de pagamento passam para a conta escolhida, outras arquivadas (histórico preservado). Abrir/fechar caixa só existe em conta do tipo caixa; quem quiser pode criar uma em "Nova conta".
- Ajustar saldo (`adjustAccountBalance`, origin_type `balance_adjustment`, fora da receita e do caixa do período) e "De onde vem o saldo" (`balanceBreakdown`): entradas/saídas por tipo (vendas recebidas, compras pagas, despesas pagas, aportes, ajustes…), a pagar/receber em aberto e estoque a custo.
- Correções sem apagar histórico: excluir/corrigir despesa paga (estorna o pagamento; `reverseTitlePayments`), estornar compra recebida sem itens vendidos (`cancelPurchase` → estoque sai por `stockOutWholeLot`, pagamentos estornados), estornar lançamento manual (`reverseCashMovement`), excluir produto nunca usado (`deleteProduct`, migração 0013 só concede DELETE em products/product_variants).
- Vídeo animado 9:16 (1080×1920, 30 fps) na aba Encarte digital: `components/flyer/video-render.ts` (desenho em canvas, determinístico), `video-encode.ts` (Mediabunny 1.61.0, MPL-2.0; H.264 quando o navegador suporta, senão VP9/AV1 em MP4), linha do tempo em `packages/shared/src/flyer-video.ts`. Sem áudio.
- Narração do vídeo: serviço interno `tts` (compose, rede interna, sem porta; `infra/tts/`: Kokoro-82M pesos Apache-2.0 via kokoro-onnx MIT, fonemas espeak-ng/phonemizer GPL-3 em processo separado; modelo baixado no build e conferido por SHA-256). Vozes pt-BR: pf_dora (padrão), pm_alex, pm_santa. Rota `POST flyer/narration` (catalog.manage) → WAV; o navegador junta ao MP4 (AAC/Opus). Vozes Piper pt-BR descartadas: derivadas de bases com licença não comercial. TTS_URL=http://tts:8000.
- Narração estilo comercial (padrão): o texto é preparado em `packages/shared/src/narration.ts` (R$/12x/%/GB viram palavras; frases curtas com "!"), o serviço de voz fala frase a frase a 1,12×, corta pausas > 160 ms e nivela o volume (compressão 3:1, RMS −16 dBFS, limitador −0,4 dBFS). Estilo natural continua disponível. Trilha de fundo animada (120 BPM) sintetizada no navegador (`apps/web/src/components/flyer/music.ts`), sem arquivo de música de terceiros; abaixa ~72% enquanto a voz fala. "Ouvir" toca a mesma mixagem do vídeo. Medido no MP4 do E2E: voz −17 dB, trilha sozinha −25 dB, pico 0,85.

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

## Anúncio: várias versões do texto
- `buildListing({ version })` em `packages/shared/src/listing.ts`: versão 0 = texto clássico (inalterado); 1, 2, 3… sorteiam de forma determinística (produto + versão) título, abertura, frases de cada item, emojis, ordem dos blocos e chamada final, mantendo as mesmas informações (preço, garantia, entrega, cartão, frase de confiança). Botões "Gerar outra versão" e "Anterior" no modal Anunciar. Testes: unidade (7 versões distintas com as mesmas informações) e jornada E2E.
