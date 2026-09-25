# Interface e design system

## Hierarquia das referências

1. **FlowPay, Behance, Daniil Alekhin:** fonte visual primária. Usar cores, tipografia, proporções de cards, superfície escura, acento roxo, estados semânticos, gráficos e adaptação mobile como norte. Não copiar marca, textos de exemplo nem nomes/valores mostrados nas imagens.
2. **VendaMax, imagens originais enviadas:** referência de informação e amplitude funcional: barra lateral, dashboard, produtos/categorias, venda modal, clientes, fornecedores, catálogo, caixa/contas, despesas, analytics e relatórios. Redesenhar dentro do FlowPay. Não replicar o neon verde nem a disposição de pixel.
3. **BrikLucro:** evidência pública limitada a proposta de vendas, produtos e lucros e uma tela de login. Complementar somente com evidência enviada ou acesso autorizado.

## Tokens FlowPay confirmados na prancha FP-04

| Token | Hex | Uso |
|---|---:|---|
| `background` | `#0D0E17` | fundo da aplicação |
| `surface` | `#12131C` | cartões e navegação |
| `primary` | `#8A62FF` | ação e seleção primária |
| `primary-soft` | `#A78BFA` | destaques e gráficos |
| `success` | `#7CFEB2` | saldo/status positivo |
| `warning` | `#F59E0B` | atenção/prazo próximo |
| `danger` | `#EF4444` | erro/atrasado/irreversível |
| `info` | `#60A5FA` | informação |

Configurar CSS variables/tokens sem espalhar hex. Conferir contraste WCAG AA para texto comum e botões; os valores exatos podem precisar de tons derivados acessíveis mantendo identidade. Cores semânticas sempre acompanham texto/ícone, nunca só cor.

## Tipografia e composição

Prancha descreve Inter Semibold em títulos e Inter Regular no corpo/legendas. As escalas mostradas são conceito gráfico de 56/32/22/14 px; aplicar responsivamente aos contextos de dashboard, aplicação e mobile, evitando título de 56 px numa tabela operacional. Hospedar a fonte com licença compatível ou usar fallback system. Não carregar dependências externas desnecessárias.

Geometria: cantos suavemente arredondados, borda sutil, profundidade discreta, cards com espaçamento generoso, grade adaptável. Dashboard com indicadores, série temporal, pendências e atividade recente. Tabelas densas, mas legíveis; moeda alinhada à direita; filtros evidentes. Formulários agrupados por blocos e confirmação dos totais antes de movimentar caixa/estoque.

## Shell e navegação

Desktop: sidebar recolhível e navegação agrupada; barra superior com empresa escolhida, busca, atalhos/avisos e usuário; título + descrição, período de análise padronizado. Módulos: Início; Operação (Vendas, Trocas, Compras, Serviços simples, Produtos, Estoque); Financeiro (Visão geral, Caixa, Receber, Pagar, Despesas, Relatórios); Clientes e fornecedores; Canais e pagamentos; Catálogo; Configurações (Empresa, Equipe, Permissões, Documentos, Plano).

Mobile: navegação curta por abas mais busca/“mais”; CTAs acessíveis; tabelas convertidas em cards ou com rolagem explícita; não esconder somas, custo/permissão, avisos ou ações de estorno. Modais grandes tornam-se páginas/drawers adequados. Compra/venda pode ser lançada com uma mão sem sacrificar confirmação da operação.

## Componentes e estados

Button primary/secondary/quiet/danger; input com label, ajuda e erro; select/command search; date range; data table; empty states que explicam primeiro passo; card; badge acessível; modal/drawer; toast sem substituir erro persistente; skeleton; paginação; tooltip com explicação da métrica; gráfico com legenda/texto alternativo/tabela acessível.

Toda tela contempla: carregamento, sem dados, busca vazia, validação, erro recuperável, falta de permissão, conflito de saldo, sucesso com próxima ação e layout em 360 px. Atalho de teclado não pode disparar uma confirmação financeira inadvertidamente. Confirmar ações destrutivas com resumo e motivo.

## Tela especial: Troca

Passos: selecionar contraparte → selecionar produtos que saem → avaliar o que entra → validar estado/identificadores → comparar totais → escolher diferença monetária/crédito → pagamento/parcelas → inspeção → confirmar. Resumo fixo do total de saída, avaliação de entrada, diferença e efeito em estoque/caixa. Microcopy explicita quem paga quem. Não usar cor como única indicação; valores econômicos devem ser rastreáveis em detalhes.

## Critério visual

Usar screenshots FlowPay como tokens/componentes e layout exploratório, adaptando o texto ao varejo brasileiro e aos fluxos de compra e troca. Antes de preencher todos os módulos, entregar shell + dashboard + uma jornada completa de venda e uma de troca para aprovação visual interna por screenshots locais. Depois reproduzir componentes consistentes nas demais telas. Cobrir viewport 1440×900, 1024×768, 390×844 e 360×800.

Visualizar HTML real no navegador durante desenvolvimento, não concluir pela compilação isolada. Verificar contraste, foco visível, navegação por teclado e erros em console/requisições.
