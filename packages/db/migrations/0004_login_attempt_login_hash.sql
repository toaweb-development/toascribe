-- M0.3 fix round 2 (Tor, 2026-10-22): no hard lock of accounts, an increasing delay per IP address and per login name instead.
--
-- 1. login_attempt.login_hash: a keyed hash of the login name or address that was typed (the api writes it; the typed name
--    itself is never stored), so that a name that matches no account is delayed exactly like one that does (K-004).
ALTER TABLE "login_attempt" ADD COLUMN "login_hash" text;--> statement-breakpoint
CREATE INDEX "idx_login_attempt_login_hash_created_at" ON "login_attempt" USING btree ("login_hash","created_at") WHERE "login_attempt"."login_hash" is not null;--> statement-breakpoint
-- 2. The two lockout settings are gone: login_limit_lockout_minutes became login_limit_delay_seconds and
--    login_limit_lockout_max_minutes became login_limit_delay_max_minutes (the meaning changed from minutes of lock to seconds and
--    minutes of delay, so a stored value cannot be carried over). seedCore() inserts the new keys with their defaults on the
--    migration run that follows; login_limit_window_minutes keeps whatever an administrator saved (the default is now 60).
DELETE FROM "setting" WHERE "key" IN ('login_limit_lockout_minutes', 'login_limit_lockout_max_minutes');
