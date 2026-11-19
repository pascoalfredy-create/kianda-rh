ALTER TABLE "companies" ADD COLUMN "registration_review_reasons" jsonb NOT NULL DEFAULT '[]'::jsonb;
--> statement-breakpoint
UPDATE "companies" SET "registration_review_reasons" = '["Dados de cadastro provisórios ou padrão de NIF suspeito. Confirmar os dados da empresa e do proprietário."]'::jsonb
WHERE "nif" <> 'PLATAFORMA' AND (
  "nif" ~ '([0-9])\1{5}'
  OR "nif" IN ('0123456789', '1234567890', '9876543210')
  OR lower(trim("name")) IN ('test', 'teste', 'demo', 'admin', 'administrador', 'administrator', 'exemplo')
  OR EXISTS (SELECT 1 FROM "users" WHERE "users"."company_id" = "companies"."id"
    AND "users"."role" = 'owner'
    AND lower(trim("users"."name")) IN ('test', 'teste', 'demo', 'admin', 'administrador', 'administrator', 'exemplo'))
);
