# Arquitetura e segurança

## Stack proposta

Monólito modular TypeScript, Next.js/React para interface e endpoints, PostgreSQL como fonte de verdade, Prisma para consultas/migrações e SQL revisado para locks e políticas RLS. Tailwind para implementar tokens; componentes acessíveis baseados em Radix/shadcn quando compatíveis; gráficos via biblioteca React mantida. Vitest para domínio, PostgreSQL real em testes de integração e Playwright para jornadas.

Autenticação: biblioteca mantida com suporte a sessões revogáveis, convite, recuperação e MFA; avaliar Better Auth ou equivalente compatível e fixar escolha em ADR na fase 0. Node em versão LTS suportada, versões fixadas em lockfile e imagens por versão/digest. A seleção final das versões e APIs deve ser validada nas documentações oficiais, sem presumir a versão atual deste pacote.

Worker separado executa PDFs, exportações, notificações e eventos da assinatura. Outbox PostgreSQL + fila baseada em PostgreSQL no início, sem Redis obrigatório. Worker compartilha os serviços de domínio, não reimplementa regras. Repetição de tarefa não repete efeito financeiro.

Armazenamento inicial em volume privado fora do diretório público; metadados no banco; adaptador para S3 futuro. Proxy Caddy com TLS, ou integração com o proxy já existente na VPS. Não instalar outro proxy em conflito com serviços presentes. Docker Compose coordena aplicação, worker, banco e proxy.

## Separação interna

| Camada | Responsabilidade |
|---|---|
| UI | Formulários, tabelas, interação, estado remoto |
| API | Sessão, validação de entrada, autorização, DTOs, erros |
| Aplicação | Casos de uso e fronteiras transacionais |
| Domínio | Cálculos, invariantes, estados e políticas |
| Persistência | Repositórios com tenant, locks, SQL e migrações |
| Integrações | E-mail, cobrança SaaS, arquivos, assinatura/fiscal futuros |
| Worker | Consumidores idempotentes e tarefas reprocessáveis |

Não acessar Prisma diretamente a partir de componentes de interface. Server Actions, se usadas, passam pelas mesmas verificações do endpoint. Separar módulos auth/tenancy, catalog, purchasing, inventory, sales, trades, finance, reporting, documents e billing.

## Multiempresa

Toda tabela empresarial tem `tenant_id NOT NULL`. Usar chaves estrangeiras compostas `(tenant_id, parent_id)` e `UNIQUE(tenant_id,id)` quando necessário, impedindo relacionamentos cruzados. Índices começam por tenant e incluem status/data apropriados. Usuário e catálogo global de planos ficam fora do conjunto empresarial, com regras próprias.

Na requisição: validar sessão → verificar membership ativa → obter empresa autorizada → validar permissão → abrir transação → `set_config('app.tenant_id', tenantId, true)` → consultas via cliente transacional. Nunca aceitar tenant vindo do corpo como autorização. Contexto é local à transação, sem vazar em pools de conexões.

Usar PostgreSQL RLS como segunda barreira: `ENABLE ROW LEVEL SECURITY` e `FORCE ROW LEVEL SECURITY`, políticas `USING` e `WITH CHECK` para tenant. Usuário runtime não é superuser, dono das tabelas ou `BYPASSRLS`. Migração usa credencial separada. Ausência de contexto nega acesso. Testar a combinação real ORM/pool/RLS, inclusive erros e reutilização de conexão.

Rotas do control plane e autenticação global usam repositórios restritos específicos. Não conceder acesso global ao usuário runtime empresarial. Provisionamento de tenants e jobs globais usam papel dedicado de privilégio mínimo. Cada tarefa empresarial carrega tenant e revalida situação/autorização aplicável.

Cache usa tenant + permissões + filtros; páginas autenticadas não entram em cache público. Downloads, anexos, exports e PDFs validam tenant/owner. Catálogo público usa projeção explícita de campos públicos e publicação ativa, nunca `SELECT *` do produto empresarial.

## Matriz inicial de permissões

| Ação | Dono | Gestor | Vendedor | Estoque | Financeiro | Consulta |
|---|---|---|---|---|---|---|
| Vender | Sim | Sim | Sim | Não | Não | Não |
| Confirmar troca | Sim | Sim | Configurável | Não | Não | Não |
| Ver custo/lucro | Sim | Sim | Não padrão | Custo configurável | Sim | Não padrão |
| Comprar/receber | Sim | Sim | Não | Receber | Não | Não |
| Ajustar estoque | Sim | Sim | Não | Com permissão | Não | Não |
| Baixar contas | Sim | Sim | Só recebimento da própria venda, se habilitado | Não | Sim | Não |
| Estornar | Sim | Com permissão | Não | Não | Financeiro com permissão | Não |
| Exportar | Sim | Com permissão | Não padrão | Não padrão | Financeiro | Não padrão |
| Gerir membros/assinatura | Sim | Não padrão | Não | Não | Não | Não |

Consulta pode ler apenas conjuntos concedidos, não todos os dados. Campo “configurável” é negado por padrão. Regras com limites de desconto/margem exigem aprovação do gestor registrada.

## Controles concretos

- Cookies HttpOnly, Secure em produção e SameSite adequado; proteção CSRF nas mutações; validação de origem. Não armazenar sessão em localStorage.
- Rate limit para login/recuperação, convites, catálogo e uploads; mensagens de recuperação sem revelar existência de e-mail.
- Tokens de recuperação/convite curtos, expiráveis e armazenados de forma não reutilizável. Hash de senha pelo mecanismo seguro da biblioteca.
- MFA obrigatório para painel da plataforma e recomendado ao dono. Reautenticar em operações sensíveis.
- Validação de schema no servidor, SQL parametrizado, renderização segura, CSP e cabeçalhos de segurança.
- Upload: validar MIME real e extensão, limites, nome aleatório, reprocessamento de imagem, armazenamento privado e autorização no download. Não executar uploads nem buscar URLs arbitrárias em servidor.
- Logs estruturados com request_id, tenant_id e action; ocultar senhas, tokens, documentos completos, cookies e payloads pessoais desnecessários.
- Auditoria de alterações críticas, exportações, acessos de suporte, estornos, mudanças de preço/custo e permissões. Aplicação não pode apagar auditoria pelo fluxo normal.
- Escopo e retenção de dados configurados e documentados; exportação/correção/exclusão tratadas conforme obrigações aplicáveis, sem prometer eliminação indiscriminada de históricos necessários.
- Dependências revisadas, lockfile, segredos fora de Git, usuário de container sem root, portas internas não públicas.

## Operabilidade e metas verificáveis

Health de processo separado de readiness com banco. Logs, duração de requests/jobs e contadores de falha. Alerta para erro de confirmação, fila atrasada, backup vencido e disco baixo. Metas iniciais propostas, a medir na VPS: p95 < 800 ms em listagens paginadas e < 1,5 s em confirmações sob carga piloto; PDF assíncrono fora dessa meta. Teste inicial: 20 usuários simultâneos em 10 empresas e 10 mil produtos por empresa, ajustável ao hardware real. Não prometer capacidade antes de medir.
