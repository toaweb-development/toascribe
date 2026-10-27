-- M1.7 (custom): the app role may read the migration journal, so a backup made as the app role (`toa backup create`, the worker's
-- daily backup) holds it and a restore knows which migrations the database had. Read only; the journal stays the owner's. Where
-- the role does not exist (a database made by hand, a test without it), nothing is granted.
-- Downgrade (drizzle runs forward only):
--   REVOKE SELECT ON ALL SEQUENCES IN SCHEMA drizzle FROM toascribe_app;
--   REVOKE SELECT ON drizzle.__drizzle_migrations FROM toascribe_app; REVOKE USAGE ON SCHEMA drizzle FROM toascribe_app;
DO $grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'toascribe_app') THEN
    GRANT USAGE ON SCHEMA drizzle TO toascribe_app;
    GRANT SELECT ON drizzle.__drizzle_migrations TO toascribe_app;
    GRANT SELECT ON ALL SEQUENCES IN SCHEMA drizzle TO toascribe_app;
  END IF;
END
$grant$;
