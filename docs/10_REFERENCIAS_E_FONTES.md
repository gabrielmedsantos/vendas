# Referências e limites da pesquisa

## VendaMax — telas enviadas pelo usuário

16 PNGs organizados em `referencias/01_vendamax/imagens/`. O mapa original → nome de pacote está em `referencias/01_vendamax/MAPA_ARQUIVOS.csv`; observações visuais em `referencias/01_vendamax/INDICE.md`. São capturas sem estado real populado ou com alguns valores exemplificativos. Usar para inventário de navegação, widgets e dados visíveis; não prova implementação completa, correção contábil ou regras de negócio.

## BrikLucro — pesquisa pública executada em 25/09/2026

- Página pública: https://briklucro.com/ — resultado de busca e texto indexado: “Controle suas vendas, produtos e lucros” e posicionamento de clareza financeira/crescimento.
- Navegação direta levou para `https://briklucro.com/login?from_url=https%3A%2F%2Fbriklucro.com%2F`; a tela oferece login Google, e-mail/senha, recuperar acesso e cadastro. Captura: `referencias/02_briklucro/BR-01-login.jpg`.
- https://briklucro.com/home não pôde ser acessada diretamente na ferramenta pública. Páginas protegidas não foram exploradas. Textos de página de atualização de plano indexada não foram tratados como características do produto.
- Portanto: nome, proposta e login são observados; vendas, produtos e lucros são explícitos na apresentação pública. Qualquer módulo além disso não está verificado. Não usar credenciais alheias ou contornar login.

## FlowPay — referência visual adicionada pelo usuário

Behance: https://www.behance.net/gallery/252867431/FlowPay-Fintech-SaaS-Platform — projeto de Daniil Alekhin. Navegação direta mostra 16 pranchas de dashboard SaaS e seção de “Visual Direction” que lista as cores e a tipografia adotadas no documento de interface. Arquivos organizados em `referencias/03_flowpay/imagens/FP-01.webp` até `FP-16.webp`; índice em `referencias/03_flowpay/INDICE.md`.

A prancha apresenta estética fintech dark-first, Inter, acentos roxos, estados semânticos, cards arredondados, painel analítico e adaptações para celular. Códigos de cor e tipografia constam de `docs/06_INTERFACE_E_TELAS.md`. Isso é orientação visual, não autorização para copiar logo/identidade/texto/frames como produto acabado. Fazer adaptação própria para varejo brasileiro e checar licença de fontes/ativos de terceiros antes de distribuir.

## Documentação técnica consultada — fontes primárias

- Next.js self-hosting: https://nextjs.org/docs/app/guides/self-hosting — opções Node/Docker para hospedar; versão deve ser checada quando iniciar o projeto.
- Docker Compose production: https://docs.docker.com/compose/how-tos/production/ — práticas de operação em produção.
- PostgreSQL Row Security: https://www.postgresql.org/docs/17/ddl-rowsecurity.html — políticas, FORCE RLS e permissões por linha.
- Claude Code common workflows: https://code.claude.com/docs/en/common-workflows — referência sobre fornecer caminhos/imagens e fluxos de trabalho com arquivos do projeto.
- Claude Code memory: https://code.claude.com/docs/en/memory — uso de CLAUDE.md como memória/instrução do projeto.

Stack e documentação mudam. Conferir docs da versão instalada no início de implementação e fixar as versões reais no projeto. Pesquisa não configura uma VPS nem prova que ela tem recurso suficiente.
