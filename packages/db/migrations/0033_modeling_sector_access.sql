ALTER TABLE "company_modules" ADD COLUMN "primary_sector" text;--> statement-breakpoint
ALTER TABLE "company_modules" ADD COLUMN "modeling_sectors" jsonb DEFAULT '["mineracao","petroleo","agro","comercio","servicos","industria","imobiliario","tecnologia"]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_requests" ADD COLUMN "primary_sector" text;--> statement-breakpoint
ALTER TABLE "payment_requests" ADD COLUMN "modeling_sectors" jsonb;
--> statement-breakpoint
ALTER TABLE company_modules ADD CONSTRAINT company_modules_sectors_check CHECK (
  jsonb_typeof(modeling_sectors) = 'array' AND
  modeling_sectors <@ '["mineracao","petroleo","agro","comercio","servicos","industria","imobiliario","tecnologia"]'::jsonb AND
  (plan_key IS NULL OR (primary_sector IS NOT NULL AND modeling_sectors ? primary_sector AND
    jsonb_array_length(modeling_sectors) = CASE plan_key WHEN 'pme' THEN 2 WHEN 'corporate' THEN 4 ELSE 8 END))
);
--> statement-breakpoint
ALTER TABLE payment_requests ADD CONSTRAINT payment_requests_sectors_check CHECK (
  kind <> 'modeling_subscription' OR (
    primary_sector IS NOT NULL AND modeling_sectors IS NOT NULL AND
    jsonb_typeof(modeling_sectors) = 'array' AND modeling_sectors ? primary_sector AND
    modeling_sectors <@ '["mineracao","petroleo","agro","comercio","servicos","industria","imobiliario","tecnologia"]'::jsonb AND
    jsonb_array_length(modeling_sectors) = CASE tier_key WHEN 'pme' THEN 2 WHEN 'corporate' THEN 4 ELSE 8 END
  )
);
--> statement-breakpoint
-- RH e Modelagem podem receber pedidos em simultâneo, de empresas diferentes.
-- O contador global é actualizado atomicamente e não reutiliza números de pedidos eliminados.
CREATE OR REPLACE FUNCTION kianda_next_payment_number(year text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE next_value bigint;
BEGIN
  IF year !~ '^[0-9]{4}$' THEN RAISE EXCEPTION 'Ano inválido'; END IF;
  INSERT INTO platform_settings(key, value)
  SELECT 'payment-sequence:' || year, to_jsonb(coalesce(max(substring(number from '[0-9]+$')::bigint), 0) + 1)
    FROM payment_requests WHERE number ~ ('^PF-' || year || '-[0-9]+$')
  ON CONFLICT(key) DO UPDATE SET
    value = to_jsonb(greatest((platform_settings.value #>> '{}')::bigint + 1, (EXCLUDED.value #>> '{}')::bigint)), updated_at = now()
  RETURNING (value #>> '{}')::bigint INTO next_value;
  RETURN 'PF-' || year || '-' || lpad(next_value::text, greatest(4, length(next_value::text)), '0');
END $$;
