-- toascribe: roles and privileges (POSTGRESQL_STANDARD_2026, «Roller og tilganger»).
--
-- Runs once, as the postgres superuser, on the first start of an empty data directory.
-- It is run by 10-init.sh, never directly from /docker-entrypoint-initdb.d: it needs three psql
-- variables, so no password is ever written in this file (PLAN.md principle 4: no `changeme`).
--
--   db_name         the application database, created by the image from POSTGRES_DB
--   owner_password  password for toascribe_owner, from POSTGRES_OWNER_PASSWORD
--   app_password    password for toascribe_app, from POSTGRES_APP_PASSWORD
--
-- By hand: psql -v ON_ERROR_STOP=1 -v db_name=toascribe -v owner_password=… -v app_password=… -f init.sql
--          (10-init.sh sets the two passwords with \getenv instead, so they are not on its command line)

-- 1. Owner role: runs the migrations (DDL) through MIGRATION_DATABASE_URL. Not a superuser, no BYPASSRLS.
--    Owning the database makes it the owner of schema public too (pg_database_owner).
CREATE ROLE toascribe_owner WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD :'owner_password';
ALTER DATABASE :"db_name" OWNER TO toascribe_owner;

-- 2. App role: the running api and worker (DML only) through DATABASE_URL.
CREATE ROLE toascribe_app WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD :'app_password';
GRANT CONNECT ON DATABASE :"db_name" TO toascribe_app;

-- PostgreSQL 15+ already denies CREATE on public to PUBLIC; said again so a database restored from
-- an older dump cannot hand the app role DDL there.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO toascribe_app;

-- 3. Privileges on the tables the owner creates later in its migrations. FOR ROLE is required:
--    without it the rule only covers objects postgres itself creates, and it never does.
ALTER DEFAULT PRIVILEGES FOR ROLE toascribe_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO toascribe_app;
ALTER DEFAULT PRIVILEGES FOR ROLE toascribe_owner IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO toascribe_app;

-- 4. Job queue (pg-boss). The schema belongs to the owner, and the migration runner installs and
--    upgrades pg-boss in it as the owner. The worker starts pg-boss with `migrate: false`, so the
--    app role only ever needs DML here, the same model as public. The schema exists before
--    pg-boss runs so that the default privileges below can name it.
CREATE SCHEMA pgboss AUTHORIZATION toascribe_owner;
GRANT USAGE ON SCHEMA pgboss TO toascribe_app;
ALTER DEFAULT PRIVILEGES FOR ROLE toascribe_owner IN SCHEMA pgboss
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO toascribe_app;
ALTER DEFAULT PRIVILEGES FOR ROLE toascribe_owner IN SCHEMA pgboss
  GRANT USAGE, SELECT ON SEQUENCES TO toascribe_app;
