ALTER TABLE "company_modules" ALTER COLUMN "project_limit" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "company_modules" ADD COLUMN "plan_key" text;--> statement-breakpoint
ALTER TABLE "company_modules" ADD COLUMN "cycle" text;--> statement-breakpoint
ALTER TABLE "payment_requests" ADD COLUMN "project_limit" integer;--> statement-breakpoint
ALTER TABLE "payment_requests" ADD COLUMN "extra_users" integer;
--> statement-breakpoint
ALTER TABLE company_modules ADD CONSTRAINT company_modules_plan_key_check CHECK (plan_key IS NULL OR (module = 'modeling' AND plan_key IN ('pme', 'corporate', 'enterprise10', 'unlimited')));
--> statement-breakpoint
ALTER TABLE company_modules ADD CONSTRAINT company_modules_cycle_check CHECK (cycle IS NULL OR cycle IN ('monthly', 'semiannual', 'annual'));
--> statement-breakpoint
ALTER TABLE payment_requests ADD CONSTRAINT payment_requests_modeling_check CHECK (
  kind <> 'modeling_subscription' OR (
    tier_key IS NOT NULL AND tier_key IN ('pme', 'corporate', 'enterprise10', 'unlimited') AND
    cycle IS NOT NULL AND cycle IN ('monthly', 'semiannual', 'annual') AND
    (tier_key <> 'unlimited' OR cycle <> 'monthly') AND
    extra_users IS NOT NULL AND extra_users >= 0 AND
    ((tier_key = 'unlimited' AND project_limit IS NULL) OR (tier_key <> 'unlimited' AND project_limit IS NOT NULL AND project_limit >= 1)) AND
    period_start IS NOT NULL AND period_end IS NOT NULL AND period_end >= period_start AND amount_minor > 0
  )
);
