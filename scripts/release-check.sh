#!/usr/bin/env bash
# `pnpm release:check`: everything the old ci.yml did, on this machine, before a release (VERSIONING_STANDARD_2026 §4,
# SECURITY_STANDARD_2026 §9). Push starts no workflow; a tag vX.Y.Z starts release.yml, which builds, scans and publishes. So
# this runs on main before the chore(release) commit and the tag, from a clean working tree:
#
#    1. actionlint on every workflow
#    2. the dependency audit (scripts/audit.sh: the review date of the exceptions, then pnpm audit --prod --audit-level high)
#    3. pnpm check with a throwaway PostgreSQL 18 and Mailpit, so the database and e-mail tests run and none is skipped
#    4. every image built with provenance and SBOM attestations into a throwaway registry, as release.yml builds them
#    5. the digest of each image read once (scripts/image-digests.sh) and scanned with Trivy, with the rules of release.yml
#       (Critical and High with a known fix fail), and the valkey image of compose.yaml too
#    6. the scanned images started as a user starts them, and the route checks before install, `toa core install`, and
#       the route checks after it (scripts/check-routes.sh)
#    7. a dry run of the publishing: the scanned digests into an OCI layout (scripts/export-images.sh), then
#       scripts/publish-images.sh from it into a second throwaway registry, as the build and publish jobs do
#    8. the full end-to-end suite (apps/admin/e2e, Playwright) against its own stack
#
# Needs: docker with compose and buildx 0.33 or newer, trivy, actionlint, jq, curl, openssl, pnpm, and Playwright's Chromium
# (README, «Verktøy for release:check»). Everything it starts is removed at the end, also after a failure. Ports and names
# can be changed with the RELEASE_CHECK_* variables below when a default is taken.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${root}"

prefix="${RELEASE_CHECK_PROJECT:-toascribe-release-check}"
db_port="${RELEASE_CHECK_DB_PORT:-55439}"
mailpit_http_port="${RELEASE_CHECK_MAILPIT_HTTP_PORT:-18129}"
mailpit_smtp_port="${RELEASE_CHECK_MAILPIT_SMTP_PORT:-11029}"
build_registry_port="${RELEASE_CHECK_REGISTRY_PORT:-15000}"
target_registry_port="${RELEASE_CHECK_TARGET_REGISTRY_PORT:-15001}"
http_port="${RELEASE_CHECK_HTTP_PORT:-18090}"
edge_subnet="${RELEASE_CHECK_EDGE_SUBNET:-10.231.99.0/24}"
builder="${prefix}"

# Images that are not built here, pinned by tag and digest. Mailpit is the upstream release docker/mailpit/Dockerfile builds on
# (a test checks that); it only catches the test mails. The registry is the one release.yml uses.
postgres_image='postgres:18.6-alpine3.24@sha256:77f585114c32fbca283dc835b0596f4e52b51b4c6662d7810b2f4084f60a1873'
mailpit_image='axllent/mailpit:v1.31.6@sha256:23fe39e81bde596a918000b3135c0f85dc8bb4c9ea6be274b051143f3e300387'
registry_image='registry:3.1.1@sha256:325b4b29b041e82803abeb703e201655e4e23ab83264ec1a7c9ddb0a5b14a6e0'
# Valkey is not built here, but it is part of the stack a user can switch on, so it gets the same scan (as in compose.yaml).
valkey_image='valkey/valkey:9.1.2-alpine3.24@sha256:48332870af354a799964c0012ae1194a0bf2bf894eb508f945810596dc2d8d11'

names=(proxy site admin api postgres mailpit)

step() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
fail() {
  printf '\n\033[31mrelease:check failed: %s\033[0m\n' "$*" >&2
  exit 1
}

# --- 0. Tools and a clean tree ----------------------------------------------------------------------------------------------

step 'Tools'
missing=()
for tool in docker trivy actionlint jq curl openssl pnpm; do
  command -v "${tool}" >/dev/null 2>&1 || missing+=("${tool}")
done
if [ "${#missing[@]}" -gt 0 ]; then
  fail "missing: ${missing[*]}. See «Verktøy for release:check» in README.md (trivy and actionlint go in ~/.local/bin)."
fi
docker info >/dev/null 2>&1 || fail 'docker does not answer (is the daemon running, and are you in the docker group?)'
docker compose version >/dev/null 2>&1 || fail 'docker compose is missing'
buildx="$(docker buildx version 2>/dev/null | awk '{print $2}' | sed 's/^v//')"
if [ -z "${buildx}" ] || [ "$(printf '%s\n0.33.0\n' "${buildx}" | sort -V | head -1)" != 0.33.0 ]; then
  fail "docker buildx 0.33 or newer is needed for OCI layouts (found: ${buildx:-none})"
fi
echo "docker $(docker version --format '{{.Server.Version}}'), buildx ${buildx}, $(trivy --version | head -1), actionlint $(actionlint -version | head -1)"
if [ -n "$(git status --porcelain)" ]; then
  fail 'the working tree is not clean; release:check checks what is committed'
fi
version="$(jq -er .version package.json)"
[[ "${version}" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-rc\.[0-9]+)?$ ]] || fail "package.json version '${version}' is not semver"
echo "version ${version}, commit $(git rev-parse --short HEAD)"

state="$(mktemp -d "${TMPDIR:-/tmp}/${prefix}.XXXXXX")"
chmod 700 "${state}"
stack_env="${state}/stack.env"
stack_tag="${version}-release-check"

stack() {
  docker compose -p "${prefix}" -f docker/compose.yaml --env-file "${stack_env}" "$@"
}

e2e_started=false
cleanup() {
  local status=$?
  set +e
  step 'Clean up'
  if [ -f "${stack_env}" ]; then
    if [ "${status}" -ne 0 ]; then stack logs --no-color --tail 80 2>/dev/null; fi
    stack down -v >/dev/null 2>&1
  fi
  if [ "${e2e_started}" = true ]; then
    apps/admin/e2e/stack.sh down >/dev/null 2>&1
    E2E_PROJECT=toascribe-e2e-setup E2E_HTTP_PORT=18081 E2E_MAILPIT_PORT=18026 apps/admin/e2e/stack.sh down >/dev/null 2>&1
  fi
  docker rm -f "${prefix}-db" "${prefix}-mailpit" "${prefix}-registry" "${prefix}-target" >/dev/null 2>&1
  for name in "${names[@]}"; do
    docker image rm "ghcr.io/toaweb-development/toascribe-${name}:${stack_tag}" >/dev/null 2>&1
  done
  rm -rf "${state}"
  if [ "${status}" -eq 0 ]; then
    printf '\n\033[32mrelease:check passed for %s (%s).\033[0m\n' "${version}" "$(git rev-parse --short HEAD)"
  fi
  exit "${status}"
}
trap cleanup EXIT

wait_for() {
  local url="$1" what="$2"
  for _ in $(seq 1 60); do
    curl -fsS "${url}" >/dev/null 2>&1 && return 0
    sleep 1
  done
  fail "${what} did not start (${url})"
}

# --- 1. actionlint -------------------------------------------------------------------------------------------------------------

step 'actionlint'
actionlint

# --- 2. Audit ------------------------------------------------------------------------------------------------------------------

step 'Audit'
scripts/audit.sh

# --- 3. pnpm check with the database and e-mail tests ----------------------------------------------------------------------------

step 'pnpm check, with PostgreSQL 18 and Mailpit'
db_password="$(openssl rand -hex 24)"
docker run -d --name "${prefix}-db" -e POSTGRES_PASSWORD="${db_password}" -p "127.0.0.1:${db_port}:5432" \
  "${postgres_image}" >/dev/null
docker run -d --name "${prefix}-mailpit" -p "127.0.0.1:${mailpit_http_port}:8025" -p "127.0.0.1:${mailpit_smtp_port}:1025" \
  "${mailpit_image}" >/dev/null
# 127.0.0.1, not the socket: the image's temporary init server listens on the socket only.
for _ in $(seq 1 60); do
  docker exec "${prefix}-db" pg_isready -q -h 127.0.0.1 -U postgres && break
  sleep 1
done
docker exec "${prefix}-db" pg_isready -q -h 127.0.0.1 -U postgres || fail 'PostgreSQL did not start'
wait_for "http://127.0.0.1:${mailpit_http_port}/readyz" Mailpit
TEST_DATABASE_URL="postgres://postgres:${db_password}@127.0.0.1:${db_port}/postgres" \
  MAILPIT_URL="http://127.0.0.1:${mailpit_http_port}" MAILPIT_SMTP="127.0.0.1:${mailpit_smtp_port}" \
  pnpm check
docker rm -f "${prefix}-db" "${prefix}-mailpit" >/dev/null

# --- 4. Build with attestations into a throwaway registry -------------------------------------------------------------------------

step 'Build the images with attestations'
docker run -d --name "${prefix}-registry" -p "127.0.0.1:${build_registry_port}:5000" "${registry_image}" >/dev/null
docker run -d --name "${prefix}-target" -p "127.0.0.1:${target_registry_port}:5000" "${registry_image}" >/dev/null
wait_for "http://127.0.0.1:${build_registry_port}/v2/" 'the build registry'
wait_for "http://127.0.0.1:${target_registry_port}/v2/" 'the target registry'
# A builder of its own, kept between runs for its cache. network=host so that it reaches the registry on localhost.
if ! docker buildx inspect "${builder}" >/dev/null 2>&1; then
  docker buildx create --name "${builder}" --driver docker-container --driver-opt network=host >/dev/null
fi
source_prefix="localhost:${build_registry_port}/toaweb-development"
TOASCRIBE_VERSION="${version}" TOASCRIBE_REGISTRY="${source_prefix}" \
  docker buildx bake --builder "${builder}" -f docker/compose.build.yaml --push \
  --set '*.attest=type=provenance,mode=max' --set '*.attest=type=sbom'

# --- 5. Digests and scan ----------------------------------------------------------------------------------------------

step 'Read the digests'
digests="$(scripts/image-digests.sh "${source_prefix}" "${version}")"
echo "${digests}"

step 'Scan every image with Trivy'
# The same rules as the scan steps of release.yml (a test checks that).
scan() {
  echo "--- ${1}"
  trivy image --quiet --image-src remote --scanners vuln --severity CRITICAL,HIGH --ignore-unfixed --exit-code 1 "$1"
}
for name in "${names[@]}"; do
  scan "${source_prefix}/toascribe-${name}@$(jq -r --arg n "${name}" '.[$n]' <<<"${digests}")"
done
scan "${valkey_image}"

# --- 6. The scanned images as a user starts them, and the route checks --------------------------------------------------------------

step 'Start the scanned images'
# Pulled by digest from the build registry and tagged with the name compose.yaml uses, so the stack runs what was scanned.
for name in "${names[@]}"; do
  ref="${source_prefix}/toascribe-${name}@$(jq -r --arg n "${name}" '.[$n]' <<<"${digests}")"
  docker pull --quiet "${ref}" >/dev/null
  docker tag "${ref}" "ghcr.io/toaweb-development/toascribe-${name}:${stack_tag}"
done
(
  umask 077
  for name in POSTGRES_PASSWORD POSTGRES_OWNER_PASSWORD POSTGRES_APP_PASSWORD TOASCRIBE_ENCRYPTION_KEY TOASCRIBE_SIGNING_KEY; do
    echo "${name}=$(openssl rand -hex 32)"
  done
  echo "TOASCRIBE_VERSION=${stack_tag}"
  echo "TOASCRIBE_HTTP_PORT=${http_port}"
  echo "TOASCRIBE_EDGE_SUBNET=${edge_subnet}"
  echo "PUBLIC_ORIGIN=http://localhost:${http_port}"
) >"${stack_env}"
stack up -d --wait --no-build --pull never

base="http://127.0.0.1:${http_port}"
step 'Routes before install'
scripts/check-routes.sh before "${base}"

step 'toa core install'
# Every value is a flag and the password comes on standard input (never as an argument). --skip-email: no mail server here.
openssl rand -hex 24 | tr -d '\n' | stack exec -T api toa core install \
  --url "http://localhost:${http_port}" \
  --title 'Release check' \
  --admin-user release-check \
  --admin-email release-check@example.com \
  --admin-password-stdin \
  --skip-email

step 'Routes after install'
scripts/check-routes.sh after "${base}"
stack down -v >/dev/null
rm -f "${stack_env}"

# --- 7. Publishing, dry run ------------------------------------------------------------------------------------------------------

step 'Publish dry run (into a second throwaway registry, not ghcr.io)'
layout="${state}/images"
scripts/export-images.sh "${source_prefix}" "${layout}" "${digests}"
scripts/publish-images.sh "${layout}" "localhost:${target_registry_port}/toaweb-development" "${version}" \
  "sha-$(git rev-parse --short=7 HEAD)" "${digests}"
docker rm -f "${prefix}-registry" "${prefix}-target" >/dev/null

# --- 8. End-to-end -----------------------------------------------------------------------------------------------------------

step 'End-to-end tests'
e2e_started=true
apps/admin/e2e/stack.sh up
CI=1 pnpm test:e2e
