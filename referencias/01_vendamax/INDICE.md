# Inventário visual VendaMax

16 capturas de telas fornecidas pelo usuário em 24/09/2026. Preservadas em `imagens/VM-01.png` até `VM-16.png`. Consulte `MAPA_ARQUIVOS.csv` para relacionar cada ID ao nome original e dimensões. Abrir a imagem antes de implementar tela baseada nela.

| ID | O que aparece na captura | Módulos/requisitos relacionados |
|---|---|---|
| VM-01 | Central de dicas/tutoriais, busca e filtros por Segurança, Financeiro, Marketing, Logística e Atendimento | RF-16 suporte/tutoriais; expansão |
| VM-02 | Analytics com período, receita, lucro, caixa, itens, eficiência, margem, giro, liquidez, crescimento e gráficos | RF-12 |
| VM-03 | Gastos operacionais, soma/período, categorias, pesquisa e novo gasto | RF-11 |
| VM-04 | Modal Novo Produto com abas Geral, Financeiro, Estoque, Variações, Fornecedor, Canais e upload de foto | RF-03 |
| VM-05 | Fornecedores, busca, estado, CPF/CNPJ, cidade/UF e contagens | RF-06 |
| VM-06 | Catálogos online e preview Desktop/Mobile com identidade de vendedor e produtos | RF-14 |
| VM-07 | Segunda captura de tela de Gastos Operacionais, resumo, período e categoria | RF-11; captura repetida/variação a comparar visualmente |
| VM-08 | Contas a receber, pendente, recebido hoje, vence semana, atrasados, títulos e relatório | RF-10 |
| VM-09 | Modal Nova Venda, busca/produtos, quantidade, canal, pagamentos divididos e total/lucro | RF-07/RF-08; concorrência é proposta deste plano |
| VM-10 | Clientes, busca por nome/e-mail/telefone/documento e novo cliente | RF-06 |
| VM-11 | Analytics do catálogo bloqueado por plano | RF-14/RF-16 |
| VM-12 | Dashboard com primeiros passos, meta, KPIs, receita/lucro, caixa, vendas por canal/pagamento, avisos | RF-12 |
| VM-13 | Categorias em cards com contagem e ações | RF-03 |
| VM-14 | Produtos, atalhos de estoque, filtros, colunas, custo, preço, margem, estoque e ações | RF-03/RF-05 |
| VM-15 | Relatórios, filtros por período, vendas, lucro, itens, margem, gráficos, top produtos, canais e histórico | RF-12 |
| VM-16 | Analytics em composição vertical responsiva; métricas de eficiência, giro, rentabilidade, liquidez, crescimento, tendências, ticket e sazonalidade | RF-12 |

Capturas comprovam apenas o que pode ser visto; não assumir que estados vazios demonstram funcionamento. Imagens VM-03 e VM-07 parecem retratar a mesma tela/área, verificar se são duplicatas idênticas. Menus visíveis sugerem existência de compras? O menu capturado exibe Produtos, Categorias, Vendas, Serviços, Canais e pagamentos; finanças; catálogo; cliente e fornecedor; configuração de Perfil.

## Instrução de leitura para o Claude

Criar `docs/LEITURA_VISUAL.md`. Para cada ID, registrar detalhes legíveis do que efetivamente viu, separando visual observado de comportamento inferido e requisitos adicionais deste pacote. Não ler ou transcrever informação pessoal de contas que apareça no rodapé; não carregar nomes, e-mails, logo, trial, valores demonstrativos ou banner de domínio no SaaS novo.
