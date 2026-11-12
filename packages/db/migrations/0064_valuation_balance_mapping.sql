ALTER TABLE companies ADD COLUMN valuation_balance_mapping jsonb NOT NULL DEFAULT '{}'::jsonb;
