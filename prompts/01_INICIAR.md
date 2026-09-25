# Prompt inicial — copiar para o Claude Code

Quero que você implemente um SaaS completo para empresas de compra, venda e troca, usando o plano desta pasta. A hospedagem será em uma VPS minha. Comece pelo ambiente local e deixe implantação reproduzível com Docker Compose.

Leia `CLAUDE.md`, todos os documentos de `docs/` e os índices de `referencias/`. Abra e analise visualmente as 16 imagens de `referencias/01_vendamax/imagens/`, em grupos pequenos, incluindo as telas de Dashboard, Produtos, Novo Produto e Nova Venda. Registre quais imagens conseguiu ler. Consulte a pesquisa de BrikLucro e respeite sua limitação de acesso: não diga que leu a área interna se só há uma tela de login.

Preciso de um produto funcional: várias empresas isoladas, usuários e permissões, produtos, compras, vendas, trocas, estoque, clientes, fornecedores, contas a pagar/receber, caixa, lucro, relatórios, documentos e assinaturas do SaaS. Siga a sequência completa do backlog; os módulos posteriores estão definidos no plano.

Use a stack proposta, verificando compatibilidade das versões na documentação oficial. Antes de implementar, apresente uma síntese curta da arquitetura e das decisões reversíveis adotadas, crie `docs/DECISOES.md` e `docs/STATUS.md` e avance para a fase 0 e a fundação do projeto. Continue pelas dependências conforme as etapas forem verificadas. Não pare apenas após elaborar outro plano ou montar uma interface sem backend.

O ponto mais importante é a operação de troca: dar baixa no produto vendido, registrar o produto recebido com custo próprio, compensar títulos sem criar dinheiro fictício e cobrar ou pagar somente a diferença. Inclua os testes numéricos do plano, estornos e duas vendas concorrentes do mesmo item.

Use nome provisório “Gestão Compra e Troca”, BRL e interface pt-BR. Não copie marcas ou dados pessoais das referências. Se informações da VPS, gateway ou e-mail ainda faltarem, construa os adaptadores e documentação, mantenha integrações desligadas e continue o restante. Não faça deploy na VPS antes de verificar sua configuração real e preparar backup/rollback.

Ao final de cada etapa, informe o que funciona, o que foi testado de fato e o próximo passo; mantenha o status atualizado para eu retomar em outra sessão.
