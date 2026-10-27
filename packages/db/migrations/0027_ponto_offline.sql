ALTER TYPE "public"."punch_source" ADD VALUE 'offline';--> statement-breakpoint
ALTER TABLE "attendance_entries" ADD COLUMN "client_ref" text;--> statement-breakpoint
ALTER TABLE "attendance_entries" ADD COLUMN "offline_out" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_entries_client_ref" ON "attendance_entries" USING btree ("employee_id","client_ref");