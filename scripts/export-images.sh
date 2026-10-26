#!/usr/bin/env bash
# Writes the scanned images from a registry into one OCI layout folder, by digest.
#
#   export-images.sh SOURCE_PREFIX LAYOUT_DIR DIGESTS_JSON
#   export-images.sh localhost:5000/toaweb-development "$RUNNER_TEMP/images" '{"api":"sha256:…",…}'
#
# DIGESTS_JSON comes from scripts/image-digests.sh, and every image in it has been scanned before this runs. The build job of
# .github/workflows/release.yml runs this as its last step before the upload, so no third-party step runs between writing the
# folder and uploading it; scripts/publish-images.sh then checks every blob of the folder against its hash and copies exactly
# those digests on. `pnpm release:check` runs the same scripts against local registries.
#
# `docker buildx imagetools create` (buildx 0.33 or newer) copies the image index as it is, with the provenance and SBOM
# attestations beside it, so the digest in the layout is the digest that was scanned. The script checks that.
set -euo pipefail

if [ "$#" -ne 3 ]; then
  echo "usage: $0 SOURCE_PREFIX LAYOUT_DIR DIGESTS_JSON" >&2
  exit 2
fi
source_prefix="$1"
layout="$2"
digests="$3"

# The images the release publishes: the five that users run and the development-only mailpit (docker/compose.build.yaml).
names=(proxy site admin api postgres mailpit)

digest_of() {
  docker buildx imagetools inspect --format '{{json .Manifest}}' "$1" | jq -er .digest
}

mkdir -p "${layout}"
for name in "${names[@]}"; do
  digest="$(jq -r --arg name "${name}" '.[$name] // ""' <<<"${digests}")"
  if [[ ! "${digest}" =~ ^sha256:[0-9a-f]{64}$ ]]; then
    echo "::error::no valid digest for ${name}." >&2
    exit 1
  fi
  # Copy by digest, not by tag: a tag moved in the source after the scan is not followed.
  if ! output="$(docker buildx imagetools create --tag "oci-layout://${layout}:toascribe-${name}" \
    "${source_prefix}/toascribe-${name}@${digest}" 2>&1)"; then
    echo "${output}" >&2
    echo "::error::could not write ${name} (${digest}) into ${layout}." >&2
    exit 1
  fi
  got="$(digest_of "oci-layout://${layout}:toascribe-${name}")"
  if [ "${got}" != "${digest}" ]; then
    echo "::error::the layout has ${got} for ${name}, the scan had ${digest}." >&2
    exit 1
  fi
  echo "${name} ${digest}"
done
# The folder buildx leaves for unfinished writes; empty after a successful copy.
rmdir "${layout}/ingest" 2>/dev/null || true
