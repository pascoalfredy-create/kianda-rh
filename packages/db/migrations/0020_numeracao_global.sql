-- N.º dos pedidos de pagamento (PF-AAAA-NNNN): único em toda a plataforma. Com o RLS cada empresa só vê os seus pedidos,
-- por isso a contagem é feita por esta função com os privilégios do dono das tabelas (SECURITY DEFINER), que só devolve o número.
CREATE OR REPLACE FUNCTION kianda_next_payment_number(year text) RETURNS text
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT 'PF-' || year || '-' || lpad((count(*) + 1)::text, 4, '0') FROM payment_requests WHERE number LIKE 'PF-' || year || '-%'
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION kianda_next_payment_number(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION kianda_next_payment_number(text) TO kianda_app;
