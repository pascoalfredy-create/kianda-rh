-- A migração conhece a remuneração apenas a partir desta data; a admissão original é preservada.
ALTER TABLE contracts ADD COLUMN salary_known_from date;
--> statement-breakpoint
ALTER TABLE contracts ADD CONSTRAINT contracts_salary_known_from_valid CHECK (salary_known_from IS NULL OR salary_known_from >= start_date);
