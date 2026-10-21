#!/bin/sh
# toascribe: first-start role setup for the official postgres image.
#
# Mounted (or copied) into /docker-entrypoint-initdb.d/, which the image runs once, as postgres,
# when the data directory is empty. It runs init.sql with psql variables, so the passwords come
# from the environment and are never written in a file. init.sql itself must NOT be placed in
# /docker-entrypoint-initdb.d/: the image would run it there without the variables.
#
# Environment (the image already sets POSTGRES_USER and POSTGRES_DB):
#   POSTGRES_OWNER_PASSWORD  password for toascribe_owner (migrations)
#   POSTGRES_APP_PASSWORD    password for toascribe_app (api and worker)
#   TOASCRIBE_INIT_SQL       path to init.sql (default /etc/toascribe/postgres/init.sql)
set -eu

: "${POSTGRES_OWNER_PASSWORD:?POSTGRES_OWNER_PASSWORD must be set (openssl rand -base64 32)}"
: "${POSTGRES_APP_PASSWORD:?POSTGRES_APP_PASSWORD must be set (openssl rand -base64 32)}"

init_sql="${TOASCRIBE_INIT_SQL:-/etc/toascribe/postgres/init.sql}"
if [ ! -r "$init_sql" ]; then
  echo "10-init.sh: cannot read $init_sql" >&2
  exit 1
fi

psql -v ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  -v db_name="$POSTGRES_DB" \
  -v owner_password="$POSTGRES_OWNER_PASSWORD" \
  -v app_password="$POSTGRES_APP_PASSWORD" \
  -f "$init_sql"
