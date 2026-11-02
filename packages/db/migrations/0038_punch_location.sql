CREATE TABLE "workplaces" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"company_id" text NOT NULL,
	"name" text NOT NULL,
	"latitude" double precision NOT NULL,
	"longitude" double precision NOT NULL,
	"radius_meters" integer DEFAULT 150 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"kiosk_secret" text,
	"kiosk_token" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workplaces_kiosk_token_unique" UNIQUE("kiosk_token")
);
--> statement-breakpoint
ALTER TABLE "attendance_entries" ADD COLUMN "clock_in_location" jsonb;--> statement-breakpoint
ALTER TABLE "attendance_entries" ADD COLUMN "clock_out_location" jsonb;--> statement-breakpoint
ALTER TABLE "attendance_entries" ADD COLUMN "location_issue" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "punch_location_mode" text DEFAULT 'off' NOT NULL;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "workplace_id" text;--> statement-breakpoint
ALTER TABLE "workplaces" ADD CONSTRAINT "workplaces_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workplaces_company" ON "workplaces" USING btree ("company_id");--> statement-breakpoint
ALTER TABLE "workplaces" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY empresa ON "workplaces" USING (company_id = kianda_tenant()) WITH CHECK (company_id = kianda_tenant());
--> statement-breakpoint
ALTER TABLE "workplaces" ADD CONSTRAINT workplaces_coordinates_check CHECK (latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180 AND radius_meters BETWEEN 50 AND 5000);
--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT companies_punch_location_mode_check CHECK (punch_location_mode IN ('off', 'record', 'alert', 'block'));
--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_workplace_id_workplaces_id_fk" FOREIGN KEY ("workplace_id") REFERENCES "public"."workplaces"("id") ON DELETE SET NULL ON UPDATE no action;
--> statement-breakpoint
-- O local atribuído tem de ser da mesma empresa do colaborador (a chave estrangeira não vê a RLS).
CREATE FUNCTION kianda_employee_workplace_same_company() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.workplace_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM workplaces w WHERE w.id = NEW.workplace_id AND w.company_id = NEW.company_id) THEN
    RAISE EXCEPTION 'local de trabalho de outra empresa' USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER employees_workplace_same_company BEFORE INSERT OR UPDATE OF workplace_id ON employees FOR EACH ROW EXECUTE FUNCTION kianda_employee_workplace_same_company();
--> statement-breakpoint
CREATE INDEX "attendance_entries_location_issue" ON "attendance_entries" USING btree ("company_id", "work_date") WHERE location_issue;
