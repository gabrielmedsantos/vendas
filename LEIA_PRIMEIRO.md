# Plano completo — SaaS de compra, venda e troca

Versão 1.1 • 25/09/2026 • Documento de especificação para implementação com Claude Code. Direção visual atualizada por solicitação do usuário.

Este pacote contém o plano, e não um sistema já desenvolvido. O escopo foi consolidado a partir das 16 imagens do VendaMax fornecidas pelo usuário, pesquisa pública do BrikLucro e decisões de produto propostas para atender compra, venda e troca. As funções internas do BrikLucro não puderam ser verificadas: o site exige login.

## Como usar

1. Extraia o ZIP inteiro em uma pasta de projeto. Preserve `referencias/` e todas as imagens. As pranchas FlowPay guiam visual/cores/fontes; VendaMax guia módulos e funções.
2. Abra essa pasta no terminal ou no editor em que utiliza Claude Code.
3. Inicie o Claude Code dentro dessa pasta e envie o conteúdo de `prompts/01_INICIAR.md`.
4. O arquivo `CLAUDE.md` orienta o trabalho e indica a ordem de leitura. O agente deve abrir as imagens, não apenas listar seus nomes.
5. A implementação segue as fases de `docs/07_EXECUCAO_E_BACKLOG.md`. Para continuar em outra sessão, use `prompts/02_CONTINUAR.md`.
6. Quando houver aplicação funcional e validada, siga `docs/08_VPS_E_OPERACAO.md` e `prompts/03_PREPARAR_VPS.md`.

Se o projeto estiver no computador e o Claude Code estiver na VPS, copie o pacote extraído para a pasta de trabalho da VPS. Um caminho do seu computador não fica disponível automaticamente no servidor. Não envie credenciais da VPS dentro do ZIP nem coloque o pacote de referência em uma pasta pública do site.

## O que está incluído

| Arquivo/pasta | Finalidade |
|---|---|
| `CLAUDE.md` | Regras permanentes do projeto e ordem de leitura |
| `docs/00_RESUMO_E_DECISOES.md` | Visão, premissas, prioridades e decisões em aberto |
| `docs/01_REQUISITOS_FUNCIONAIS.md` | Módulos, campos, comportamentos e critérios de aceite |
| `docs/02_REGRAS_COMPRA_VENDA_TROCA.md` | Estoque, custo, pagamentos, trocas e exemplos numéricos |
| `docs/03_ARQUITETURA_E_SEGURANCA.md` | Stack, isolamento por empresa, autenticação e permissões |
| `docs/04_MODELO_DE_DADOS.md` | Entidades, relações, restrições e estados |
| `docs/05_API_E_EVENTOS.md` | Contratos de API, transações, idempotência e tarefas |
| `docs/06_INTERFACE_E_TELAS.md` | Navegação, estilo visual e experiência desktop/celular |
| `docs/07_EXECUCAO_E_BACKLOG.md` | Fases, dependências, tarefas e gates de entrega |
| `docs/08_VPS_E_OPERACAO.md` | Deploy, backup, restauração, monitoramento e rollback |
| `docs/09_TESTES_E_ACEITE.md` | Cenários funcionais, segurança, concorrência e números esperados |
| `docs/10_REFERENCIAS_E_FONTES.md` | Comparação, evidências e limites da pesquisa |
| `docs/11_SAAS_PLANOS_E_ADMIN.md` | Assinaturas, planos, cobrança e painel da plataforma |
| `prompts/` | Instruções prontas para iniciar, continuar, implantar e incorporar referência 2 |
| `referencias/01_vendamax/` | 16 PNGs originais, índice e mapa dos nomes originais |
| `referencias/02_briklucro/` | Pesquisa pública e captura da tela de login |
| `referencias/03_flowpay/` | 16 pranchas do Behance e índice do design system FlowPay |
| `exemplos/` | Cenários verificáveis e exemplo de variáveis sem segredos |

## Resultado desejado

Aplicação web responsiva para várias empresas, com produtos por quantidade ou unidade individual, compras, vendas, trocas com diferença, estoque, clientes, fornecedores, contas a pagar/receber, caixa, relatórios, documentos e gestão das assinaturas do próprio SaaS. Implementação original: aparência orientada pelo FlowPay; arquitetura de módulos e informações observadas no VendaMax; comparação cautelosa com o BrikLucro.

Para a primeira versão comercial, priorizar confiabilidade das operações e dos saldos. Catálogo, loja, analytics avançado, indicação e integrações entram em fases posteriores explicitamente definidas. Nenhum item futuro deve aparecer como botão que finge funcionar.

## O que ainda precisa ser informado

Nome/marca do SaaS; segmento prioritário; domínio; sistema operacional, memória, CPU e uso atual da VPS; provedor de e-mail; gateway para cobrar assinaturas; regras comerciais finais dos planos. Há padrões provisórios no plano para o Claude avançar localmente sem ficar bloqueado.

O acesso completo ao BrikLucro continua pendente. Sua pesquisa não autoriza afirmar que o sistema tenha as funções propostas neste pacote.
