CREATE TABLE public.r2_deletion_queue (
  object_key text PRIMARY KEY,
  next_attempt_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX r2_deletion_queue_due ON public.r2_deletion_queue (next_attempt_at, object_key);
--> statement-breakpoint
REVOKE ALL ON public.r2_deletion_queue FROM PUBLIC, kianda_app;
--> statement-breakpoint
CREATE FUNCTION public.kianda_queue_r2_deletion() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  INSERT INTO public.r2_deletion_queue (object_key)
  VALUES (OLD.company_id || '/' || OLD.id)
  ON CONFLICT (object_key) DO NOTHING;
  RETURN OLD;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.kianda_queue_r2_deletion() FROM PUBLIC, kianda_app;
--> statement-breakpoint
CREATE TRIGGER files_queue_r2_deletion AFTER DELETE ON public.files
FOR EACH ROW WHEN (OLD.storage = 'r2') EXECUTE FUNCTION public.kianda_queue_r2_deletion();
--> statement-breakpoint
ALTER TABLE public.valuation_analyses ADD CONSTRAINT valuation_analyses_company_id_id_unique UNIQUE (company_id, id);
--> statement-breakpoint
ALTER TABLE public.valuation_versions
  DROP CONSTRAINT valuation_versions_analysis_id_fkey,
  ADD CONSTRAINT valuation_versions_company_analysis_fk
    FOREIGN KEY (company_id, analysis_id) REFERENCES public.valuation_analyses (company_id, id) ON DELETE CASCADE;
