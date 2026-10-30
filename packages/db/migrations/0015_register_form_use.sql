-- M2.1 (generated): the registration form tokens that have been used (K-006), so each is good for one registration. Additive; the
-- app role gets its DML from the default privileges of 0000. Downgrade (drizzle runs forward only): DROP TABLE "register_form_use";
CREATE TABLE "register_form_use" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "ck_register_form_use_token_hash" CHECK ("register_form_use"."token_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE INDEX "idx_register_form_use_expires_at" ON "register_form_use" USING btree ("expires_at");