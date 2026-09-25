# Testes e critérios de aceite

## Pirâmide

- Unitários rápidos para cálculos puros (centavos, rateio, custo, margem e estados).
- Integração com PostgreSQL verdadeiro para RLS, FK, transação, locks, migrações, concorrência e idempotência. SQLite não substitui esses testes.
- API para autenticação/permissão/validação e contrato de erros.
- E2E com Playwright em browser Chromium e banco isolado/reiniciado: cadastro → compra → recebimento → venda → troca → receber diferença → devolução parcial → relatório.
- Visual em Storybook/Playwright com screenshots FlowPay, pontos de quebra e teclado. Screenshots não substituem teste de lógica.

## Casos indispensáveis

| ID | Cenário | Esperado |
|---|---|---|
| T-001 | tenant A solicita produto de B | 404 genérico; nenhum vazamento/modificação |
| T-002 | tenant sem `app.tenant_id` consulta tabela RLS | nenhum registro visível e nenhuma escrita |
| T-003 | runtime comum tenta `SET row_security=off` ou bypass | negado; papel não tem privilégio elevado |
| T-004 | duas vendas em paralelo para última unidade | apenas uma confirmação, saldo nunca negativo |
| T-005 | receber novamente mesma compra/chave | mesma resposta, um movimento de estoque |
| T-006 | chave idempotente reutilizada com outro corpo | 409 e sem segunda venda |
| T-007 | Exemplo A, seção 4 do doc 02 | receita 4.000, CMV 3.000, lucro bruto 1.000, caixa +2.500, usado a custo 1.500 |
| T-008 | revenda por 2.000 após preparo real de 100 | custo 1.600 e lucro bruto 400 na revenda |
| T-009 | Exemplo B com pagamento da diferença | estoque recebido 2.500, dívida paga 500, caixa −500 |
| T-010 | Exemplo B com crédito da loja | passivo/crédito 500, caixa zero; uso posterior não gera nova receita |
| T-011 | Exemplo C troca equivalente | caixa zero, estoque recebido 1.800, CMV 1.200, lucro bruto 600 |
| T-012 | recebível parcial R$ 250 recebe R$ 100 | pendência correta de R$ 150; caixa +100 |
| T-013 | cartão de venda 1.000 com taxa 30, liquidação 970 | receita 1.000 uma vez, tarifa 30, caixa +970 |
| T-014 | devolução parcial de unidade/lote antigo | reverte preço e custo rateados da venda, estoque em inspeção |
| T-015 | cancelamento depois de recebimento | original intacto; estorno e reembolso rastreáveis |
| T-016 | troca com produto já revendido | não permite cancelamento simples nem mutação destrutiva |
| T-017 | saldo de título abaixo de zero por 2 baixas paralelas | uma baixa ganha; outra falha/recalcula; saldo nunca negativo |
| T-018 | PDF falha após commit de venda | venda segue válida; document job falha e reprocessa sem repetir efeito |
| T-019 | CSV tem célula `=HYPERLINK(...)` | export neutraliza fórmula sem corromper texto necessário |
| T-020 | produto público possui custo/IMEI privado | DTO de catálogo e HTML nunca contém esses campos |
| T-021 | vendedor solicita campo de custo por API | negado/omitido pelo servidor, não apenas pela UI |
| T-022 | callback/webhook duplicado ou fora de ordem | aplicado no máximo uma vez e reconcilia estado |
| T-023 | desconto não autorizado e limite excedido | recusa ou solicita aprovação registrada |
| T-024 | plano excede limite de usuários/itens por API direta | 403/409 de limite sem criar recurso |

## Reconciliadores de teste

Após cada cenário, reconciliar estoque físico/disponível/reservado vs ledger; lotes recebidos vs remanescente/alocado; saldo título vs original − alocações + reversões; conta vs soma de cash movements; crédito vs entradas − usos; trade vs venda/compra/offset/caixa; relatório vs fatos de referência. Zero diffs é o resultado esperado.

## Aceite de uma fase

Executar suites definidas na própria fase e guardar a saída resumida em `docs/STATUS.md`. Relatório informa comandos realmente rodados, quantidade de testes e eventuais skips justificados. Captura visual identifica tela/viewport e data; não usar imagem de outra referência como prova do sistema novo.
