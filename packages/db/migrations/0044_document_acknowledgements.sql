CREATE TABLE "ack_documents" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"company_id" text NOT NULL,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"category" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"previous_id" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"audience" jsonb NOT NULL,
	"due_date" date,
	"content_sha256" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	"published_by" text,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "ack_requests" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"company_id" text NOT NULL,
	"document_id" text NOT NULL,
	"employee_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"accepted_at" timestamp with time zone,
	"accepted_by" text,
	"accepted_ip" text,
	"accepted_user_agent" text,
	"accepted_sha256" text,
	"cancelled_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "checklist_tasks" ADD COLUMN "link_key" text;--> statement-breakpoint
ALTER TABLE "ack_documents" ADD CONSTRAINT "ack_documents_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ack_requests" ADD CONSTRAINT "ack_requests_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ack_requests" ADD CONSTRAINT "ack_requests_document_id_ack_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."ack_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ack_requests" ADD CONSTRAINT "ack_requests_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ack_documents_company" ON "ack_documents" USING btree ("company_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "ack_requests_document_employee" ON "ack_requests" USING btree ("document_id","employee_id");--> statement-breakpoint
CREATE INDEX "ack_requests_employee" ON "ack_requests" USING btree ("employee_id","status");--> statement-breakpoint
ALTER TABLE "ack_documents" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY empresa ON "ack_documents" USING (company_id = kianda_tenant()) WITH CHECK (company_id = kianda_tenant());
--> statement-breakpoint
ALTER TABLE "ack_requests" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY empresa ON "ack_requests" USING (company_id = kianda_tenant()) WITH CHECK (company_id = kianda_tenant());
--> statement-breakpoint
ALTER TABLE ack_documents ADD CONSTRAINT ack_documents_check CHECK (
  category IN ('regulamento', 'seguranca', 'politica', 'aviso', 'contrato', 'outro') AND status IN ('draft', 'published', 'archived') AND version >= 1
  AND length(body) <= 60000 AND (status = 'draft' OR (content_sha256 IS NOT NULL AND published_at IS NOT NULL))
);
--> statement-breakpoint
-- A prova de aceitação é completa: data, autor e impressão digital do conteúdo aceite.
ALTER TABLE ack_requests ADD CONSTRAINT ack_requests_check CHECK (
  status IN ('pending', 'accepted', 'cancelled') AND (status <> 'accepted' OR (accepted_at IS NOT NULL AND accepted_by IS NOT NULL AND accepted_sha256 IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE checklist_tasks ADD CONSTRAINT checklist_tasks_link_check CHECK (link_key IS NULL OR link_key IN ('regulamento'));
--> statement-breakpoint
CREATE FUNCTION kianda_ack_request_same_company() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM ack_documents d WHERE d.id = NEW.document_id AND d.company_id = NEW.company_id)
     OR NOT EXISTS (SELECT 1 FROM employees e WHERE e.id = NEW.employee_id AND e.company_id = NEW.company_id) THEN
    RAISE EXCEPTION 'documento ou colaborador de outra empresa' USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER ack_requests_same_company BEFORE INSERT OR UPDATE OF company_id, document_id, employee_id ON ack_requests FOR EACH ROW EXECUTE FUNCTION kianda_ack_request_same_company();
--> statement-breakpoint
-- O conteúdo aceite não muda depois de publicado: título, texto, versão e destinatários ficam congelados.
CREATE FUNCTION kianda_ack_document_frozen() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'draft' AND (NEW.title IS DISTINCT FROM OLD.title OR NEW.body IS DISTINCT FROM OLD.body OR NEW.version IS DISTINCT FROM OLD.version
     OR NEW.content_sha256 IS DISTINCT FROM OLD.content_sha256 OR NEW.category IS DISTINCT FROM OLD.category) THEN
    RAISE EXCEPTION 'documento publicado não se altera: crie uma nova versão' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER ack_documents_frozen BEFORE UPDATE ON ack_documents FOR EACH ROW EXECUTE FUNCTION kianda_ack_document_frozen();
--> statement-breakpoint
-- Acolhimento: os modelos e as listas em curso com a tarefa-tipo do regulamento passam a fechar com a aceitação no portal.
UPDATE checklist_templates SET items = (
  SELECT jsonb_agg(CASE WHEN item->>'title' = 'Ler o regulamento interno e as regras de segurança'
    THEN item || '{"title": "Ler e aceitar o regulamento interno", "link": "regulamento"}'::jsonb ELSE item END ORDER BY ord)
  FROM jsonb_array_elements(items) WITH ORDINALITY AS x(item, ord)
), updated_at = now()
WHERE kind = 'onboarding' AND items @> '[{"title": "Ler o regulamento interno e as regras de segurança"}]'::jsonb;
--> statement-breakpoint
UPDATE checklist_tasks SET link_key = 'regulamento', title = 'Ler e aceitar o regulamento interno'
WHERE title = 'Ler o regulamento interno e as regras de segurança' AND responsible = 'employee' AND done_at IS NULL;
