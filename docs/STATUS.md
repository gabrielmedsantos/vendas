# Status da implementação

Atualizado em 25/09/2026. Detalhes de decisões em `docs/DECISOES.md`.

## Fase atual
Fases 0–1 (fundação, tenant/auth/RLS) em andamento; serviços de domínio das fases 2–5 escritos e em teste.

## Verificado de fato
- Leitura visual: 16/16 VM, 16/16 FP, BR-01 (ver `docs/LEITURA_VISUAL.md`).
- `pnpm test` (unitários): 28 testes passando.
- `pnpm test:int` (PostgreSQL 16 real): 11 testes de isolamento/RLS/permissões passando (T-001, T-002, T-003, FK composta, papel público, vendedor sem custo, último proprietário, convite).

## Próximo passo
Testes de integração de compra/venda/troca (T-004…T-017), depois API e interface.
