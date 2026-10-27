ALTER TABLE "companies" ADD COLUMN "province" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "municipality" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "bank_file_profile" text DEFAULT 'generic' NOT NULL;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "municipality" text;