-- Planos de referência PROVISÓRIOS (preço zero). Valores comerciais reais devem ser
-- configurados pelo operador no painel da plataforma antes de qualquer cobrança.
insert into plans (code, name, description, public, sort_order) values
  ('piloto', 'Piloto', 'Plano interno do piloto com período de teste. Preço a definir pelo operador.', false, 0),
  ('gratuito', 'Gratuito', 'Plano básico com limites reduzidos. Preço a definir pelo operador.', true, 1);

insert into plan_versions (plan_id, version, price_monthly_cents, trial_days, limits, features)
select id, 1, 0, 14,
       '{"users": 10, "products": 10000, "storage_mb": 2048, "monthly_sales": 10000}'::jsonb,
       array['catalog', 'catalog_analytics', 'reports_export']
from plans where code = 'piloto';

insert into plan_versions (plan_id, version, price_monthly_cents, trial_days, limits, features)
select id, 1, 0, 0,
       '{"users": 2, "products": 200, "storage_mb": 200, "monthly_sales": 300}'::jsonb,
       array['catalog']
from plans where code = 'gratuito';
