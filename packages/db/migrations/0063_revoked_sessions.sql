CREATE TABLE "revoked_sessions" (
  "token_hash" text PRIMARY KEY,
  "expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "revoked_sessions_expiry" ON "revoked_sessions" ("expires_at");
--> statement-breakpoint
ALTER TABLE "revoked_sessions" ENABLE ROW LEVEL SECURITY;
