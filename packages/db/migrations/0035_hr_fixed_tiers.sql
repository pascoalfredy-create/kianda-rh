-- O RH passa a ser comercializado apenas pelas faixas fixas.
-- Conservam-se montantes, referências e pagamentos já confirmados para auditoria.
WITH retired AS (
  UPDATE payment_requests SET status = 'cancelled'
  WHERE kind = 'extra_seats' AND status = 'pending'
  RETURNING *
)
INSERT INTO audit_logs (company_id, actor_id, action, entity, entity_id, before, after)
SELECT company_id, 'migration:0035_hr_fixed_tiers', 'cancel_retired_charge', 'payment_request', id,
       to_jsonb(retired) || '{"status":"pending"}'::jsonb,
       to_jsonb(retired) || '{"reason":"RH: cobrança de colaboradores extra descontinuada; planos de faixas fixas"}'::jsonb
FROM retired;
--> statement-breakpoint
UPDATE platform_settings
SET value = value - 'extraSeatMinor', updated_at = now()
WHERE key = 'commercial' AND value ? 'extraSeatMinor';
