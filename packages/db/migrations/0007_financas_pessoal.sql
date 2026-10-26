ALTER TABLE "journal_entries" ADD COLUMN "exported_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD COLUMN "exported_by" text;--> statement-breakpoint
-- Descrições legíveis no plano de contas (antes era o nome técnico da função).
UPDATE "account_mappings" SET "label" = CASE "role"
  WHEN 'baseSalary' THEN 'Remunerações do pessoal — vencimento base'
  WHEN 'allowances' THEN 'Remunerações do pessoal — subsídios'
  WHEN 'overtimeAndBonus' THEN 'Remunerações do pessoal — horas extra e prémios'
  WHEN 'holidayChristmas' THEN 'Remunerações do pessoal — subsídios de férias e de Natal'
  WHEN 'employerSocialSecurity' THEN 'Encargos sobre remunerações — INSS entidade empregadora'
  WHEN 'irtPayable' THEN 'Estado — IRT retido a pagar'
  WHEN 'socialSecurityPayable' THEN 'Segurança Social — INSS a pagar'
  WHEN 'netPayable' THEN 'Pessoal — remunerações a pagar'
  WHEN 'advances' THEN 'Pessoal — adiantamentos'
  WHEN 'otherDeductions' THEN 'Pessoal — outros (descontos retidos)'
  WHEN 'bank' THEN 'Depósitos à ordem — conta de pagamento de salários'
  ELSE "label" END
WHERE "label" = "role";
