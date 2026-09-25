# Notas de leitura das capturas

Essa leitura foi feita para preparar o pacote; Claude deve repetir a inspeção visual em seu próprio ambiente, em especial quando precisar alterar o desenho. Captura funcional descreve estados visíveis, não as regras não vistas do sistema original.

## FlowPay — 16 arquivos FP

| ID | Observação visual resumida |
|---|---|
| FP-01 | Capa escura, produto SaaS financeiro, destaque tipográfico branco/lilás e preview de dashboard |
| FP-02 | Introdução ao produto e cards com módulos |
| FP-03 | Comparação visual problema/solução com acento roxo |
| FP-04 | Prancha de cores, família Inter por hierarquia, botões, busca, status e série financeira |
| FP-05 | Diagrama de áreas: pagamentos, cliente, fatura, analytics e settings |
| FP-06 | Dashboard: KPIs, receita, gráfico, ações, transações e vencimentos |
| FP-07 | Telas de payments/invoices e ciclo de estados |
| FP-08 | Fluxo de criação de fatura por etapas |
| FP-09 | Relação com clientes e histórico |
| FP-10 | Analytics com KPIs e gráficos |
| FP-11 | Lista de notificações com prioridade e status |
| FP-12 | Fluxo de cadastro de cliente |
| FP-13 | Detalhes do perfil do cliente |
| FP-14 | Análise de cliente, sinais de relacionamento e pagamentos |
| FP-15 | Tela para novos/retornos, formulário simples de login/cadastro e princípios de acessibilidade visual |
| FP-16 | Workspace/configurações e adaptação a telas pequenas |

O próprio projeto rotula a orientação como dark-first e destaca clareza de dados. Prancha FP-04 é fonte dos tokens. Esses valores são diretriz, não aprovação automática de contraste em qualquer combinação. Validar no produto.

## VendaMax — 16 arquivos VM

| ID | Observação visual resumida |
|---|---|
| VM-01 | Navegação lateral extensa e tela de tutoriais com busca/categorias |
| VM-02 | Painel analítico com eficiência, rentabilidade, giro, liquidez, crescimento e tendências |
| VM-03 | Gastos operacionais com filtro, resumo e lista vazia |
| VM-04 | Formulário de produto dividido por Geral, Financeiro, Estoque, Variações, Fornecedor e Canais |
| VM-05 | Fornecedores pesquisáveis com colunas de identificação/localização/status |
| VM-06 | Catálogos Online e prévia desktop/celular |
| VM-07 | Pixel por pixel igual à captura VM-03; tratar como repetida |
| VM-08 | Contas a receber, indicadores temporais e relação de títulos |
| VM-09 | Venda em janela grande com busca de produtos, itens, quantidades, canal e pagamento dividido |
| VM-10 | Clientes com busca por identidade/contato |
| VM-11 | Analytics de catálogo associado à descrição de recurso/plano |
| VM-12 | Dashboard com onboarding, metas, KPIs, receita e desempenho |
| VM-13 | Categorias apresentadas como cards com contagem/ações |
| VM-14 | Produtos com filtros e visão de custo, varejo/atacado, margem e estoque |
| VM-15 | Relatórios e gráficos para venda, lucro, top produtos, categorias, canais e pagamentos |
| VM-16 | Analytics vertical com várias métricas e gráficos dependentes de período |

### Diferenças entre referência e novo produto

VendaMax mostra Produtos e Vendas, fluxos Financeiros, Clientes/Fornecedores, Catálogo e Analytics. Não foram fornecidas telas confirmatórias de Compra, Troca, devolução ou um cadastro completo de usados. Eles foram acrescentados ao escopo por solicitação do usuário e decisões do plano. As regras de troca devem ser construídas/validadas por este projeto, nunca extraídas de um screenshot.

---

## Leitura visual feita na implementação (Claude Code, 25/09/2026)

Todas as imagens foram abertas visualmente nesta sessão, em grupos de 4. **Lidas: VM-01 a VM-16 (16/16), FP-01 a FP-16 (16/16) e BR-01-login.** VM-07 é byte a byte idêntica a VM-03 (mesmo SHA/MD5 `908cfeb4…`), confirmado por hash.

Os nomes dos arquivos nem sempre correspondem às descrições dos índices do pacote. O que cada arquivo **realmente mostra**:

### VendaMax (referência funcional)

| Arquivo | Conteúdo observado (visual) | Uso no produto novo |
|---|---|---|
| VM-01 | Central de dicas/tutoriais: busca, filtros Todos/Segurança/Financeiro/Marketing/Logística/Atendimento, card de vídeo, dica rápida, comunidade, "Destaques da semana" vazio | Ajuda (fase 8) com artigos próprios; sem links externos de terceiros |
| VM-02 | Analytics (topo): período "30 dias", KPIs Receita, Lucro, Impacto do fluxo, Itens; "Fundamentos": Eficiência (margens, CMV%, despesas%, taxas%) e Giro e ciclo | Métricas com fórmula visível e "sem base" |
| VM-03 = VM-07 | Gastos operacionais: cards Total, Lançamentos, Maior categoria, Média; filtro período, busca, categoria, "Limpar filtros", nota "resumos usam só o período; lista aplica busca e categoria", estado vazio com CTA | Tela Despesas: mesmo comportamento de filtros (resumo por período, lista com busca/categoria) |
| VM-04 | Modal "Novo Produto": abas Geral, Financeiro, Estoque, Variações, Fornecedor, Canais; tipo de item, nome*, marca, status (visível na venda), categoria* com "+ Criar", descrição, upload PNG/JPG/WEBP | Formulário de produto por blocos; custo **não** é digitado no cadastro (deriva das entradas) |
| VM-05 | Fornecedores: busca, filtros Todos/Ativos/Pendentes/Inativos, tabela Nome/CNPJ/Categoria/Cidade-UF/Status, paginação marcada como "ilustrativa", cards ativos/novos no mês | Pessoas unificadas (cliente+fornecedor); paginação real |
| VM-06 | Catálogos online: estado vazio "Criar catálogo", preview Desktop/Mobile com vitrine | Catálogo público (fase 8) com preview |
| VM-08 | Contas a receber: busca, botões Devedores/Histórico/Relatório, cards Total pendente, Recebido hoje, Vence esta semana, Atrasados; lista "Títulos ordenados por vencimento" | Tela Receber/Pagar com os mesmos quatro cards |
| VM-09 | Modal "Nova Venda": busca rápida de produto, itens com qtd −/+ e preço, subtotal, Canal de venda* com "+ Criar", "Dividir pagamento", resumo Subtotal/Custo/Taxas, Total e "Lucro líquido" | Nova venda com pagamento dividido; custo/lucro só com permissão; renomeado para "resultado bruto" |
| VM-10 | Clientes: busca por nome/e-mail/telefone/documento, "Novo cliente", estado vazio | Busca normalizada de pessoas |
| VM-11 | "Analytics do catálogo" bloqueado por plano com CTA de upgrade | Limites/recursos por plano aplicados no servidor |
| VM-12 | Dashboard completo: primeiros passos (3), cards Lucro líquido/Total vendas/Qtd/Margem vs período anterior, meta de faturamento, Receita e lucro, Desempenho (caixa do período entradas/saídas/saldo, a receber, estoque baixo), vendas por canal/pagamento, vendas recentes, agenda financeira, banners app/indicação/comunidade | Estrutura do painel; banners promocionais não copiados |
| VM-13 | Analytics em página vertical longa: fundamentos (eficiência, giro, rentabilidade, liquidez, crescimento), evolução financeira, top produtos, categoria, canal, forma de pagamento, projeção, margem, ticket médio, sazonalidade, transações | Relatórios/analytics; projeção só com histórico e método explícito |
| VM-14 | **Categorias** em cards (Acessórios, Alimentos, Cosméticos, Eletrônicos, Roupas) com contagem e editar/excluir; menu lateral completo visível | Categorias com contagem e arquivamento com reclassificação |
| VM-15 | **Produtos**: busca, Filtros, Colunas, atalhos Sem estoque/Estoque baixo/Nunca vendido/Inativos, colunas Produto/Categoria/Custo/Varejo-atacado/Margem/Estoque/Ações, legenda de ações (Vender, Ver detalhes, Entrada de estoque, Histórico, Editar, Excluir), cards Valor em custo/Valor em venda/Margem média/Lucro potencial | Lista de produtos com os mesmos atalhos; "lucro potencial" rotulado como estimativa |
| VM-16 | **Relatórios**: Relatório mensal (PDF), período; cards Total em vendas/Lucro/Itens/Lançamentos/Ticket/Margem; gráficos mês vs anterior, vendas por dia, top 5, lucro por categoria, por canal; histórico do período. Texto menciona opção "Incluir fluxo financeiro no lucro" | Relatórios; **não** adotamos o interruptor que soma caixa ao lucro (doc 02 §3) |

Menu lateral observado (VM-14/VM-15): Dashboard, Produtos, Categorias, Vendas, Serviços, Canais, Pagamentos; Fluxo de caixa, Contas a receber, Gastos, Analytics, Relatórios; Catálogos, Analytics catálogo (Pro+), Loja, Indique e Ganhe, Tutoriais; Clientes, Fornecedores; Perfil. **Não há Compras nem Trocas no menu observado.** Dados pessoais do rodapé (nome/e-mail do usuário), banner de domínio, trial e marca não foram transcritos para o produto.

### FlowPay (referência visual)

| Arquivo | Conteúdo observado |
|---|---|
| FP-01 | Capa "Finance in Motion" com tablet do dashboard e brilho roxo |
| FP-02 | "About the product": laptop com landing e 4 cards de módulos (fundo escuro, ícones roxos) |
| FP-03 | Problema × solução em dois cards escuros (vermelho × roxo) |
| FP-04 | Visual Direction: paleta #0D0E17 #12131C #8A62FF #A78BFA #7CFEB2 #F59E0B #EF4444 #60A5FA; Inter SemiBold/Regular 56/32/22/14; botões primário/secundário, input com ícone, badges Paid/Pending/Overdue com ponto, toggle; card de receita com série e lista de faturas |
| FP-05 | "How it works": diagrama de módulos conectados |
| FP-06 | Dashboard: saudação, 3 KPIs com variação, gráfico de receita com meta e barra de progresso, transações com status, ações rápidas, última atividade, próximos pagamentos com barra lateral colorida |
| FP-07 | Payments & Invoices: KPIs, barras, breakdown com barras finas, tabela com filtros; ciclo de 5 estados |
| FP-08 | Criação de fatura em 5 passos com resumo fixo ao lado ("live summary") e revisão final |
| FP-09 | Lista de clientes: KPIs, filtro, tabela com avatar, status, receita, pendente |
| FP-10 | Formulário "Add new client" em seções |
| FP-11 | Perfil do cliente: resumo, histórico, relacionamento, notas internas, ações rápidas, atividade |
| FP-12 | Analytics: KPIs com variação, linha, barras por dia da semana, insights |
| FP-13 | Notificações contextuais com ícone/cor por severidade e link de ação |
| FP-14 | Login e cadastro focados |
| FP-15 | Configurações com navegação lateral + adaptação mobile (cards empilhados, CTA largo) |
| FP-16 | Visão geral de todas as telas e sidebar com item ativo |

O índice `referencias/03_flowpay/INDICE.md` descreve FP-10..FP-16 com rótulos deslocados; a tabela acima reflete o conteúdo visto. Não foram copiados logo, nomes, textos ou valores de exemplo.

### BrikLucro
BR-01-login: somente tela de login (Google, e-mail/senha, recuperar, cadastro). **Nenhuma tela interna foi vista**; nenhuma função interna é atribuída ao BrikLucro.
