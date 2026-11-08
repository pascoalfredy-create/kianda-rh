-- Sessões revogáveis: o token traz a versão; mudar a palavra-passe ou «terminar sessões» incrementa-a.
ALTER TABLE "users" ADD COLUMN "session_version" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
-- Índices a começar pela empresa (RLS filtra sempre por company_id): evita varrimentos completos à medida que crescem.
CREATE INDEX IF NOT EXISTS "ack_requests_company_status" ON "ack_requests" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "attendance_months_company_period" ON "attendance_months" USING btree ("company_id","period");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bank_lines_company_status" ON "bank_lines" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bank_matches_company" ON "bank_matches" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bank_statements_company" ON "bank_statements" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "compensation_changes_company_employee" ON "compensation_changes" USING btree ("company_id","employee_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_verifications_company" ON "email_verifications" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "file_blobs_company" ON "file_blobs" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "financial_personnel_imports_company_model" ON "financial_personnel_imports" USING btree ("company_id","model_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "outbound_emails_company_created" ON "outbound_emails" USING btree ("company_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payroll_payments_company" ON "payroll_payments" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "personnel_budget_lines_company_period" ON "personnel_budget_lines" USING btree ("company_id","period");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "push_outbox_company_user" ON "push_outbox" USING btree ("company_id","user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "push_subscriptions_company_user" ON "push_subscriptions" USING btree ("company_id","user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reviews_company" ON "reviews" USING btree ("company_id");
