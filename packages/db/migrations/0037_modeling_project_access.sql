-- Participantes do Integra restritos a projectos concretos. Por omissão (scope = 'all') o comportamento anterior mantém-se.
-- (O snapshot do drizzle passa também a conhecer personnel_cash_plans, criada à mão na 0034; aqui não se recria.)
ALTER TABLE "modeling_members" ADD COLUMN "scope" text DEFAULT 'all' NOT NULL;
--> statement-breakpoint
ALTER TABLE "modeling_members" ADD CONSTRAINT modeling_members_scope_check CHECK (scope IN ('all', 'selected'));
--> statement-breakpoint
CREATE TABLE "modeling_project_access" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"company_id" text NOT NULL,
	"model_id" text NOT NULL,
	"user_id" text NOT NULL,
	"permission" text DEFAULT 'viewer' NOT NULL,
	"added_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "modeling_project_access" ADD CONSTRAINT "modeling_project_access_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "modeling_project_access" ADD CONSTRAINT "modeling_project_access_model_id_financial_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."financial_models"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "modeling_project_access" ADD CONSTRAINT "modeling_project_access_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "modeling_project_access" ADD CONSTRAINT modeling_project_access_permission_check CHECK (permission IN ('editor', 'viewer'));
--> statement-breakpoint
CREATE UNIQUE INDEX "modeling_project_access_model_user" ON "modeling_project_access" USING btree ("model_id","user_id");
--> statement-breakpoint
CREATE INDEX "modeling_project_access_company_user" ON "modeling_project_access" USING btree ("company_id","user_id");
--> statement-breakpoint
ALTER TABLE "modeling_project_access" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY empresa ON "modeling_project_access" USING (company_id = kianda_tenant()) WITH CHECK (company_id = kianda_tenant());
--> statement-breakpoint
-- O projecto tem de ser da mesma empresa (a RLS já impede ver projectos de outra; isto impede gravar a referência cruzada).
CREATE FUNCTION kianda_project_access_same_company() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM financial_models m WHERE m.id = NEW.model_id AND m.company_id = NEW.company_id) THEN
    RAISE EXCEPTION 'projecto de outra empresa' USING ERRCODE = '23503';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM users u WHERE u.id = NEW.user_id AND u.company_id = NEW.company_id) THEN
    RAISE EXCEPTION 'utilizador de outra empresa' USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER modeling_project_access_same_company BEFORE INSERT OR UPDATE ON modeling_project_access FOR EACH ROW EXECUTE FUNCTION kianda_project_access_same_company();
