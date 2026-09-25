# API, transações e eventos

Contrato orientativo para versão `/api/v1`; Claude deve optar por REST consistente ou Server Actions tipadas, mas preservar validações, autorização e operações idempotentes. Não expor diretamente schema do ORM.

## Envelope e validação

JSON pt-BR para rótulos, identificadores snake_case ou camelCase de forma consistente em toda a aplicação. Datas ISO 8601; dinheiro em strings de centavos inteiros. Lista: `{ data, meta: { cursor, has_more } }`. Erro `{ error: { code, message, fields?, request_id } }`; mensagens sem stack/SQL. Erros 401 sessão ausente, 403 falta de permissão, 404 sem revelar recursos de outro tenant, 409 conflito/estoque/idempotência, 422 validação, 429 limite excedido. Usar Zod ou equivalente em cada limite externo.

## Rotas propostas

| Área | Operações |
|---|---|
| auth/membership | perfil, empresas acessíveis, selecionar empresa, convidar/aceitar, membros e permissões |
| products/categories | CRUD de cadastro, arquivar, fotos, variantes, filtro/paginação e histórico |
| parties | CRUD cliente/fornecedor, busca segura, ficha e atividade |
| purchases | rascunho, confirmar, recebimentos parciais, custo adicional e cancelamento permitido |
| inventory | saldo, lotes, unidade serial, reservar/liberar, ajuste, inventário e histórico |
| sales | rascunho, cotação, confirmar entrega, parcelamento, recibo, devolução e estorno |
| trades | simulação da negociação, confirmar venda + compra + compensação, reverter com avaliação de dependências |
| finance | contas, títulos, alocar liquidação, despesas, caixa, crédito de loja e períodos |
| reports | métricas reutilizadas, relatórios, CSV/PDF via tarefa |
| catalog/store | publicar/despublicar, consultar projeção pública, pedido pendente e eventos de analytics |
| billing | ver plano, atualizar via provedor, portal de faturamento e consumo/limites |
| platform-admin | empresas/planos/eventos mediante papel e MFA, separado do tenant comum |

Operações de lista aceitam `cursor`, `limit`, `sort`, filtros enumerados e datas. Rejeitar filtros sem suporte; não interpolar colunas/ordenadores enviados pelo usuário.

## Idempotência e concorrência

Rotas `POST` que confirmam ou liquidam exigem `Idempotency-Key` UUID; armazenar tenant, operação, chave, hash estável do corpo, status e resposta. Requisição repetida com corpo idêntico devolve resposta original; corpo diverso dá 409. Retenção da chave cobre ao menos 7 dias; origem financeira única permanece protegida permanentemente.

Vendas bloqueiam variantes/lotes/unidades na ordem canônica e atualizam saldo sob transação serializável ou lock explícito com verificação de saldo. Em falha de serialização, retry limitado na camada do caso de uso, mesma idempotência. Nunca fazer `SELECT balance` e depois `UPDATE` sem lock/condição atômica. UI recebe 409 entendível e atualiza o saldo, sem repetir pagamento.

## Eventos e tarefas

Evento de domínio confirmado grava `outbox_events` dentro da transação. Worker consome com lease, timeout, tentativas exponenciais com jitter, idempotência pelo event_id e dead letter monitorada. Payload não inclui dados pessoais sem necessidade. Eventos iniciais: PurchaseReceived, SaleConfirmed, SaleReturned, TradeConfirmed, SettlementRecorded, SubscriptionChanged, DocumentRequested, ReportRequested.

Gerar PDF/exportações após commit. Webhook de gateway valida assinatura no corpo bruto, timestamp/replay window, ambiente, merchant/account e ID externo único; responder 2xx somente quando recebido e persistido. Processamento é assíncrono e tolera repetição/ordem diferente. Nunca confiar apenas na URL de retorno do navegador para registrar pagamento.

## Esboço de confirmação de troca

`POST /api/v1/trades` recebe parte, linhas de saída, linhas recebidas, política de diferença, forma/parcelas e idempotência. Prévia calcula no servidor e devolve versão/expiração. Confirmação requer mesma versão ou reapresenta nova simulação após mudanças.

Transação: valida duas linhas de itens; bloqueia estoque de saída; reserva/retira unidades; cria saída e sua alocação de custo; cria venda com snapshot; cria compra associada e avaliação snapshot; cria entrada/quarentena do bem recebido; abre títulos de venda/compra; gera `offset` até o mínimo dos dois; atribui saldo positivo ao cliente ou negativo à empresa; registra pagamento em dinheiro só após o operador confirmá-lo; anota auditoria e evento; commit. Validar soma exata e responder IDs, resumos e documentos. Em erro, rollback integral.

## Eventos externos

Integrações de e-mail, pagamentos de assinatura, S3, fiscal e assinatura digital usam adapters e contratos fake para testes. Falha externa não falsifica liquidação, documento fiscal nem assinatura. Estado “pendente de integração” visível e reprocessável pelo operador autorizado.
