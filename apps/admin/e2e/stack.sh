#!/usr/bin/env bash
# Starts and stops the compose stack that the end-to-end tests run against (see README.md in this folder).
#
#   apps/admin/e2e/stack.sh up      build the images and start the stack with the Mailpit profile; wait until it is healthy
#   apps/admin/e2e/stack.sh down    stop it and delete its volumes
#   apps/admin/e2e/stack.sh env     print the variables the tests read
#   apps/admin/e2e/stack.sh compose <args>   run `docker compose` for this project (e.g. `exec -T api toa version`)
#
# It never touches docker/.env: the passwords and keys are made fresh into a scratch env file outside the repo, and the stack
# has its own project name, ports, images (tagged ...-e2e) and volumes. Only what this project created is removed.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "$here/../../.." && pwd)"

project="${E2E_PROJECT:-toascribe-e2e}"
state="${E2E_STATE_DIR:-${TMPDIR:-/tmp}/${project}}"
env_file="${state}/env"
http_port="${E2E_HTTP_PORT:-18080}"
mailpit_port="${E2E_MAILPIT_PORT:-18025}"
# The proxy's `edge` network has a fixed subnet (compose.yaml), so two stacks at once need two: the wizard test's stack sets this.
edge_subnet="${E2E_EDGE_SUBNET:-}"

compose() {
  docker compose -p "${project}" -f "${root}/docker/compose.yaml" --env-file "${env_file}" --profile mailpit "$@"
}

make_env() {
  mkdir -p "${state}"
  chmod 700 "${state}"
  if [ -f "${env_file}" ]; then
    return
  fi
  umask 077
  {
    echo "POSTGRES_PASSWORD=$(openssl rand -hex 32)"
    echo "POSTGRES_OWNER_PASSWORD=$(openssl rand -hex 32)"
    echo "POSTGRES_APP_PASSWORD=$(openssl rand -hex 32)"
    echo "TOASCRIBE_ENCRYPTION_KEY=$(openssl rand -hex 32)"
    echo "TOASCRIBE_SIGNING_KEY=$(openssl rand -hex 32)"
    echo "TOASCRIBE_HTTP_PORT=${http_port}"
    echo "TOASCRIBE_MAILPIT_PORT=${mailpit_port}"
    echo "TOASCRIBE_VERSION=0.3.0-e2e"
    echo "PUBLIC_ORIGIN=http://localhost:${http_port}"
    echo "SMTP_HOST=mailpit"
    echo "SMTP_PORT=1025"
    echo "SMTP_SECURE=none"
    echo "MAIL_FROM_ADDRESS=toascribe@example.test"
    if [ -n "${edge_subnet}" ]; then
      echo "TOASCRIBE_EDGE_SUBNET=${edge_subnet}"
    fi
  } >"${env_file}"
}

case "${1:-}" in
  up)
    make_env
    compose up -d --build --wait
    ;;
  down)
    if [ -f "${env_file}" ]; then
      compose down -v
    fi
    ;;
  env)
    echo "E2E_BASE_URL=http://localhost:${http_port}"
    echo "E2E_MAILPIT_URL=http://localhost:${mailpit_port}"
    echo "E2E_PROJECT=${project}"
    echo "E2E_ENV_FILE=${env_file}"
    ;;
  compose)
    shift
    compose "$@"
    ;;
  *)
    echo "usage: stack.sh up|down|env|compose <args>" >&2
    exit 2
    ;;
esac
