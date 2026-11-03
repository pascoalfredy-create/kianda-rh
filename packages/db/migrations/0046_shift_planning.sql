CREATE TABLE "shift_assignments" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"company_id" text NOT NULL,
	"employee_id" text NOT NULL,
	"work_date" date NOT NULL,
	"kind" text NOT NULL,
	"shift_type_id" text,
	"pub_kind" text,
	"pub_shift_type_id" text,
	"pub_code" text,
	"pub_name" text,
	"pub_start_time" text,
	"pub_end_time" text,
	"pub_break_minutes" integer,
	"pub_color" text,
	"published_at" timestamp with time zone,
	"published_by" text,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shift_types" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"company_id" text NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"start_time" text NOT NULL,
	"end_time" text NOT NULL,
	"break_minutes" integer DEFAULT 0 NOT NULL,
	"color" text DEFAULT 'blue' NOT NULL,
	"min_staff" integer,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "shift_min_rest_minutes" integer DEFAULT 600 NOT NULL;--> statement-breakpoint
ALTER TABLE "shift_assignments" ADD CONSTRAINT "shift_assignments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_assignments" ADD CONSTRAINT "shift_assignments_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_assignments" ADD CONSTRAINT "shift_assignments_shift_type_id_shift_types_id_fk" FOREIGN KEY ("shift_type_id") REFERENCES "public"."shift_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_assignments" ADD CONSTRAINT "shift_assignments_pub_shift_type_id_shift_types_id_fk" FOREIGN KEY ("pub_shift_type_id") REFERENCES "public"."shift_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_types" ADD CONSTRAINT "shift_types_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "shift_assignments_employee_date" ON "shift_assignments" USING btree ("employee_id","work_date");--> statement-breakpoint
CREATE INDEX "shift_assignments_company_date" ON "shift_assignments" USING btree ("company_id","work_date");--> statement-breakpoint
CREATE UNIQUE INDEX "shift_types_company_code" ON "shift_types" USING btree ("company_id","code");--> statement-breakpoint
-- Segurança ao nível da linha: cada empresa só vê e só escreve os seus turnos e a sua escala.
ALTER TABLE "shift_types" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY empresa ON "shift_types" USING (company_id = kianda_tenant()) WITH CHECK (company_id = kianda_tenant());
--> statement-breakpoint
ALTER TABLE "shift_assignments" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY empresa ON "shift_assignments" USING (company_id = kianda_tenant()) WITH CHECK (company_id = kianda_tenant());
--> statement-breakpoint
ALTER TABLE companies ADD CONSTRAINT companies_shift_min_rest_check CHECK (shift_min_rest_minutes BETWEEN 0 AND 1440);
--> statement-breakpoint
ALTER TABLE shift_types ADD CONSTRAINT shift_types_check CHECK (
  code ~ '^[A-Z0-9]{1,3}$' AND code <> 'F' AND length(name) BETWEEN 1 AND 40
  AND start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND end_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND start_time <> end_time
  AND break_minutes BETWEEN 0 AND 240 AND (min_staff IS NULL OR min_staff BETWEEN 0 AND 500)
  AND color IN ('blue', 'green', 'amber', 'violet', 'red', 'teal', 'slate'));
--> statement-breakpoint
ALTER TABLE shift_assignments ADD CONSTRAINT shift_assignments_check CHECK (
  kind IN ('shift', 'off', 'none') AND ((kind = 'shift') = (shift_type_id IS NOT NULL))
  AND (pub_kind IS NULL OR pub_kind IN ('shift', 'off'))
  AND ((pub_kind IS NULL) = (published_at IS NULL))
  AND (pub_kind IS DISTINCT FROM 'shift' OR (pub_code IS NOT NULL AND pub_start_time IS NOT NULL AND pub_end_time IS NOT NULL AND pub_break_minutes IS NOT NULL))
  AND NOT (kind = 'none' AND pub_kind IS NULL));
--> statement-breakpoint
-- Colaborador e tipos de turno da mesma empresa (as chaves estrangeiras não vêem a RLS).
CREATE FUNCTION kianda_shift_assignment_same_company() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM employees e WHERE e.id = NEW.employee_id AND e.company_id = NEW.company_id) THEN
    RAISE EXCEPTION 'colaborador de outra empresa' USING ERRCODE = '23503';
  END IF;
  IF NEW.shift_type_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM shift_types t WHERE t.id = NEW.shift_type_id AND t.company_id = NEW.company_id) THEN
    RAISE EXCEPTION 'turno de outra empresa' USING ERRCODE = '23503';
  END IF;
  IF NEW.pub_shift_type_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM shift_types t WHERE t.id = NEW.pub_shift_type_id AND t.company_id = NEW.company_id) THEN
    RAISE EXCEPTION 'turno de outra empresa' USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER shift_assignments_same_company BEFORE INSERT OR UPDATE OF company_id, employee_id, shift_type_id, pub_shift_type_id ON shift_assignments FOR EACH ROW EXECUTE FUNCTION kianda_shift_assignment_same_company();
