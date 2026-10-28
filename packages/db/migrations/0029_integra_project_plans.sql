CREATE TABLE "modeling_members" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"company_id" text NOT NULL,
	"user_id" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"permission" text DEFAULT 'editor' NOT NULL,
	"added_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "company_modules" ADD COLUMN "project_limit" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "company_modules" ADD COLUMN "extra_users" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "financial_models" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "modeling_members" ADD CONSTRAINT "modeling_members_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "modeling_members" ADD CONSTRAINT "modeling_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "modeling_members_company_user" ON "modeling_members" USING btree ("company_id","user_id");--> statement-breakpoint
ALTER TABLE "modeling_members" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY empresa ON "modeling_members" USING (company_id = kianda_tenant()) WITH CHECK (company_id = kianda_tenant());
--> statement-breakpoint
ALTER TABLE "modeling_members" ADD CONSTRAINT modeling_members_permission_check CHECK (permission IN ('editor', 'viewer'));
--> statement-breakpoint
ALTER TABLE "company_modules" ADD CONSTRAINT company_modules_limits_check CHECK (project_limit >= 1 AND extra_users >= 0);
--> statement-breakpoint
INSERT INTO modeling_members(company_id, user_id, added_by)
SELECT DISTINCT m.company_id, m.created_by, m.created_by FROM financial_models m
JOIN users u ON u.id=m.created_by AND u.company_id=m.company_id
ON CONFLICT (company_id, user_id) DO NOTHING;
