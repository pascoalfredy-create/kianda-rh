CREATE TABLE "candidate_events" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"candidate_id" text NOT NULL,
	"kind" text NOT NULL,
	"from_stage" text,
	"to_stage" text,
	"text" text,
	"scheduled_at" timestamp with time zone,
	"actor_id" text,
	"actor_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "candidates" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"company_id" text NOT NULL,
	"opening_id" text NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"phone" text,
	"source" text DEFAULT 'other' NOT NULL,
	"stage" text DEFAULT 'applied' NOT NULL,
	"rating" integer,
	"cv_url" text,
	"cover_letter" text,
	"expected_salary_minor" bigint,
	"available_from" date,
	"rejection_reason" text,
	"employee_id" text,
	"hired_at" timestamp with time zone,
	"consent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_openings" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"company_id" text NOT NULL,
	"title" text NOT NULL,
	"department_id" text,
	"hiring_manager_id" text,
	"location" text,
	"contract_type" text DEFAULT 'indefinite' NOT NULL,
	"positions" integer DEFAULT 1 NOT NULL,
	"salary_min_minor" bigint,
	"salary_max_minor" bigint,
	"description" text,
	"requirements" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"is_public" boolean DEFAULT false NOT NULL,
	"closes_on" date,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "review_cycles" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"company_id" text NOT NULL,
	"name" text NOT NULL,
	"period_from" date NOT NULL,
	"period_to" date NOT NULL,
	"deadline" date,
	"status" text DEFAULT 'draft' NOT NULL,
	"self_review" boolean DEFAULT true NOT NULL,
	"competencies" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"competency_weight" integer DEFAULT 60 NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"launched_at" timestamp with time zone,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"company_id" text NOT NULL,
	"cycle_id" text NOT NULL,
	"employee_id" text NOT NULL,
	"reviewer_employee_id" text,
	"status" text DEFAULT 'self' NOT NULL,
	"objectives" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"self_scores" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"self_comment" text,
	"self_submitted_at" timestamp with time zone,
	"manager_scores" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"manager_comment" text,
	"recommendation" text,
	"final_score" numeric(4, 2),
	"manager_submitted_at" timestamp with time zone,
	"manager_submitted_by" text,
	"employee_comment" text,
	"acknowledged_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "candidate_events" ADD CONSTRAINT "candidate_events_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidates" ADD CONSTRAINT "candidates_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidates" ADD CONSTRAINT "candidates_opening_id_job_openings_id_fk" FOREIGN KEY ("opening_id") REFERENCES "public"."job_openings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_openings" ADD CONSTRAINT "job_openings_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_cycles" ADD CONSTRAINT "review_cycles_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_cycle_id_review_cycles_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."review_cycles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "candidate_events_candidate" ON "candidate_events" USING btree ("candidate_id");--> statement-breakpoint
CREATE INDEX "candidates_opening_stage" ON "candidates" USING btree ("opening_id","stage");--> statement-breakpoint
CREATE INDEX "candidates_company" ON "candidates" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "job_openings_company_status" ON "job_openings" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "review_cycles_company" ON "review_cycles" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "reviews_cycle_employee" ON "reviews" USING btree ("cycle_id","employee_id");--> statement-breakpoint
CREATE INDEX "reviews_reviewer" ON "reviews" USING btree ("reviewer_employee_id");