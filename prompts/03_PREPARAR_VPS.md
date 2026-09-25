# Prompt para preparar implantação na VPS

Leia `CLAUDE.md`, `docs/08_VPS_E_OPERACAO.md`, `docs/03_ARQUITETURA_E_SEGURANCA.md`, `docs/09_TESTES_E_ACEITE.md` e o estado do release. Acesse a VPS somente pelo SSH já configurado no meu ambiente. Antes de mudar qualquer coisa, levante SO/versão, CPU, RAM, disco, DNS, firewall, portas, proxy existente, Docker, containers, volumes, banco, serviços e backup atual. Não copie nem mostre segredo.

Prepare documentação/Compose e checklist para esse ambiente concreto. Preserve serviços e dados existentes. Não instale proxy que conflite, não faça migração destrutiva, não desligue serviços, não exclua volume e não coloque segredos em arquivos rastreados.

Valide migração e release em homologação. Confirme um backup fora da VPS por checksum e faça teste de restauração isolado. Mostre uma lista curta de comandos e mudanças que seriam necessários antes de alterar o tráfego de produção. Espere minha autorização para a publicação definitiva se a operação puder interromper serviço, alterar DNS/produção, sobrescrever dados ou introduzir cobrança. Até isso, encerre com o artefato pronto e os itens pendentes verificáveis.
