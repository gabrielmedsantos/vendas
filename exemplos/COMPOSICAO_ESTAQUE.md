# Exemplo de dados sintéticos

Documento didático para ambiente `development` ou `test` exclusivamente; criar duas empresas de teste e valores claramente fictícios.

## Troca simples de celular

Empresa Demo A: saída de um celular SKU DEMO-SAI-001 a R$ 4.000; lote original custo R$ 3.000. Entrada do item serializado DEMO-IMEI-001 avaliado em R$ 1.500. Forma: Pix R$ 2.500. Resultado esperado: CMV R$ 3.000, resultado bruto R$ 1.000, entrada de caixa R$ 2.500, novo inventário unitário a custo R$ 1.500, compensação R$ 1.500 e sem diferença em aberto.

Usar somente identificadores sintéticos tipo `DEMO-IMEI`, nunca IMEI real. Cliente: “Cliente Demonstração”. Não colocar CPF verdadeiro.

Empresa Demo B deve ter seus próprios produtos/categorias e dados, para teste de tenant. Pesquisar produto ou cliente da Empresa Demo A logado como usuário B não deve retornar informação.

## Variáveis locais

Nomes exemplificativos no `.env.example` que o projeto deverá criar: `DATABASE_URL`, `AUTH_SECRET`, `APP_URL`, `STORAGE_PATH`, `SMTP_URL`, `BILLING_PROVIDER`, `BILLING_WEBHOOK_SECRET`. Valores verdadeiros só no ambiente local/prod seguro; este pacote não contém nenhum segredo.
