-- Empresas novas: a localização da marcação passa a ser registada por omissão (antifraude).
-- As empresas existentes mantêm a regra que escolheram.
ALTER TABLE "companies" ALTER COLUMN "punch_location_mode" SET DEFAULT 'record';
