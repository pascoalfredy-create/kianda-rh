-- Kianda Valora: planos publicados por análises activas (10, 20, 30, 40, ilimitadas).
-- A licença guarda o plano e o ciclo; os pedidos de pagamento do Valora são validados como os da Modelagem.
ALTER TABLE company_modules DROP CONSTRAINT company_modules_plan_key_check;
--> statement-breakpoint
ALTER TABLE company_modules ADD CONSTRAINT company_modules_plan_key_check CHECK (
  plan_key IS NULL OR
  (module = 'modeling' AND plan_key IN ('pme', 'corporate', 'enterprise10', 'unlimited')) OR
  (module = 'valuation' AND plan_key IN ('essencial', 'pme', 'corporate', 'enterprise40', 'unlimited'))
);
--> statement-breakpoint
ALTER TABLE payment_requests ADD CONSTRAINT payment_requests_valuation_check CHECK (
  kind <> 'valuation_subscription' OR (
    tier_key IS NOT NULL AND tier_key IN ('essencial', 'pme', 'corporate', 'enterprise40', 'unlimited') AND
    cycle IS NOT NULL AND cycle IN ('monthly', 'semiannual', 'annual') AND
    extra_users IS NOT NULL AND extra_users >= 0 AND
    ((tier_key = 'unlimited' AND project_limit IS NULL) OR (tier_key <> 'unlimited' AND project_limit IS NOT NULL AND project_limit >= 1)) AND
    period_start IS NOT NULL AND period_end IS NOT NULL AND period_end >= period_start AND amount_minor > 0
  )
);
--> statement-breakpoint
-- Os sectores contratados são da Modelagem: o Valora não tem sectores, mas guarda plano.
ALTER TABLE company_modules DROP CONSTRAINT company_modules_sectors_check;
--> statement-breakpoint
ALTER TABLE company_modules ADD CONSTRAINT company_modules_sectors_check CHECK (
  jsonb_typeof(modeling_sectors) = 'array' AND
  modeling_sectors <@ '["mineracao","petroleo","agro","comercio","servicos","industria","imobiliario","tecnologia"]'::jsonb AND
  (plan_key IS NULL OR module <> 'modeling' OR (primary_sector IS NOT NULL AND modeling_sectors ? primary_sector AND
    jsonb_array_length(modeling_sectors) = CASE plan_key WHEN 'pme' THEN 2 WHEN 'corporate' THEN 4 ELSE 8 END))
);
