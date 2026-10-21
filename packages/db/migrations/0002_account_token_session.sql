CREATE TABLE "account_token" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"account_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"token_hash" text NOT NULL,
	"new_email" text,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"modified_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_account_token_token_hash" UNIQUE("token_hash"),
	CONSTRAINT "ck_account_token_purpose" CHECK ("account_token"."purpose" in ('password_reset', 'set_password', 'email_change')),
	CONSTRAINT "ck_account_token_new_email" CHECK (("account_token"."purpose" = 'email_change') = ("account_token"."new_email" is not null))
);
--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN "mfa_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN "is_remembered" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "account_token" ADD CONSTRAINT "fk_account_token_account_id" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_account_token_account_id_purpose" ON "account_token" USING btree ("account_id","purpose");--> statement-breakpoint
CREATE INDEX "idx_account_token_expires_at" ON "account_token" USING btree ("expires_at");