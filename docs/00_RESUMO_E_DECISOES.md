# Visão de produto e decisões

## 1. Objetivo

Centralizar a operação de pequenos negócios que compram mercadorias, revendem e recebem outros produtos na negociação. Deve servir tanto ao estoque por quantidade, como roupas e acessórios, quanto a unidades individualizadas, como celulares e outros usados. O segmento inicial ainda não foi informado; eletrônicos são um exemplo de modelagem, não uma restrição do produto.

Uma empresa é um tenant. Um usuário pode participar de várias empresas, mas cada requisição opera em uma empresa selecionada e validada. Iniciar com uma localização por empresa; preparar o modelo para filiais sem entregar consolidação multiempresa indevida.

## 2. Escopo e evidência

- **Pedido do usuário:** SaaS de compra, venda e troca; construção com Claude Code; VPS própria; plano completo com imagens em ZIP; pesquisar referência 2.
- **Observado em imagens:** módulos e componentes do VendaMax descritos no índice. Uma tela vazia comprova layout e campos visíveis, não todo o comportamento do produto.
- **BrikLucro:** proposta pública de vendas, produtos e lucros; login visto no navegador. Os recursos internos e preços não foram confirmados.
- **Propostas deste plano:** fluxo transacional de troca, compras, contas a pagar, isolamento, testes, arquitetura, assinaturas, implantação e itens não detalhados nas imagens.

## 3. Recortes de entrega

| Marco | Entrega |
|---|---|
| MVP operacional, fases 0–5 | Fundação multiempresa, cadastros, estoque, compras, vendas, trocas, financeiro, documentos básicos, dashboard e relatórios essenciais |
| SaaS comercial, fases 6–7 | Planos, cobrança de assinatura, painel da plataforma, backups testados e instalação validada na VPS |
| Expansão, fase 8 | Catálogo, loja com pedido, serviços simples, analytics avançado, tutoriais e indicação |
| Integrações futuras, fase 9 | Fiscal, assinatura eletrônica, mensageria automática e pagamentos dos clientes da loja |

Compras e trocas pertencem ao MVP. Não adiar a estrutura multiempresa ou integridade de saldos para depois da primeira venda.

## 4. Decisões padrão propostas

| Tema | Padrão adotado | Pode mudar quando |
|---|---|---|
| Marca | Gestão Compra e Troca, provisório | Usuário informar identidade |
| Idioma/moeda | pt-BR / BRL | Internacionalização futura |
| Fuso | America/Sao_Paulo, configurável por empresa | Onboarding da empresa |
| Runtime | Node LTS suportado, TypeScript | Validação de compatibilidade na fase 0 |
| Aplicação | Next.js e React; monólito modular + worker | Escala justificar separação |
| Banco | PostgreSQL; Prisma; SQL explícito para RLS/locks | Limitação comprovada da stack |
| Estoque fungível | FIFO por lote | Decisão futura exige migração de método e reconciliação |
| Usados/serializados | Custo específico por unidade | Sempre preservado |
| Troca | Compra vinculada a venda + compensação | Regras do documento 02 |
| Estoque negativo | Proibido | Sem exceção no MVP |
| Reconhecimento gerencial | Venda confirmada na entrega; caixa na liquidação | Não misturar regimes |
| Assinatura SaaS | Trial e planos configuráveis; cobrança manual no piloto | Gateway real escolhido na fase 6 |
| Frontend | Escuro inspirado no VendaMax; identidade própria | Marca e feedback do usuário |
| Upload | Volume privado no piloto, interface para armazenamento S3 | Volume de dados/escala |
| Deploy | Docker Compose e proxy com TLS em VPS | Inventário da VPS orientar integração |

## 5. Dados necessários antes da produção

- VPS: provedor, sistema operacional e versão, vCPU, RAM, disco livre, arquitetura, serviços existentes e método de acesso seguro.
- Domínio e controle de DNS; ambiente de homologação; conta de backup externa à VPS.
- Nome da empresa operadora, contato de suporte e textos de contratação/privacidade aplicáveis.
- Provedor SMTP/transacional e gateway da assinatura; segredos cadastrados fora do repositório.
- Planos, preços, limites, dias de trial e tolerância de atraso comerciais.
- Política de descontos, cancelamentos, garantia comercial, comissões e avaliação de usados.
- Acesso autorizado ou capturas do BrikLucro para complementar evidências internas.

Essas pendências não impedem o desenvolvimento local. Não transformar um valor provisório em compromisso comercial. O plano não define obrigações fiscais ou cláusulas jurídicas; os documentos gerados devem usar modelos comerciais aprovados pelo operador.
