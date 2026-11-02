-- Valora: os limites passaram a 3/10/20/40/ilimitadas (02/11/2026). As avaliações gratuitas abertas com os limites
-- da primeira tabela (10/20/30) e os pedidos de pagamento ainda pendentes ficam alinhados com o plano actual.
-- Licenças já pagas não mudam. Nunca abaixo das análises activas da empresa. Cada alteração fica na auditoria.
WITH target(plan_key, new_limit) AS (VALUES ('essencial', 3), ('pme', 10), ('corporate', 20)),
active AS (
  SELECT company_id, count(*)::int AS n FROM valuation_analyses WHERE archived_at IS NULL GROUP BY company_id
),
before AS (
  SELECT m.id, m.project_limit AS old_limit, GREATEST(t.new_limit, COALESCE(a.n, 0)) AS new_limit
  FROM company_modules m
  JOIN target t ON t.plan_key = m.plan_key
  LEFT JOIN active a ON a.company_id = m.company_id
  WHERE m.module = 'valuation' AND m.status = 'trial' AND m.project_limit IS DISTINCT FROM GREATEST(t.new_limit, COALESCE(a.n, 0))
),
changed AS (
  UPDATE company_modules m SET project_limit = b.new_limit, updated_at = now()
  FROM before b WHERE m.id = b.id
  RETURNING m.*, b.old_limit
)
INSERT INTO audit_logs (company_id, actor_id, action, entity, entity_id, before, after)
SELECT company_id, 'migration:0042_valuation_align_trial_limits', 'module_subscription', 'company_module', id,
       jsonb_build_object('projectLimit', old_limit, 'planKey', plan_key, 'status', status),
       jsonb_build_object('projectLimit', project_limit, 'planKey', plan_key, 'status', status, 'reason', 'Valora: limites do plano actualizados (Essencial 3, PME / Grupo 10, Corporate 20)')
FROM changed;
--> statement-breakpoint
WITH target(plan_key, new_limit) AS (VALUES ('essencial', 3), ('pme', 10), ('corporate', 20)),
changed AS (
  UPDATE payment_requests r SET project_limit = t.new_limit
  FROM target t
  WHERE r.kind = 'valuation_subscription' AND r.status = 'pending' AND r.tier_key = t.plan_key AND r.project_limit <> t.new_limit
  RETURNING r.*
)
INSERT INTO audit_logs (company_id, actor_id, action, entity, entity_id, before, after)
SELECT company_id, 'migration:0042_valuation_align_trial_limits', 'update', 'payment_request', id,
       jsonb_build_object('tierKey', tier_key),
       jsonb_build_object('tierKey', tier_key, 'projectLimit', project_limit, 'reason', 'Valora: limite do plano actualizado; montante sem alteração')
FROM changed;
