# Execução e backlog completo

Claude Code trabalha em fatias verticais: banco/migração → domínio → API → interface → teste, atualizando `docs/STATUS.md`. Cada gate impede acumular módulos de fachada. Estimativas não são promessa de calendário: dependem de experiência, VPS e definições comerciais.

| Fase | Resultado funcional | Gate mínimo |
|---|---|---|
| 0 — Descoberta/fundação | inspeção repo, ADR stack, Node/DB, lint, teste e Compose local | build reproduzível e `docs/LEITURA_VISUAL.md` com as imagens lidas |
| 1 — Tenant/auth | cadastro, empresa, sessão, membros, papéis e RLS | teste automatizado duas empresas cruzadas; policy default deny |
| 2 — Catálogo/pessoas | produtos, variantes, serial, fotos, categorias, clientes/fornecedores | CRUD autorizado; snapshots imutáveis; estados mobile |
| 3 — Compras/estoque | pedido, recebimento parcial, custo de aquisição, lotes, serial, ledger, inventário | conciliação de quantidades/custos; sem duplicar recebimento |
| 4 — Venda/pós-venda | venda/entrega, modalidades, parcelas, alocação FIFO/específica, devolução e crédito | corrida pela última unidade, venda à vista/prazo e retorno histórico corretos |
| 5 — Troca/financeiro | operação unificada, offset, pagar/receber, caixa, taxas, despesas, fluxo | três exemplos numéricos do doc 02; nenhum saldo incorreto em falha |
| 6 — Métricas/documentos | dashboard, relatórios, PDF/CSV, auditoria, onboarding | mesmas fórmulas no dashboard/API/exportação; PDF não fiscal |
| 7 — SaaS + VPS piloto | plano/limites, subscription adapter, painel operador, deploy, observabilidade e restore | produção piloto apenas após inventário VPS, backup/restauração e rollback validados |
| 8 — Catálogo e crescimento | catálogo público, preview, eventos, pedido pendente, serviços, ajuda/indicação | allowlist de dados públicos e autorização por tenant |
| 9 — Integrações/escala | pagamento de assinatura real, fiscal, S3/mensageria/assinatura, BI avançado | sandbox real validado; reconciliação; plano de falha e suporte |

## Fase 0 — descoberta e setup

Abrir arquivos visuais FlowPay 16 e VendaMax 16; revisar docs, stack e compatibilidade; mapear repositório e `AGENTS.md`; decidir estrutura. Desenhar o protótipo navegável FlowPay para Dashboard, Produto, Compra, Venda, Troca e Relatórios com dados marcados como fictícios em Storybook/teste. Documentar decisões e perguntas pendentes.

## Iterações por domínio

Para cada fase, iniciar com um fluxo principal e fixture independente; criar migração segura; regra pura com unidade; integração no PostgreSQL com RLS; endpoints com permission testing; tela com loading/erro/vazio/sucesso; teste ponta a ponta; captura visual em desktop e mobile; atualizar README/status. Demonstrar a funcionalidade real em ambiente local antes de marcar feita.

## Definition of done

- Linter, typecheck, build, testes unitários/integrados e E2E definidos para o escopo passam.
- Migration sobe em banco vazio e numa cópia representativa; constraint/RLS conferida; caminho de rollback operacional documentado.
- Campos validados no servidor; acesso autorizado em frontend e API; IDs de outro tenant dão resposta não reveladora.
- Saldos e indicadores conciliam com ledger; confirmação repetida idempotente; auditoria e origem aparecem.
- Desktop/mobile verificados; documentação e `.env.example` atualizados sem segredos.
- Recursos não implementados estão rotulados “em breve” sem CTA falso ou escondidos até prontos.

## Ordem de prompts de continuação

Enviar `prompts/02_CONTINUAR.md` e nomear fase/ID ainda aberta em `docs/STATUS.md`. Ao final da fase 7, usar `prompts/03_PREPARAR_VPS.md`; o prompt orienta apenas preparar/checar a instalação, nunca migrar produção sem análise e backup. Após conseguir telas do BrikLucro, `prompts/04_ATUALIZAR_REFERENCIA_2.md` adiciona evidência e reconcilia o backlog, preservando FlowPay como visual principal.
