CREATE TABLE "valuation_analyses" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"company_id" text NOT NULL,
	"name" text NOT NULL,
	"data" jsonb NOT NULL,
	"own_company" boolean DEFAULT false NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"updated_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "valuation_members" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"company_id" text NOT NULL,
	"user_id" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"permission" text DEFAULT 'editor' NOT NULL,
	"added_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "valuation_analyses" ADD CONSTRAINT "valuation_analyses_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "valuation_members" ADD CONSTRAINT "valuation_members_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "valuation_members" ADD CONSTRAINT "valuation_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "valuation_analyses_company" ON "valuation_analyses" USING btree ("company_id","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "valuation_members_company_user" ON "valuation_members" USING btree ("company_id","user_id");--> statement-breakpoint
ALTER TABLE "valuation_members" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY empresa ON "valuation_members" USING (company_id = kianda_tenant()) WITH CHECK (company_id = kianda_tenant());
--> statement-breakpoint
ALTER TABLE "valuation_analyses" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY empresa ON "valuation_analyses" USING (company_id = kianda_tenant()) WITH CHECK (company_id = kianda_tenant());
--> statement-breakpoint
ALTER TABLE "valuation_members" ADD CONSTRAINT valuation_members_permission_check CHECK (permission IN ('editor', 'viewer'));
--> statement-breakpoint
ALTER TABLE "valuation_analyses" ADD CONSTRAINT valuation_analyses_name_check CHECK (length(btrim(name)) BETWEEN 1 AND 200);
--> statement-breakpoint
ALTER TABLE "valuation_analyses" ADD CONSTRAINT valuation_analyses_revision_check CHECK (revision >= 1);
--> statement-breakpoint
ALTER TABLE "valuation_analyses" ADD CONSTRAINT valuation_analyses_data_size_check CHECK (pg_column_size(data) <= 2000000);
--> statement-breakpoint
ALTER TABLE company_modules DROP CONSTRAINT company_modules_module_check;
--> statement-breakpoint
ALTER TABLE company_modules ADD CONSTRAINT company_modules_module_check CHECK (module IN ('hr', 'modeling', 'valuation'));
--> statement-breakpoint
CREATE FUNCTION kianda_valuation_member_same_company() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users u WHERE u.id = NEW.user_id AND u.company_id = NEW.company_id) THEN
    RAISE EXCEPTION 'utilizador de outra empresa' USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER valuation_members_same_company BEFORE INSERT OR UPDATE ON valuation_members FOR EACH ROW EXECUTE FUNCTION kianda_valuation_member_same_company();
