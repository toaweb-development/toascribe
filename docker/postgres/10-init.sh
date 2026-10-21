#!/bin/sh
# toascribe: first-start role setup for the official postgres image.
#
# Mounted (or copied) into /docker-entrypoint-initdb.d/, which the image runs once, as postgres,
# when the data directory is empty. It runs init.sql with psql variables, so the passwords come
# from the environment and are never written in a file. init.sql itself must NOT be placed in
# /docker-entrypoint-initdb.d/: the image would run it there without the variables.
# The passwords reach psql with \getenv (psql 15 and newer), not with -v: a -v value sits in psql's command
# line, which anyone in the container can read from the process list while the script runs.
#
# Environment (the image already sets POSTGRES_USER and POSTGRES_DB):
#   POSTGRES_OWNER_PASSWORD  password for toascribe_owner (migrations)
#   POSTGRES_APP_PASSWORD    password for toascribe_app (api and worker)
#   TOASCRIBE_INIT_SQL       path to init.sql (default /etc/toascribe/postgres/init.sql)
set -eu

: "${POSTGRES_OWNER_PASSWORD:?POSTGRES_OWNER_PASSWORD must be set (openssl rand -hex 32)}"
: "${POSTGRES_APP_PASSWORD:?POSTGRES_APP_PASSWORD must be set (openssl rand -hex 32)}"

init_sql="${TOASCRIBE_INIT_SQL:-/etc/toascribe/postgres/init.sql}"
if [ ! -r "$init_sql" ]; then
  echo "10-init.sh: cannot read $init_sql" >&2
  exit 1
fi

# psql reads this script from stdin: it names the environment variables, never their values.
# The path is exported because \getenv reads it from the environment as well.
export TOASCRIBE_INIT_SQL="$init_sql"
psql -v ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  -v db_name="$POSTGRES_DB" \
  -f - <<'PSQL'
\getenv owner_password POSTGRES_OWNER_PASSWORD
\getenv app_password POSTGRES_APP_PASSWORD
\getenv init_sql TOASCRIBE_INIT_SQL
\i :init_sql
PSQL
