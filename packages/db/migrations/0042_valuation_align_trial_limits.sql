-- Valora: as avaliações abertas antes dos limites por segmento (02/11/2026) passam ao limite actual do plano gravado
-- (Essencial 3 · PME / Grupo 10 · Corporate 20 · Profissional 40 · Ilimitado sem limite).
-- Só licenças em período experimental; subscrições pagas conservam o limite que pagaram.
-- Nunca abaixo do uso: uma empresa com mais análises activas do que o novo limite fica como está.
WITH novo AS (
  SELECT cm.id, cm.company_id, cm.project_limit AS antes,
    CASE cm.plan_key WHEN 'essencial' THEN 3 WHEN 'pme' THEN 10 WHEN 'corporate' THEN 20 WHEN 'enterprise40' THEN 40 END AS depois
  FROM company_modules cm
  WHERE cm.module = 'valuation' AND cm.status = 'trial' AND cm.plan_key IN ('essencial', 'pme', 'corporate', 'enterprise40')
), elegivel AS (
  SELECT n.* FROM novo n
  WHERE n.antes IS DISTINCT FROM n.depois
    AND (SELECT count(*) FROM valuation_analyses va WHERE va.company_id = n.company_id AND va.archived_at IS NULL) <= n.depois
), alterado AS (
  UPDATE company_modules cm SET project_limit = e.depois, updated_at = now()
  FROM elegivel e WHERE cm.id = e.id
  RETURNING cm.id, cm.company_id, e.antes, e.depois
)
INSERT INTO audit_logs (company_id, actor_id, action, entity, entity_id, before, after)
SELECT a.company_id, 'sistema', 'module_limits_aligned', 'company_module', a.id,
  jsonb_build_object('projectLimit', a.antes), jsonb_build_object('projectLimit', a.depois, 'motivo', 'Limites do Valora por segmento (02/11/2026)')
FROM alterado a;
