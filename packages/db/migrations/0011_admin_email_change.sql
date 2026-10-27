-- M1.5 (generated): the one-time link that confirms a new administrator address for the site (K-192), as an account_token
-- purpose with the pending address in new_email. Widening only. Downgrade (drizzle runs forward only): delete the rows with
--   purpose 'admin_email_change', then put both checks back without it.
ALTER TABLE "account_token" DROP CONSTRAINT "ck_account_token_purpose";--> statement-breakpoint
ALTER TABLE "account_token" DROP CONSTRAINT "ck_account_token_new_email";--> statement-breakpoint
ALTER TABLE "account_token" ADD CONSTRAINT "ck_account_token_purpose" CHECK ("account_token"."purpose" in ('password_reset', 'set_password', 'email_change', 'admin_email_change'));--> statement-breakpoint
ALTER TABLE "account_token" ADD CONSTRAINT "ck_account_token_new_email" CHECK (("account_token"."purpose" in ('email_change', 'admin_email_change')) = ("account_token"."new_email" is not null));