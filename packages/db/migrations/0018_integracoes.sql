CREATE TABLE "gateway_events" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"provider" text NOT NULL,
	"external_id" text NOT NULL,
	"reference" text,
	"amount_minor" bigint,
	"payload" jsonb NOT NULL,
	"outcome" text NOT NULL,
	"payment_request_id" text,
	"message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outbound_emails" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"company_id" text,
	"to_address" text NOT NULL,
	"subject" text NOT NULL,
	"kind" text NOT NULL,
	"dedupe_key" text,
	"status" text NOT NULL,
	"provider" text,
	"provider_id" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "outbound_emails_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
ALTER TABLE "payment_requests" ADD COLUMN "gateway" text;--> statement-breakpoint
ALTER TABLE "payment_requests" ADD COLUMN "gateway_entity" text;--> statement-breakpoint
ALTER TABLE "payment_requests" ADD COLUMN "gateway_reference" text;--> statement-breakpoint
ALTER TABLE "payment_requests" ADD COLUMN "gateway_expires_at" date;--> statement-breakpoint
ALTER TABLE "payment_requests" ADD COLUMN "gateway_error" text;--> statement-breakpoint
ALTER TABLE "payment_requests" ADD COLUMN "confirmed_via" text;--> statement-breakpoint
ALTER TABLE "payment_requests" ADD COLUMN "invoice_provider" text;--> statement-breakpoint
ALTER TABLE "payment_requests" ADD COLUMN "invoice_external_id" text;--> statement-breakpoint
ALTER TABLE "payment_requests" ADD COLUMN "invoice_issued_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payment_requests" ADD COLUMN "invoice_error" text;--> statement-breakpoint
CREATE UNIQUE INDEX "gateway_events_provider_external" ON "gateway_events" USING btree ("provider","external_id");--> statement-breakpoint
CREATE INDEX "outbound_emails_created" ON "outbound_emails" USING btree ("created_at");