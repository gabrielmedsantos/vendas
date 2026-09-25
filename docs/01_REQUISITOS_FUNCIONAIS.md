# Requisitos funcionais

IDs RF são usados no backlog e nos testes. Recursos identificados somente pelo menu da referência são propostas de implementação até haver tela ou fluxo comprovado.

## RF-01 — Conta, empresa e onboarding

Cadastro/login, verificação de e-mail, recuperação de senha com token temporário, logout e revogação de sessões. Biblioteca de autenticação mantida, sem mecanismo caseiro. Convites de membros expiram e são de uso único. Dono não pode remover o último proprietário.

Empresa: nome fantasia/razão social, documento opcional conforme cadastro, contato comercial, endereço, logo, fuso e moeda. Perfil pessoal separado do perfil empresarial. Onboarding: configurar empresa, primeiro produto/compra e primeira venda. Não preencher com nome/e-mail vistos nas referências.

Aceite: empresa A não consegue consultar nem alterar nenhum registro de B; trocar empresa limpa caches e filtros dependentes; sessão revogada deixa de funcionar.

## RF-02 — Usuários e permissões

Papéis iniciais: proprietário, gestor, vendedor, estoque, financeiro e consulta. Permissões granulares para ver custo/lucro, desconto acima do limite, confirmar compras, concluir troca, ajustar estoque, baixar títulos, estornar, exportar dados e gerenciar membros. Superadministrador da plataforma é função separada.

Aceite: ocultar botão não basta; chamar a API diretamente sem permissão retorna erro e não altera dados. Vendedor não recebe custo em JSON, PDFs ou consultas que não está autorizado a ver.

## RF-03 — Produtos, variantes e categorias

Produto: tipo físico/serviço, nome, descrição, marca, categoria, situação e fotos. Variante: SKU, código de barras opcional, atributos (cor, tamanho, capacidade), preço varejo/atacado e quantidade mínima de atacado. Aba financeira para preço sugerido e visualização autorizada de custo; custo real deriva das entradas.

Modo de rastreio: por quantidade/lotes ou serializado. Usados: unidade individual com número interno, condição, série/IMEI 1/IMEI 2 opcionais por categoria, bateria quando aplicável, acessórios, defeitos e checklist. Uma unidade com vários identificadores não vira várias unidades de estoque.

Imagens JPEG/PNG/WebP com tamanho e dimensões limitados. Limite proposto: 10 fotos de até 5 MB por produto, configurável por plano. Reprocessar imagens e remover metadados. Nenhuma cópia de documento pessoal vai para o catálogo.

Lista: busca por nome, SKU e identificadores autorizados; filtros sem estoque, baixo, nunca vendido, inativo, categoria e condição. Paginação real, colunas configuráveis, ordenação e ações vender, detalhes, entrada, histórico, editar e arquivar. Categorias com contagem; impedir exclusão enquanto vinculada ou oferecer reclassificação explícita.

Aceite: alterações no cadastro não mudam valores históricos de vendas; serviço não movimenta estoque; produto inativo não aparece para nova venda e permanece nos documentos antigos.

## RF-04 — Compras e recebimento

Comprar de pessoa física ou jurídica, inclusive de um cliente existente. Campos: fornecedor/pessoa, data, itens, unidades/lotes, preço acordado, desconto, frete de aquisição, outros custos diretamente atribuíveis, condição de pagamento e anexos.

Estados: rascunho, aprovado, recebido parcialmente, recebido, cancelado. MVP pode confirmar compra e recebimento integral em um fluxo; modelar recebimentos separados e entregar recebimento parcial na mesma fase de compras. Somente a quantidade recebida entra no estoque; contas a pagar seguem o compromisso financeiro confirmado, incluindo adiantamentos quando houver.

Conferência por unidade/quantidade; custos acessórios distribuídos proporcionalmente ao valor dos itens, com centavos residuais alocados deterministicamente. Termo comercial de aquisição de usado com pessoa, item e valores. Não alegar consulta a base governamental que não foi feita.

Aceite: clicar duas vezes em receber não duplica estoque; receber 2 de 5 mantém 3 pendentes; cancelar rascunho não cria movimentações.

## RF-05 — Estoque e inventário

Livro de movimentos com origem, usuário, data, quantidade, custo e saldo. Disponível = físico vendável − reservado. Itens em quarentena, conserto ou devolvidos sem inspeção não ficam disponíveis.

Reservas com validade e liberação automática. Entrada por compra, troca, devolução aprovada e ajuste de inventário. Saída por venda, devolução a fornecedor, perda e ajuste. Ajuste exige motivo e permissão. Inventário físico gera divergências revisáveis antes de confirmação.

Valor de estoque a custo; valor potencial de venda rotulado como estimativa, separado de lucro realizado. Notificação de estoque baixo e itens parados. Localização padrão por empresa; transferência interna futura cria saída e entrada vinculadas, sem lucro.

Aceite: unidade serializada nunca pode estar vendida e disponível ao mesmo tempo; ledger e saldo materializado reconciliam; concorrência não permite duas saídas da última unidade.

## RF-06 — Clientes e fornecedores

Entidade pessoa com papéis de cliente, fornecedor ou ambos. PF/PJ, nome, documento opcional/necessário conforme operação, telefone, e-mail e endereço. Busca normalizada e deduplicação dentro da empresa. Histórico de compras/vendas/trocas, títulos, saldo de crédito e documentos.

Cliente obrigatório em venda a prazo, troca e operação com documento nominal. Venda à vista pode ser sem identificação quando o processo permitir. Identidade de fornecedor deve existir na aquisição de usados para rastreabilidade comercial.

Aceite: arquivar pessoa não elimina histórico; o mesmo contato não precisa de duas fichas para comprar e vender; dados pessoais não aparecem em páginas públicas.

## RF-07 — Vendas e orçamento

Orçamento/rascunho com cliente, vendedor, canal, validade, itens, preços e descontos. Seleção rápida, controle de quantidade, leitura de código quando disponível e escolha de unidade serializada. Mostrar total e, a quem tiver permissão, custo e margem projetada.

Pagamento dividido entre dinheiro, Pix, débito, crédito, crediário/fiado, crédito da loja e compensação de troca. Método, valor, vencimento, parcelas, taxas e conta de destino. Taxas congeladas na confirmação, sem mudar ao editar configuração do método.

Distinguir status comercial/entrega de status financeiro. Rascunho não reconhece receita. MVP confirma venda na entrega; pedido ainda não entregue apenas reserva estoque. Não permitir concluir sem que todas as parcelas, compensações e créditos componham o total.

Resumo de cliente/itens/pagamentos antes de confirmar; transação única cria venda, baixa de estoque, custo, títulos, liquidações e auditoria. Emitir recibo comercial em PDF e permitir compartilhar arquivo manualmente. Não apresentar recibo como documento fiscal.

Aceite: entrada + parcelas somam exatamente o total; parcelamento não duplica receita; editar preço do produto amanhã não altera a venda de hoje.

## RF-08 — Troca comercial

Tela própria com dois blocos: “Produtos entregues ao cliente” e “Produtos recebidos do cliente”. Suportar múltiplos itens nos dois lados e diferença positiva, negativa ou zero.

Avaliar cada item recebido: preço acordado, custo adicional previsto separado, condição, identificadores, fotos, inspeção e preço futuro sugerido. Mostrar valor de saída, valor de entrada, compensação, diferença e destino dessa diferença. Criar compra e venda ligadas por uma negociação.

Diferença positiva gera recebimento/títulos. Negativa gera pagamento ou crédito da loja escolhido explicitamente; o padrão é conta a pagar até liquidação. Item recebido pode entrar em quarentena. Custos futuros estimados não entram como realizados.

Aceite: troca sem diferença gera zero movimento de dinheiro; lucro não é calculado apenas sobre a diferença; cancelar a troca avalia os dois lados e eventuais revendas.

## RF-09 — Devolução, cancelamento e pós-venda

Devolução pode ser total ou parcial e deve apontar item/quantidade original. Limitar ao que foi vendido menos devoluções anteriores. Produto devolvido vai para inspeção antes de revenda. Reverter receita e CMV pela base histórica proporcional, nunca pelo preço/custo atual.

Restituição: baixar/reduzir saldo a receber ainda aberto e gerar valor a devolver apenas para o que já foi pago/compensado, conforme conciliação. Crédito de loja precisa ser uma opção explícita. Taxa não restituída permanece como custo.

Garantia comercial: prazo configurado, condições aprovadas pela empresa, anexos e protocolos. Documento deve registrar os termos usados na época. Ordens de serviço completas são expansão; registrar atendimento pós-venda simples no MVP.

Aceite: cancelar venda paga não apaga recebimento; cria estorno e obrigação/reembolso rastreável. Troca com item recebido já revendido não tem cancelamento automático destrutivo.

## RF-10 — Contas a receber e a pagar

Títulos originados de vendas, compras, despesas, reembolsos e diferença de troca. Campos: pessoa, origem, competência, vencimento, valor original, saldo, status, categoria e anexos.

Pagamentos/recebimentos parciais, vários títulos em uma liquidação e várias liquidações em um título, com alocação explícita. Entrada, parcelamento com datas configuráveis, fiado e presets 30/60/90 dias. Multas/juros/descontos somente quando configurados e autorizados; padrão zero.

Filtros por período, cliente/fornecedor, vencimento e situação. Cards pendente, recebido/pago hoje, vence na semana e atrasado. Histórico e relatório por devedor. “Atrasado” deriva de saldo positivo e vencimento no fuso da empresa.

Aceite: receber R$ 100 de título R$ 250 deixa saldo R$ 150; duas baixas simultâneas não excedem saldo; vencimento futuro não altera caixa atual.

## RF-11 — Caixa, despesas e conciliação

Contas caixa/banco/cartão em trânsito, saldos iniciais auditados, entradas, saídas, transferências entre contas, sangria/suprimento quando houver caixa físico e fechamento com diferença justificada. Transferência interna não é receita nem despesa.

Despesas com descrição, categoria, competência, vencimento, pagamento, recorrência opcional e comprovante. Gastos de aquisição integram o custo do item quando cabível; não duplicar como despesa operacional. Aportes, empréstimos e retiradas não são vendas.

Realizado separado de projetado. Conciliação manual no MVP; importação de extrato posterior. Cartão distingue recebível bruto, taxa, líquido esperado e liquidação efetiva. Pix manual pede registro de confirmação pelo operador, sem fingir integração bancária.

Aceite: uma mesma liquidação não pode ser lançada novamente por caminho manual ou webhook; banco e caixa batem com seu livro de movimentos.

## RF-12 — Dashboard, analytics e relatórios

Dashboard: vendas líquidas, resultado operacional gerencial, unidades vendidas, margem, caixa do período, a receber/a pagar, estoque baixo, últimas vendas e agenda financeira. Cada card explica período, base e fórmula. Metas de faturamento configuráveis.

Relatórios essenciais: vendas, compras, estoque/custo, movimentos, trocas, recebíveis, pagáveis, fluxo de caixa e resultado gerencial. Filtros consistentes no cabeçalho, lista, totais e exportação. PDF e CSV; exportações grandes por tarefa em fila com expiração do link.

Analytics posterior: evolução, canal, forma de pagamento, categoria, top produtos, ticket médio, sazonalidade semanal, estoque parado e margem. Projeção só aparece com histórico suficiente e método explícito; nenhum dado fictício para preencher gráfico vazio.

Aceite: dashboard, API e relatório usam o mesmo serviço de métricas e os mesmos números; ausência de denominador mostra “sem base”; saldos atuais não são rotulados como saldos históricos.

## RF-13 — Documentos e anexos

Recibo de venda, termo de compra, resumo da troca, orçamento, devolução e garantia comercial. Numeração única por empresa/tipo, versão do modelo, valores e partes como snapshot e hash do documento gerado. Acesso autenticado ou link temporário restrito.

Assinatura eletrônica com provedor fica para integração futura; não marcar como “assinado” apenas por digitar nome ou desenhar rubrica sem trilha especificada. Consultas de IMEI/bases externas só podem ser registradas como verificadas com evidência e integração/autorização real; permitir observação manual claramente identificada.

## RF-14 — Catálogo e loja

Catálogo público com slug, logo, cores, produtos selecionados, preços de venda, fotos e botão de contato. Preview desktop/celular. Publicar por ação explícita. API pública retorna somente campos públicos; nunca custo, identificadores privados, cliente ou fornecedor.

Loja da fase 8 recebe solicitação de pedido com carrinho. Criar pedido pendente; só reservar por prazo limitado após validação de disponibilidade. Pagamento integrado é fase 9. Clique no WhatsApp não equivale a venda confirmada. Analytics de visitas, produtos e cliques separado de receita.

## RF-15 — Serviços, canais e formas de pagamento

Canais configuráveis, por exemplo loja física, WhatsApp e marketplace. Custo/comissão de canal com vigência e snapshot por venda. Serviço simples vendido sem estoque, com custo direto quando cadastrado. Não incluir oficina completa como função implícita.

Configurar métodos de pagamento e taxas por modalidade/número de parcelas. “Pagamentos” no menu deverá ser renomeado para evitar confusão com liquidações e assinatura do SaaS.

## RF-16 — SaaS e suporte

Painel do dono da plataforma com empresas, planos, assinaturas, limites, inadimplência, eventos de cobrança e saúde técnica. Onboarding de empresa cria trial apenas uma vez conforme política. Tutoriais próprios, suporte e programa de indicação posterior.

Todos os limites de plano são aplicados no servidor. Downgrade não elimina dados. Suspensão bloqueia novas operações conforme política e permite acesso autorizado a cobrança/exportação; apagar empresa exige processo separado e não acontece por simples atraso.

## RF-17 — Importação e exportação

Importação CSV de produtos/pessoas com modelo, preview, mapeamento, validação por linha e relatório de erros. Identificar arquivo por hash para impedir repetição acidental. Estoque inicial é ajuste auditado em lote, separado de cadastro de produto. Documentar unidades e saldo/custo inicial; nenhum campo monetário implícito.

Exportação por empresa com limites de permissão, rastreio de solicitação e expiração. Neutralizar fórmulas em células CSV. Usuário de uma empresa não pode baixar exportação de outra.
