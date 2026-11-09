ALTER TABLE "attendance_months" ADD COLUMN "shortfall_minutes" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "discount_lateness" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "lateness_tolerance_minutes" integer DEFAULT 0 NOT NULL;
