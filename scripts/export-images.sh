#!/usr/bin/env bash
# Writes the scanned images from a registry into one OCI layout folder, by digest, and prints their digests as JSON.
#
#   export-images.sh SOURCE_PREFIX VERSION LAYOUT_DIR > digests.json
#   export-images.sh localhost:5000/toaweb-development 0.6.0 "$RUNNER_TEMP/images"
#
# The build job of .github/workflows/release.yml builds into a throwaway registry, scans every image there by digest, runs this,
# and hands the folder to the publish job as an artifact and the digests as a job output. scripts/publish-images.sh then copies
# exactly those digests on. `pnpm release:check` runs the same pair against local registries.
#
# `docker buildx imagetools create` (buildx 0.33 or newer) copies the image index as it is, with the provenance and SBOM
# attestations beside it, so the digest in the layout is the digest that was scanned. The script checks that.
set -euo pipefail

if [ "$#" -ne 3 ]; then
  echo "usage: $0 SOURCE_PREFIX VERSION LAYOUT_DIR" >&2
  exit 2
fi
source_prefix="$1"
version="$2"
layout="$3"

# The images the release publishes: the five that users run and the development-only mailpit (docker/compose.build.yaml).
names=(proxy site admin api postgres mailpit)

digest_of() {
  docker buildx imagetools inspect --format '{{json .Manifest}}' "$1" | jq -er .digest
}

mkdir -p "${layout}"
digests='{}'
for name in "${names[@]}"; do
  source_ref="${source_prefix}/toascribe-${name}:${version}"
  digest="$(digest_of "${source_ref}")"
  # Copy by digest, not by tag: a tag moved in the source after the scan is not followed.
  if ! output="$(docker buildx imagetools create --tag "oci-layout://${layout}:toascribe-${name}" \
    "${source_prefix}/toascribe-${name}@${digest}" 2>&1)"; then
    echo "${output}" >&2
    echo "::error::could not write ${source_ref} into ${layout}." >&2
    exit 1
  fi
  got="$(digest_of "oci-layout://${layout}:toascribe-${name}")"
  if [ "${got}" != "${digest}" ]; then
    echo "::error::the layout has ${got} for ${name}, the registry has ${digest}." >&2
    exit 1
  fi
  echo "${name} ${digest}" >&2
  digests="$(jq -c --arg name "${name}" --arg digest "${digest}" '. + {($name): $digest}' <<<"${digests}")"
done
# The folder buildx leaves for unfinished writes; empty after a successful copy.
rmdir "${layout}/ingest" 2>/dev/null || true
printf '%s\n' "${digests}"
