ALTER TABLE "absences" ADD COLUMN "requested_by" text;--> statement-breakpoint
ALTER TABLE "absences" ADD COLUMN "decision_note" text;--> statement-breakpoint
CREATE INDEX "absences_employee_dates" ON "absences" USING btree ("employee_id","start_date");