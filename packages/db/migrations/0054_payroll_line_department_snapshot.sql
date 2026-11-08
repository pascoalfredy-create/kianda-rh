-- Atribuição histórica: cada linha da folha guarda o departamento e o centro de custo do momento do cálculo.
ALTER TABLE "payroll_lines" ADD COLUMN "department_id" text;
--> statement-breakpoint
ALTER TABLE "payroll_lines" ADD COLUMN "cost_center" text;
--> statement-breakpoint
-- Linhas já existentes: fotografia do departamento actual (a melhor informação disponível).
UPDATE "payroll_lines" pl SET "department_id" = e."department_id", "cost_center" = d."cost_center"
FROM "employees" e LEFT JOIN "departments" d ON d."id" = e."department_id"
WHERE e."id" = pl."employee_id" AND pl."department_id" IS NULL;
