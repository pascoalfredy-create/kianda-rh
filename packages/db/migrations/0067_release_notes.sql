CREATE TABLE public.release_notes (
  slug text PRIMARY KEY,
  title text NOT NULL,
  body text NOT NULL,
  modules text[] NOT NULL DEFAULT '{}'::text[],
  roles text[] NOT NULL DEFAULT '{}'::text[],
  url text,
  published_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX release_notes_published ON public.release_notes (published_at DESC);
--> statement-breakpoint
-- Novidades: só a publicação as grava; a aplicação lê.
REVOKE INSERT, UPDATE, DELETE ON public.release_notes FROM kianda_app;
--> statement-breakpoint
-- As contas existentes vêem as novidades publicadas a partir de agora; as contas novas, as que vierem depois de entrarem.
ALTER TABLE public.users ADD COLUMN release_notes_seen_at timestamptz NOT NULL DEFAULT now();
