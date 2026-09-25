# Modelo de dados proposto

Não é DDL pronto. Claude deve produzir schema, migrações, constraints, índices e políticas RLS a partir destas regras, testando-as no PostgreSQL real.

## Convenções

UUID nos IDs; `created_at`, `updated_at`, `created_by` quando pertinente. Tabelas empresariais com tenant obrigatório. Valores `_cents bigint`, taxas `_bps integer`, quantidades inteiras positivas. Arquivamento em cadastros; livros confirmados append-only. `version` para controle otimista de rascunhos. Identificadores e snapshot do documento preservam a realidade histórica.

## Entidades

| Grupo | Tabela | Campos/relacionamentos principais |
|---|---|---|
| Plataforma | users, sessions, auth_accounts | Identidade, sessão revogável e provedor; seguir schema da biblioteca |
| Plataforma | tenants | Nome, slug, fuso, status, configurações, owner inicial |
| Plataforma | memberships, roles, role_permissions, invites | user + tenant, função, status, escopo, expiração |
| Plataforma | plans, plan_versions, entitlements | Nome, vigência, preço, moeda, intervalos, recursos e limites |
| Plataforma | subscriptions, subscription_events | tenant, plano contratado, estado, datas, ID provedor |
| Plataforma | billing_invoices, webhook_events | Cobrança da assinatura; evento único por provedor/ID, resultado |
| Pessoas | parties, party_roles, party_addresses | Pessoa PF/PJ e papéis cliente/fornecedor, contatos e documento normalizado |
| Catálogo | categories, products | Nome, tipo físico/serviço, modo de rastreio, marca, estado |
| Catálogo | product_variants, variant_attributes | SKU, código, atributos e preços sugeridos; variante padrão quando sem opções |
| Arquivos | attachments, product_images | Chave privada, MIME, tamanho, checksum, tenant, origem e exposição autorizada |
| Estoque | locations, stock_balances | Localização, variante, físico, reservado, versão |
| Estoque | inventory_units, unit_identifiers | Identidade da unidade serializada e múltiplos identificadores normalizados |
| Estoque | inventory_lots, unit_acquisitions | Ciclo de entrada, quantidade/custo, origem, saldo remanescente |
| Estoque | stock_movements, stock_allocations | Entrada/saída/reserva, origem, lote/unidade, quantidade/custo e reversão |
| Estoque | reservations, reservation_items | Pedido/rascunho, expiração, unidade/lote/variante, estado |
| Compras | purchases, purchase_items | Pessoa, itens, preços/descontos/custos, obrigação, estado |
| Compras | goods_receipts, goods_receipt_items | Recebimento parcial, inspeção, lote/unidade e quantidade |
| Compras | acquisition_costs, cost_adjustments | Frete/reparo/custos atribuídos, rateio, estado de realização, impacto em CMV |
| Vendas | sales, sale_items | Cliente, vendedor, canal, data de entrega, total e snapshots dos itens |
| Vendas | sale_cost_allocations | Item vendido → lotes/unidades consumidos; custo histórico |
| Trocas | trades, trade_valuations | Contraparte, venda, compra, avaliações, diferença, motivo e estado |
| Devoluções | returns, return_items | Origem venda/compra, quantidade, valor histórico, inspeção e restituição |
| Financeiro | financial_accounts | Caixa/banco/trânsito, moeda, status |
| Financeiro | financial_titles | Direção receivable/payable, pessoa, origem, competência, vencimento, valor |
| Financeiro | settlements, settlement_allocations | Método, data, valor bruto, taxa, líquido, conta; alocação em títulos |
| Financeiro | offsets, offset_allocations | Compensação não monetária entre títulos da mesma contraparte/empresa |
| Financeiro | cash_movements, account_transfers | Conta, direção, valor real, origem única, contrapartida/reversão |
| Financeiro | store_credit_entries, credit_allocations | Emissão/uso/estorno de crédito por pessoa |
| Financeiro | expense_categories, expenses, recurring_expenses | Competência, valor, categoria, título e recorrência |
| Financeiro | cash_sessions, financial_periods | Abertura/fechamento de caixa; bloqueio/reabertura de período |
| Configuração | sales_channels, payment_methods, fee_rules | Canais, modalidades, taxas e validade |
| Documentos | document_templates, documents | Template versionado, origem, número, snapshot, hash e arquivo |
| Relatórios | daily_stock_snapshots, report_jobs | Posições diárias, filtros, status, arquivo temporário |
| Público | catalogs, catalog_items, catalog_events | Publicação, produtos/variantes visíveis e métricas minimizadas |
| Loja | public_orders, public_order_items | Pedido público pendente, preços snapshot, contato mínimo e reserva |
| Expansão | service_records, warranty_cases | Serviços simples e atendimento vinculado à venda |
| Suporte | notifications, help_articles, referrals | Estado de leitura, conteúdo próprio e indicação |
| Controle | audit_events, outbox_events, idempotency_keys | Eventos, usuário, payload mínimo, hash de requisição e resposta final |

## Restrições indispensáveis

1. SKU único por empresa; documento normalizado único quando presente e política de deduplicação permitir. Nunca unicidade global de CPF de cliente entre empresas.
2. Identificador serializado único dentro da empresa por tipo/valor normalizado. Há somente uma identidade ativa para o mesmo item, com histórico de ciclos de aquisição.
3. Quantidade recebida acumulada ≤ quantidade comprada, salvo ajuste formal do pedido. Devolução acumulada ≤ saída original líquida.
4. Soma das alocações de liquidação/compensação/crédito não excede saldo do título. Validar em transação com locks, pois `CHECK` não protege somas entre linhas.
5. Movimento financeiro único por origem/tipo/conta; evento externo único por provedor + ID. Idempotência única por tenant + operação + chave.
6. Compensação exige mesmo tenant, mesma pessoa, mesma moeda e direções opostas. Nunca movimenta cash_movements.
7. Lotes não têm quantidade consumida maior que recebida ajustada. Unidade não tem duas reservas ativas ou duas saídas sem retorno entre elas.
8. Total de compra/venda corresponde aos itens + rateios. Snapshot histórico inclui descrição, preço, desconto, custo, taxa e canal usados.
9. Chaves compostas para pais empresariais impedem referência entre tenants mesmo se aplicação falhar.
10. Uma reversão total por movimento; reversões parciais limitadas por saldo reversível. Não apagar original.

## Máquinas de estado

| Agregado | Transições principais |
|---|---|
| Venda | draft → confirmed; draft → canceled; confirmed → partially_returned → returned; correção via reversão |
| Pedido | draft → placed → reserved → fulfilled; expiração/cancelamento libera reserva |
| Compra | draft → approved → partially_received → received; cancelamento considera recebimentos/saídas |
| Troca | draft → confirmed → reversed; dependências impedem reversed automático |
| Unidade | inspection → available → reserved → sold; devolução sold → inspection; repair/lost com eventos |
| Título | open → partially_settled → settled; overdue é situação derivada; reversão reabre conforme saldo |
| Job | pending → processing → done; falha → retry → dead_letter |
| Assinatura | trialing → active → past_due → suspended; cancel_at_period_end → canceled; reconciliação controla reativação |

## Consulta e índices

Listagens paginadas no servidor (padrão 25, máximo 100), ordenação estável por campo + ID. Índices `(tenant_id, created_at, id)`, `(tenant_id, status, due_date)` em títulos, `(tenant_id, variant_id, location_id)` em estoque e `(tenant_id, normalized_value)` em identificadores. Busca por texto normalizado; aplicar índices especializados apenas após medir.

Migrações aditivas primeiro; backfill em lotes; tornar obrigatório depois de preenchido. Migração financeira exige reconciliação de totais antes/depois. Seed só no ambiente explicitamente de desenvolvimento/teste e contendo duas empresas distintas para provar isolamento.
