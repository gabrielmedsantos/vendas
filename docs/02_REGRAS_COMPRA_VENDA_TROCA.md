# Regras de domínio e cálculos

As regras abaixo são decisões propostas para o novo SaaS, não descrições verificadas do motor contábil das referências. O resultado é gerencial; não substitui escrituração fiscal/contábil. Qualquer integração fiscal futura deverá ser especificada separadamente.

## 1. Precisão e datas

Valores em centavos inteiros (`bigint` no banco), transportados na API como strings decimais de inteiros para evitar limite de precisão JavaScript. Quantidades inteiras no MVP. Percentuais em basis points (10000 = 100%). Arredondamento monetário half-up em base decimal/racional. Rateios pelo método do maior resto, desempate por posição/ID, garantindo a soma exata.

Armazenar instantes em UTC e fuso IANA da empresa. Vencimento/competência são datas locais. Relatórios convertem limites do dia para UTC e usam intervalo início inclusivo/fim exclusivo. Fechar períodos; alteração retroativa exige permissão e reabertura auditada. Nunca alterar silenciosamente números de um período fechado.

## 2. Custo e estoque

- Aquisição: custo acordado líquido de desconto + frete de compra e custos diretamente atribuíveis efetivamente incorridos.
- Estoque por quantidade: FIFO por lote/recebimento. Cada saída registra quais lotes e custos consumiu. Proibir estoque negativo e limitar o total consumido por lote.
- Unidade serializada: custo específico por ciclo de aquisição. O mesmo serial pode voltar por devolução ou recompra; reutilizar sua identidade e abrir novo ciclo/lote quando for recompra, sem sobrescrever histórico.
- Reparo anterior à revenda pode agregar custo quando efetivamente lançado como custo de aquisição/preparação. Não contabilizá-lo também como despesa operacional. Estimativa de reparo fica apenas na simulação.
- Custo adicional recebido depois de uma venda deve gerar ajuste de custo rastreável alocado entre estoque remanescente e CMV já reconhecido; período fechado exige regra explícita, jamais reescrita de snapshot.
- Perda em inventário reduz estoque e gera despesa de perda na competência correspondente. Transferência de local não gera resultado.
- Custo não é o preço de venda sugerido. Valor potencial do estoque não é lucro realizado.

## 3. Venda, resultado e caixa

Subtotal = soma de quantidade × preço unitário. Total comercial = subtotal − descontos + frete cobrado do cliente e acréscimos comerciais. Distribuir desconto/frete entre itens para permitir devolução parcial. Tributos estimados, se usados futuramente, devem ter regra própria e identificação clara.

Receita gerencial líquida = total das vendas entregues e confirmadas − valores comerciais devolvidos/estornados no período. CMV = custos históricos das saídas − custos históricos das devoluções reconhecidas. Resultado bruto = receita gerencial líquida − CMV. Resultado após custos variáveis = resultado bruto − taxas de recebimento − comissões − fretes de venda assumidos pela empresa. Resultado operacional gerencial = resultado após custos variáveis − despesas operacionais de competência.

Margem operacional = resultado operacional / receita gerencial líquida × 100, quando receita > 0. Sem denominador positivo, mostrar “sem base”. Evitar chamar o número de “lucro líquido contábil” sem todas as parcelas necessárias. Não importar da referência um interruptor genérico que some qualquer movimento de caixa ao lucro.

Caixa realizado considera somente entradas/saídas efetivamente liquidadas em contas de dinheiro/banco. A compra de estoque reduz caixa quando paga, mas não vira despesa operacional automática: seu custo será CMV na venda. A venda a prazo reconhece receita na entrega e cria título, sem dinheiro fictício. Receber o título posteriormente não reconhece a mesma receita outra vez.

Aportes, retiradas, empréstimos e transferências precisam de tipos próprios. Não entram na receita de vendas. Cartão gera recebível bruto e despesa de taxa; banco recebe líquido somente na liquidação. Se R$ 1.000 têm taxa de R$ 30, o título é baixado por R$ 1.000 mediante alocação de R$ 970 recebidos + R$ 30 de taxa, sem ocultar a diferença.

## 4. Troca = venda + compra + compensação

Definir S como total comercial dos itens entregues ao cliente e P como valor acordado de aquisição dos itens recebidos. Ambos não negativos. D = S − P.

| Caso | Resultado financeiro |
|---|---|
| D > 0 | Cliente deve D à empresa |
| D = 0 | Nenhuma diferença monetária |
| D < 0 | Empresa deve −D ao cliente; pode pagar ou gerar crédito de loja se escolhido |

A troca cria uma venda com título de S e uma compra com título de P, para a mesma contraparte. Uma compensação não monetária de min(S,P) reduz os dois títulos na mesma transação. Só o saldo restante pode gerar caixa quando pago/recebido. Taxas de pagamento incidem sobre a parcela monetária e modalidade aplicáveis, nunca automaticamente sobre o valor total de troca.

Cada item recebido tem avaliação individual que soma P. Custos extras da empresa são separados da avaliação/compensação e agregados ao custo do item quando realizados. Sinal negativo jamais pode virar cobrança invertida sem mostrar “empresa paga ao cliente”.

### Exemplo A — Cliente entrega usado e paga diferença

Loja entrega aparelho por R$ 4.000, custo histórico R$ 3.000. Recebe aparelho usado avaliado em R$ 1.500 e R$ 2.500 por Pix.

| Indicador | Valor |
|---|---:|
| Receita da venda | R$ 4.000 |
| CMV da unidade que saiu | R$ 3.000 |
| Resultado bruto | R$ 1.000 |
| Compra do usado | R$ 1.500 |
| Compensação não monetária | R$ 1.500 |
| Entrada real de caixa | R$ 2.500 |
| Custo inicial do usado | R$ 1.500 |

Se houver reparo realizado de R$ 100 antes de revender, custo do usado = R$ 1.600. Ao revendê-lo por R$ 2.000, resultado bruto dessa segunda venda = R$ 400. Resultado bruto acumulado da cadeia = R$ 1.400. Não subtrair novamente R$ 1.500 na primeira venda.

### Exemplo B — Empresa paga diferença

Loja entrega item por R$ 2.000, custo R$ 1.300. Recebe item avaliado em R$ 2.500. Compensa R$ 2.000 e fica devendo R$ 500. Se pagar, saída de caixa = R$ 500; se emitir crédito da loja, saída de caixa = zero e passivo de crédito = R$ 500. Estoque recebido = R$ 2.500; resultado bruto da venda = R$ 700.

### Exemplo C — Sem diferença

S = P = R$ 1.800, custo do item entregue R$ 1.200. Compensação = R$ 1.800; caixa = zero; resultado bruto gerencial = R$ 600; estoque recebido = R$ 1.800. O resultado depende de avaliação comercial registrada e justificável. Mostrar separadamente receita de troca e entrada monetária.

## 5. Confirmação atômica e concorrência

1. Validar sessão, membership, permissão, plano, período e chave idempotente.
2. Bloquear saldos/unidades/lotes/rascunho em ordem determinística. Recalcular disponibilidade e totais no servidor.
3. Validar pessoa, itens, somas, identificadores, avaliações e alocações.
4. Criar/confirmar venda, compra, recebimento, títulos e compensação; movimentar estoque e reconhecer custos.
5. Registrar liquidações reais se confirmadas pelo operador; deixar pendentes as demais.
6. Criar auditoria e outbox; commit.
7. Fora da transação, gerar PDF/avisos. Falha no PDF não desfaz venda confirmada; permitir reprocessar.

Retry por falha transitória é limitado e usa mesma chave. Corpo diferente com chave igual retorna conflito. Nada deve confirmar parcialmente uma troca.

## 6. Devolução e estorno

Documentos confirmados não são editados destrutivamente. Evento de estorno aponta origem e motivo; contadores e saldo são recalculáveis. Devolução parcial usa quantidade e rateios originais. Estoque volta ao custo de origem, inicialmente em inspeção, e somente depois pode ficar disponível.

Cancelar troca sem dependências reverte venda, compra, compensação e movimentações de maneira coerente. Qualquer dinheiro que já transitou exige reversão/reembolso separado e conciliado. Se item adquirido na troca já foi revendido, consumido ou transformado, bloquear estorno simples e abrir resolução assistida com documentos compensatórios e aprovação do gestor.

Devolver um item comprado em troca não significa automaticamente devolver a outra mercadoria. O fluxo de pós-venda precisa mostrar que pode haver obrigação de restituição monetária/comercial conforme acordo registrado. Não inventar uma política jurídica universal.

## 7. Crédito da loja

Livro próprio: emissão, uso, estorno e ajuste autorizado. Crédito é obrigação comercial da empresa, não receita na emissão. Usá-lo liquida parte de um título sem novo caixa. Não permitir saldo negativo ou uso duplicado. Origem, beneficiário, eventual validade configurada e histórico devem ser visíveis; não expirar retroativamente.

## 8. Métricas avançadas propostas

Ticket médio = receita comercial de vendas válidas / quantidade de vendas correspondentes. Margem agregada é ponderada por receita, não média simples de percentuais. Retorno sobre custo = resultado bruto / CMV, quando CMV > 0; rotular distintamente de margem.

Giro de estoque = CMV do período / estoque médio a custo. Usar snapshots diários consistentes; sem histórico, exibir insuficiência de dados. Dias de estoque = dias do período / giro. Prazo médio de recebimento: métrica ponderada por valor nas liquidações, com definição visível. Ciclo de caixa só deve existir após ter métricas comparáveis de estoque, recebimento e pagamento. Projeções não integram receita realizada.
