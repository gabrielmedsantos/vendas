# SaaS, planos e painel do operador

## Entidades comerciais da plataforma

Plano versionado por vigência com preço mensal/anual em centavos, dias de teste, limite de usuários, produtos, armazenamento, movimento mensal e empresas/filiais, permissões de módulos e política de suporte. Valores comerciais finais ficam por configurar; não foram informados. Tiers devem ser administráveis sem alterações de código e mudanças de preço aplicam-se apenas a renovações futuras quando política aprovada.

Trial/assinatura registra início/fim, `current_period_start/end`, cobrança seguinte, gateway/customer/subscription IDs, cancelamento e estado. Máquina sugerida: trialing → active → past_due (período de tolerância configurável) → suspended → active após confirmação ou canceled. Transições são idempotentes e auditadas; webhook é fonte de confirmação depois de verificar assinatura. Gateway desconhecido: adapter manual em homologação, nenhum checkout falso apresentado como conectado.

## Limites e entitlements

Middleware/domínio consulta cache curto e fonte de verdade; operações críticas conferem novamente server-side. Limite de armazenamento contabiliza fotos/documentos. Exceder não descarta dados. Bloquear expansão até downgrade/compra de plano; permitir consultar/baixar dados próprios e acessar suporte/faturamento conforme política. Suspensão por cobrança não apaga lançamentos nem documentos.

## Painel do operador

Acesso em domínio/rota protegidos, usuários com função independente dos tenants, MFA e allowlist futura. Métricas agregadas minimizadas: empresas ativas, trials, assinaturas, receita recorrente conforme base correta, falhas de cobrança e saúde de backups/filas. Suporte tem impersonação desabilitada por padrão; se introduzida, consentimento/permissão explícita, duração curta, justificativa, faixa visual de aviso e trilha inviolável. Não exibir clientes/valores empresariais em analytics global sem finalidade e autorização.

Gestão de plano/pagamento, bloquear/reativar empresa com motivo, ver eventos de webhook, corrigir plano por ação administrativa auditada, gerir artigos de ajuda e preparar exportação/exclusão somente após checar efeitos e requisitos aplicáveis.

## Princípios de cobrança

Preço, periodicidade, impostos e termos devem ser preenchidos/validados pelo operador antes de cobrar alguém. Idempotência por período/tenant evita fatura dupla. Falha de gateway mostra estado pendente, retry com limites e opção manual autorizada. Reembolsos e chargebacks viram eventos conciliáveis; não apagam nota histórica. Tela informa moeda, recorrência e data próxima cobrança de forma visível e permite cancelamento segundo política contratada.

Para o piloto: plano interno/grátis criado manualmente pelo operador, billing em modo sandbox e sem transmissão de cobrança real. Ativar gateway real só quando credencial, webhook, textos comerciais e conciliação tiverem sido definidos.
