-- A nova tabela comercial admite o ciclo mensal no plano ilimitado.
-- Conserva os pedidos e montantes existentes e as restantes validações de Modelagem.
ALTER TABLE payment_requests DROP CONSTRAINT payment_requests_modeling_check;
--> statement-breakpoint
ALTER TABLE payment_requests ADD CONSTRAINT payment_requests_modeling_check CHECK (
  kind <> 'modeling_subscription' OR (
    tier_key IS NOT NULL AND tier_key IN ('pme', 'corporate', 'enterprise10', 'unlimited') AND
    cycle IS NOT NULL AND cycle IN ('monthly', 'semiannual', 'annual') AND
    extra_users IS NOT NULL AND extra_users >= 0 AND
    ((tier_key = 'unlimited' AND project_limit IS NULL) OR (tier_key <> 'unlimited' AND project_limit IS NOT NULL AND project_limit >= 1)) AND
    period_start IS NOT NULL AND period_end IS NOT NULL AND period_end >= period_start AND amount_minor > 0
  )
);
