ALTER TABLE "issued_documents" ADD COLUMN "signature_requested_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "issued_documents" ADD COLUMN "signature_requested_by" text;
--> statement-breakpoint
ALTER TABLE "issued_documents" ADD COLUMN "signed_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "issued_documents" ADD COLUMN "signed_by" text;
--> statement-breakpoint
ALTER TABLE "issued_documents" ADD COLUMN "signed_name" text;
--> statement-breakpoint
ALTER TABLE "issued_documents" ADD COLUMN "signed_ip" text;
--> statement-breakpoint
ALTER TABLE "issued_documents" ADD COLUMN "signed_hash" text;
