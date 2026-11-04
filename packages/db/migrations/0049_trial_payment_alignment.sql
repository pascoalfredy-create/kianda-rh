-- A extensão da experiência não consome dias de um período ainda por pagar.
-- Conserva montantes, referências e estados; só alinha os pedidos pendentes afectados.
WITH trials AS (
  SELECT company_id, 'subscription' AS kind, trial_ends_at
  FROM subscriptions
  WHERE status = 'trial' AND paid_until IS NULL AND trial_ends_at IS NOT NULL
  UNION ALL
  SELECT company_id,
    CASE module WHEN 'modeling' THEN 'modeling_subscription' ELSE 'valuation_subscription' END AS kind,
    trial_ends_at
  FROM company_modules
  WHERE module IN ('modeling', 'valuation') AND status = 'trial'
    AND paid_until IS NULL AND trial_ends_at IS NOT NULL
)
UPDATE payment_requests AS p
SET period_start = t.trial_ends_at + 1,
    period_end = ((t.trial_ends_at + 1)::timestamp
      + CASE p.cycle
          WHEN 'monthly' THEN interval '1 month'
          WHEN 'semiannual' THEN interval '6 months'
          WHEN 'annual' THEN interval '12 months'
        END
      - interval '1 day')::date
FROM trials AS t
WHERE p.company_id = t.company_id AND p.kind = t.kind
  AND p.status = 'pending' AND p.cycle IN ('monthly', 'semiannual', 'annual')
  AND p.period_start IS NOT NULL AND p.period_start <= t.trial_ends_at;
