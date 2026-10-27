ALTER TABLE "companies" ALTER COLUMN "bank_file_profile" SET DEFAULT 'nib';--> statement-breakpoint
UPDATE "companies" SET "bank_file_profile" = 'nib' WHERE "bank_file_profile" = 'generic';
