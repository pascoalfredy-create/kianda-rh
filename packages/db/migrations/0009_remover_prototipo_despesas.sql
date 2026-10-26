DROP TABLE "expenses" CASCADE;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "per_diem_national_minor" bigint;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "per_diem_international_minor" bigint;--> statement-breakpoint
DROP TYPE "public"."expense_status";