ALTER TABLE "compensation_changes" ADD COLUMN "salary_currency" text DEFAULT 'AOA' NOT NULL;--> statement-breakpoint
ALTER TABLE "compensation_changes" ADD COLUMN "base_foreign_minor" bigint;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "salary_currency" text DEFAULT 'AOA' NOT NULL;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "base_foreign_minor" bigint;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD COLUMN "fx_rate" numeric(14, 6);--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD COLUMN "fx_date" date;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD COLUMN "fx_source" text;--> statement-breakpoint
-- Salário indexado: moeda conhecida e, em USD, o montante em dólares obrigatório.
ALTER TABLE contracts ADD CONSTRAINT contracts_salary_currency_check CHECK (salary_currency IN ('AOA', 'USD') AND ((salary_currency = 'USD') = (base_foreign_minor IS NOT NULL)) AND (base_foreign_minor IS NULL OR base_foreign_minor > 0));
--> statement-breakpoint
ALTER TABLE compensation_changes ADD CONSTRAINT compensation_changes_salary_currency_check CHECK (salary_currency IN ('AOA', 'USD') AND ((salary_currency = 'USD') = (base_foreign_minor IS NOT NULL)) AND (base_foreign_minor IS NULL OR base_foreign_minor > 0));
--> statement-breakpoint
ALTER TABLE payroll_runs ADD CONSTRAINT payroll_runs_fx_check CHECK ((fx_rate IS NULL OR fx_rate > 0) AND ((fx_rate IS NULL) = (fx_date IS NULL)));
