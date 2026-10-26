CREATE TABLE "document_requests" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"company_id" text NOT NULL,
	"employee_id" text NOT NULL,
	"template_key" text NOT NULL,
	"inputs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"document_id" text,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profile_change_requests" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"company_id" text NOT NULL,
	"employee_id" text NOT NULL,
	"changes" jsonb NOT NULL,
	"previous" jsonb NOT NULL,
	"note" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "auto_issue_declarations" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "document_requests" ADD CONSTRAINT "document_requests_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_requests" ADD CONSTRAINT "document_requests_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_change_requests" ADD CONSTRAINT "profile_change_requests_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_change_requests" ADD CONSTRAINT "profile_change_requests_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_requests_company_status" ON "document_requests" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "document_requests_employee" ON "document_requests" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "profile_change_requests_company_status" ON "profile_change_requests" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "profile_change_requests_employee" ON "profile_change_requests" USING btree ("employee_id");