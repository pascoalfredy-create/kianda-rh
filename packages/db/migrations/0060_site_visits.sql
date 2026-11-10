-- Visitas ao site público, sem cookies: o visitante é um hash diário (IP + navegador + segredo) que muda todos os dias.
CREATE TABLE IF NOT EXISTS "site_visits" (
  "day" date NOT NULL,
  "path" text NOT NULL,
  "visitor" text NOT NULL,
  "referrer" text,
  "source" text,
  "country" text,
  "device" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "site_visits_pk" PRIMARY KEY ("day", "path", "visitor")
);
CREATE INDEX IF NOT EXISTS "site_visits_day_idx" ON "site_visits" ("day");
