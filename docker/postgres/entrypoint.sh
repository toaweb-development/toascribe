#!/bin/sh
# toascribe: stops the postgres container before it touches the data directory when a password is missing.
#
# Why here: docker/compose.yaml has no required variables (`${X:?}` would stop `docker compose run ... toa core gen-env`,
# the command that makes the passwords, on a fresh folder), so the check moved to the service that needs them. The
# official image only looks at POSTGRES_PASSWORD, and 10-init.sh looks at the other two after `initdb` has made the data
# directory. A failed init leaves that directory behind, so the next start says «Skipping initialization» and the roles
# are never made. This runs first, so nothing is made.
#
# Only for the server (`postgres` or an option for it), so `docker run IMAGE psql ...` still works without them.
set -eu

missing() {
  echo "toascribe-postgres: $1 is empty. Set it in .env (openssl rand -hex 32), or make all of them with:" >&2
  echo "  docker compose run --rm --no-deps -T api toa core gen-env >> .env" >&2
  exit 1
}

case "${1:-}" in
  postgres | -*)
    [ -n "${POSTGRES_PASSWORD:-}" ] || missing POSTGRES_PASSWORD
    [ -n "${POSTGRES_OWNER_PASSWORD:-}" ] || missing POSTGRES_OWNER_PASSWORD
    [ -n "${POSTGRES_APP_PASSWORD:-}" ] || missing POSTGRES_APP_PASSWORD
    ;;
esac

exec docker-entrypoint.sh "$@"
