-- Written by hand: a custom migration (drizzle-kit generate --custom), because drizzle-kit does not manage privileges
-- or functions. A regenerate of 0000_core cannot drop it, and a later `generate` sees no change here.
--
-- audit_log is append-only for the app role (SECURITY_STANDARD §8 «Auditlogg»). init.sql's default privileges give
-- toascribe_app SELECT, INSERT, UPDATE and DELETE on every new table; here it keeps INSERT and SELECT only. ON DELETE
-- SET NULL from account still works: referential actions run as the table owner, and `actor` keeps the name.
--
-- The IP is kept for 90 days (PLAN) and then cleared by audit_log_clear_old_ips(). It runs as its owner, the role that
-- runs this migration (toascribe_owner), so the app role needs no UPDATE on the table. It takes no argument, so a
-- caller cannot shorten the 90 days or touch any other column. search_path is fixed, with pg_temp last, and every
-- object outside pg_catalog is schema-qualified (PostgreSQL docs, CREATE FUNCTION «Writing SECURITY DEFINER Functions
-- Safely»).
CREATE FUNCTION public.audit_log_clear_old_ips() RETURNS bigint
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  cleared bigint;
BEGIN
  UPDATE public.audit_log
     SET ip = NULL
   WHERE ip IS NOT NULL
     AND created_at < pg_catalog.now() - interval '90 days';
  GET DIAGNOSTICS cleared = ROW_COUNT;
  RETURN cleared;
END
$$;
--> statement-breakpoint
COMMENT ON FUNCTION public.audit_log_clear_old_ips() IS
  'Sets audit_log.ip to NULL on rows older than 90 days and returns how many it cleared. SECURITY DEFINER; the app role may only execute it.';
--> statement-breakpoint
-- Functions are executable by PUBLIC by default; this one only by its owner and the app role.
REVOKE ALL ON FUNCTION public.audit_log_clear_old_ips() FROM PUBLIC;
--> statement-breakpoint
-- The role is created by docker/postgres/init.sql. A database set up without it has nothing to revoke or grant.
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'toascribe_app') THEN
    -- REVOKE ALL also takes back any column privileges, so INSERT and SELECT are exactly what is left.
    REVOKE ALL ON TABLE public.audit_log FROM toascribe_app;
    GRANT SELECT, INSERT ON TABLE public.audit_log TO toascribe_app;
    GRANT EXECUTE ON FUNCTION public.audit_log_clear_old_ips() TO toascribe_app;
  END IF;
END
$$;
