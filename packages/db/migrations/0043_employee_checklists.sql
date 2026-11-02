CREATE TABLE "checklist_tasks" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"company_id" text NOT NULL,
	"checklist_id" text NOT NULL,
	"position" integer NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"responsible" text NOT NULL,
	"due_date" date NOT NULL,
	"done_at" timestamp with time zone,
	"done_by" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "checklist_templates" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"company_id" text NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"auto_start" boolean DEFAULT true NOT NULL,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employee_checklists" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"company_id" text NOT NULL,
	"employee_id" text NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"reference_date" date NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"termination_id" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text
);
--> statement-breakpoint
ALTER TABLE "checklist_tasks" ADD CONSTRAINT "checklist_tasks_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_tasks" ADD CONSTRAINT "checklist_tasks_checklist_id_employee_checklists_id_fk" FOREIGN KEY ("checklist_id") REFERENCES "public"."employee_checklists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_templates" ADD CONSTRAINT "checklist_templates_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_checklists" ADD CONSTRAINT "employee_checklists_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_checklists" ADD CONSTRAINT "employee_checklists_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_checklists" ADD CONSTRAINT "employee_checklists_termination_id_terminations_id_fk" FOREIGN KEY ("termination_id") REFERENCES "public"."terminations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "checklist_tasks_checklist" ON "checklist_tasks" USING btree ("checklist_id","position");--> statement-breakpoint
CREATE INDEX "checklist_tasks_pending" ON "checklist_tasks" USING btree ("company_id","due_date") WHERE done_at is null;--> statement-breakpoint
CREATE UNIQUE INDEX "checklist_templates_company_kind" ON "checklist_templates" USING btree ("company_id","kind");--> statement-breakpoint
CREATE INDEX "employee_checklists_company" ON "employee_checklists" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "employee_checklists_employee" ON "employee_checklists" USING btree ("employee_id");--> statement-breakpoint
-- Segurança ao nível da linha: cada empresa só vê e só escreve as suas listas e tarefas.
ALTER TABLE "checklist_templates" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY empresa ON "checklist_templates" USING (company_id = kianda_tenant()) WITH CHECK (company_id = kianda_tenant());
--> statement-breakpoint
ALTER TABLE "employee_checklists" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY empresa ON "employee_checklists" USING (company_id = kianda_tenant()) WITH CHECK (company_id = kianda_tenant());
--> statement-breakpoint
ALTER TABLE "checklist_tasks" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY empresa ON "checklist_tasks" USING (company_id = kianda_tenant()) WITH CHECK (company_id = kianda_tenant());
--> statement-breakpoint
ALTER TABLE checklist_templates ADD CONSTRAINT checklist_templates_kind_check CHECK (kind IN ('onboarding', 'offboarding') AND jsonb_typeof(items) = 'array' AND jsonb_array_length(items) <= 60);
--> statement-breakpoint
ALTER TABLE employee_checklists ADD CONSTRAINT employee_checklists_check CHECK (kind IN ('onboarding', 'offboarding') AND status IN ('open', 'completed', 'cancelled'));
--> statement-breakpoint
ALTER TABLE checklist_tasks ADD CONSTRAINT checklist_tasks_responsible_check CHECK (responsible IN ('hr', 'manager', 'employee', 'finance') AND ((done_at IS NULL) = (done_by IS NULL)));
--> statement-breakpoint
-- Uma só lista em curso por colaborador e tipo.
CREATE UNIQUE INDEX employee_checklists_one_open ON employee_checklists (employee_id, kind) WHERE status = 'open';
--> statement-breakpoint
-- O colaborador, a cessação e a lista têm de ser da mesma empresa (as chaves estrangeiras não vêem a RLS).
CREATE FUNCTION kianda_employee_checklist_same_company() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM employees e WHERE e.id = NEW.employee_id AND e.company_id = NEW.company_id) THEN
    RAISE EXCEPTION 'colaborador de outra empresa' USING ERRCODE = '23503';
  END IF;
  IF NEW.termination_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM terminations t WHERE t.id = NEW.termination_id AND t.company_id = NEW.company_id AND t.employee_id = NEW.employee_id) THEN
    RAISE EXCEPTION 'cessação de outro colaborador ou empresa' USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER employee_checklists_same_company BEFORE INSERT OR UPDATE OF company_id, employee_id, termination_id ON employee_checklists FOR EACH ROW EXECUTE FUNCTION kianda_employee_checklist_same_company();
--> statement-breakpoint
CREATE FUNCTION kianda_checklist_task_same_company() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM employee_checklists l WHERE l.id = NEW.checklist_id AND l.company_id = NEW.company_id) THEN
    RAISE EXCEPTION 'lista de outra empresa' USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER checklist_tasks_same_company BEFORE INSERT OR UPDATE OF company_id, checklist_id ON checklist_tasks FOR EACH ROW EXECUTE FUNCTION kianda_checklist_task_same_company();
