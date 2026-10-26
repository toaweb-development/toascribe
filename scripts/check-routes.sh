#!/usr/bin/env bash
# The route checks of the P1 flow in docs/PLAN.md, against a running stack (run by `pnpm release:check`):
#
#   scripts/check-routes.sh before BASE_URL   the stack as a first-time user finds it (not installed)
#   scripts/check-routes.sh after BASE_URL    the same stack after `toa core install`
#
# «after» holds only after the install and «before» only before it, so each proves the other's checks are not vacuous.
# --path-as-is: curl sends the path as written; newer curl would otherwise resolve %2e%2e itself and the proxy would never see it.
set -euo pipefail

phase="${1:?usage: check-routes.sh before|after BASE_URL}"
base="${2:?usage: check-routes.sh before|after BASE_URL}"
# The install service in the api remembers «not installed» for up to a second after the CLI installed the site, so after the
# install each check tries a few times with a short pause before it fails.
attempts=1
if [ "${phase}" = after ]; then attempts=5; fi

fail() {
  echo "::error::$*" >&2
  exit 1
}

check() {
  local code=""
  for attempt in $(seq "${attempts}"); do
    code="$(curl -s --path-as-is -o /dev/null -w '%{http_code}' "${base}$1")"
    echo "$1 -> ${code} (attempt ${attempt})"
    if [ "${code}" = "$2" ]; then return 0; fi
    if [ "${attempt}" -lt "${attempts}" ]; then sleep 1; fi
  done
  fail "$1 returned ${code}, expected $2"
}

# A redirect to the wizard: the code and the end of Location (the app sends a relative or an absolute address).
check_wizard() {
  local out code location
  out="$(curl -s --path-as-is -o /dev/null -w '%{http_code} %header{location}' "${base}$1")"
  echo "$1 -> ${out}"
  code="${out%% *}"
  location="${out#* }"
  if [ "${code}" != "302" ] || [ "${location%/admin/setup}" = "${location}" ]; then
    fail "$1 returned '${out}', expected 302 with a Location ending in /admin/setup"
  fi
}

installed_is() {
  local status installed=""
  for attempt in $(seq "${attempts}"); do
    status="$(curl -s --path-as-is "${base}/api/v1/setup/status")"
    echo "/api/v1/setup/status -> ${status} (attempt ${attempt})"
    installed="$(jq -r '.installed' <<<"${status}" || true)"
    if [ "${installed}" = "$1" ]; then return 0; fi
    if [ "${attempt}" -lt "${attempts}" ]; then sleep 1; fi
  done
  fail "/api/v1/setup/status does not say installed=$1"
}

case "${phase}" in
  before)
    check_wizard /
    check_wizard /admin
    installed_is false
    check /admin/setup 200
    ;;
  after)
    check / 200
    check /admin/login 200
    # The wizard is gone: no token is sent, and it must still be 404 (the setup routes do not exist once installed).
    check /admin/setup 404
    check /api/v1/setup/state 404
    installed_is true
    ;;
  *)
    echo "usage: check-routes.sh before|after BASE_URL" >&2
    exit 2
    ;;
esac

check /api/health 200
check /api/ready 200
# The redirects and the refused paths do not depend on the install; they hold in both phases.
check /setup 308
check /login 308
check '/wp-login.php?action=lostpassword' 308
check /wp-admin/edit.php 308
# A path that Caddy would route by one reading and forward by another is refused (docker/proxy/Caddyfile).
check /api/..%2Fadmin 400
check /api/%2e%2e/admin 400
echo "routes ${phase} install: OK"
