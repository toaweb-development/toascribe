-- M1.4 (generated): the log of cache tags a change touched (the site asks for the tags changed since its last look), and the
-- post password as a limited action (K-067). Additive. Downgrade (drizzle runs forward only): DROP TABLE "cache_invalidation";
--   and ck_login_attempt_action back to the list without 'post_password' (after deleting those rows).
CREATE TABLE "cache_invalidation" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "cache_invalidation_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"tag" text NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"xid" "xid8" DEFAULT pg_current_xact_id() NOT NULL,
	CONSTRAINT "ck_cache_invalidation_tag" CHECK ("cache_invalidation"."tag" ~ '^(\*|[a-z_]+(:[A-Za-z0-9_-]+)?)$')
);
--> statement-breakpoint
ALTER TABLE "login_attempt" DROP CONSTRAINT "ck_login_attempt_action";--> statement-breakpoint
CREATE INDEX "idx_cache_invalidation_changed_at" ON "cache_invalidation" USING btree ("changed_at");--> statement-breakpoint
CREATE INDEX "idx_cache_invalidation_xid" ON "cache_invalidation" USING btree ("xid");--> statement-breakpoint
ALTER TABLE "login_attempt" ADD CONSTRAINT "ck_login_attempt_action" CHECK ("login_attempt"."action" in ('login', 'mfa', 'register', 'password_lost', 'comment', 'setup', 'post_password'));