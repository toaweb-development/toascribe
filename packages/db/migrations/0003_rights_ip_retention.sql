-- Written by hand: a custom migration (drizzle-kit generate --custom), because drizzle-kit does not manage data or
-- functions. M0.3 (Tor, 2026-10-21). Like every migration it runs once per database: the migrator records it in
-- drizzle.__drizzle_migrations and never runs it again, so an administrator who later gives a role these rights back
-- keeps them.
--
-- 1. Rights. The editor no longer gets unfiltered_html by default (DEFAULT_ROLES in @toascribe/shared); the
--    administrator keeps it and may grant it to any role. seedCore() never overwrites a role, so the editor row that
--    v0.2.0 seeded still has it: this removes it from the built-in editor role only. On a new database the role table
--    is empty here (seedCore runs after the migrations) and nothing happens. Other roles, and any capability an
--    administrator added, are not touched.
--
--    Each change is written to audit_log (SECURITY_STANDARD §8: every change of a role), as the system, source setup.
WITH old AS (
  SELECT id, capabilities
    FROM public.role
   WHERE slug = 'editor'
     AND 'unfiltered_html' = ANY (capabilities)
), changed AS (
  UPDATE public.role AS r
     SET capabilities = pg_catalog.array_remove(r.capabilities, 'unfiltered_html'),
         modified_at = pg_catalog.now()
    FROM old
   WHERE r.id = old.id
  RETURNING r.id, old.capabilities AS old_capabilities, r.capabilities AS new_capabilities
)
INSERT INTO public.audit_log (actor_type, actor, action, object_type, object_id, old_value, new_value, reason, source)
SELECT 'system', 'migration 0003_rights_ip_retention', 'role.capabilities_changed', 'role', changed.id::text,
       pg_catalog.to_jsonb(changed.old_capabilities), pg_catalog.to_jsonb(changed.new_capabilities),
       'unfiltered_html is no longer an editor right by default (M0.3)', 'setup'
  FROM changed;
--> statement-breakpoint
-- 2. The default role for new registrations can no longer be administrator (the CoreSettings schema refuses it). A
--    v0.2.0 database whose default_role was set to administrator by hand goes back to subscriber, the default.
WITH changed AS (
  UPDATE public.setting
     SET value = '"subscriber"'::jsonb,
         modified_at = pg_catalog.now()
   WHERE key = 'default_role'
     AND value = '"administrator"'::jsonb
  RETURNING key
)
INSERT INTO public.audit_log (actor_type, actor, action, object_type, object_id, old_value, new_value, reason, source)
SELECT 'system', 'migration 0003_rights_ip_retention', 'setting.updated', 'setting', changed.key,
       '"administrator"'::jsonb, '"subscriber"'::jsonb,
       'administrator cannot be the default role (M0.3)', 'setup'
  FROM changed;
--> statement-breakpoint
-- 3. IP retention from the setting ip_retention_days (one setting for sessions, comments, login attempts and the audit
--    log). Replaces the 90-day function of 0001_audit_log_privileges. CREATE OR REPLACE keeps the owner
--    (toascribe_owner), the SECURITY DEFINER property is restated, and the ACL stays as 0001 left it: EXECUTE for the
--    owner and toascribe_app, not PUBLIC. The app role gets no new right on audit_log (still INSERT and SELECT).
--
--    Still parameterless. The app role can write `setting`, so the setting is not a trust boundary: the floor is
--    enforced here. A row value below 7 counts as 7; a value that is not a whole JSON number (a string, a fraction,
--    null, or no row) counts as the default 90; above 3650 counts as 3650 (the CoreSettings bounds). A parameter would
--    add a second way to choose the retention without adding anything the worker needs, so there is none.
--
--    search_path is fixed with pg_temp last, and every object outside pg_catalog is schema-qualified (PostgreSQL
--    docs, CREATE FUNCTION «Writing SECURITY DEFINER Functions Safely»).
CREATE OR REPLACE FUNCTION public.audit_log_clear_old_ips() RETURNS bigint
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  stored jsonb;
  retention_days integer := 90;
  cleared bigint;
BEGIN
  SELECT s.value INTO stored FROM public.setting AS s WHERE s.key = 'ip_retention_days';
  -- Only a whole number of at most nine digits is read, so the cast below cannot fail or overflow.
  IF pg_catalog.jsonb_typeof(stored) = 'number' AND (stored #>> '{}') ~ '^-?[0-9]{1,9}$' THEN
    retention_days := LEAST(GREATEST((stored #>> '{}')::integer, 7), 3650);
  END IF;

  UPDATE public.audit_log
     SET ip = NULL
   WHERE ip IS NOT NULL
     AND created_at < pg_catalog.now() - pg_catalog.make_interval(days => retention_days);
  GET DIAGNOSTICS cleared = ROW_COUNT;
  RETURN cleared;
END
$$;
--> statement-breakpoint
COMMENT ON FUNCTION public.audit_log_clear_old_ips() IS
  'Sets audit_log.ip to NULL on rows older than the setting ip_retention_days (at least 7, at most 3650, 90 when unset or invalid) and returns how many it cleared. SECURITY DEFINER; the app role may only execute it.';
