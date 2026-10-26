#!/usr/bin/env bash
# Copies the scanned images from an OCI layout folder to a registry, by the digests the build recorded, and proves it.
#
#   publish-images.sh LAYOUT_DIR TARGET_PREFIX VERSION EXTRA_TAG DIGESTS_JSON
#   publish-images.sh "$RUNNER_TEMP/images" ghcr.io/toaweb-development 0.6.0 sha-3f9a1c2 '{"api":"sha256:…",…}'
#
# The publish job of .github/workflows/release.yml runs this on the artifact of the build job (scripts/export-images.sh made
# it), with DIGESTS_JSON from the build job's outputs. `pnpm release:check` runs it against a local registry as a dry run, so
# only the target differs on a release. It uses nothing but the docker CLI and jq of the runner: no third-party code runs in
# the job that may write packages.
#
# Every image is taken from the layout by its digest, never by tag: a layout whose image differs from what the build scanned
# has no blob for that digest and the copy fails; the layout's tag must point at the same digest too. After the copy, the
# version tag and the extra tag in the target must both have that digest. Nothing is rebuilt, and the attestations (provenance
# and SBOM) travel with the index.
#
# A version tag that already exists in the target is never overwritten (a re-run after a failure finishes the job instead of
# replacing images that users may already have pulled).
set -euo pipefail

if [ "$#" -ne 5 ]; then
  echo "usage: $0 LAYOUT_DIR TARGET_PREFIX VERSION EXTRA_TAG DIGESTS_JSON" >&2
  exit 2
fi
layout="$1"
target_prefix="$2"
version="$3"
extra_tag="$4"
digests="$5"

# The images the release publishes: the five that users run and the development-only mailpit (docker/compose.build.yaml).
names=(proxy site admin api postgres mailpit)

digest_of() {
  docker buildx imagetools inspect --format '{{json .Manifest}}' "$1" | jq -er .digest
}

for name in "${names[@]}"; do
  want="$(jq -r --arg name "${name}" '.[$name] // ""' <<<"${digests}")"
  if [[ ! "${want}" =~ ^sha256:[0-9a-f]{64}$ ]]; then
    echo "::error::no valid digest for ${name} in the build's outputs." >&2
    exit 1
  fi
  in_layout="$(digest_of "oci-layout://${layout}:toascribe-${name}")"
  if [ "${in_layout}" != "${want}" ]; then
    echo "::error::the artifact has ${in_layout} for ${name}, the build scanned ${want}." >&2
    exit 1
  fi

  target_ref="${target_prefix}/toascribe-${name}:${version}"
  extra_ref="${target_prefix}/toascribe-${name}:${extra_tag}"
  if docker buildx imagetools inspect "${target_ref}" >/dev/null 2>&1; then
    echo "::notice::${target_ref} is already published; not overwritten."
    continue
  fi

  # buildx prints its progress on stderr; show it only when the copy fails.
  if ! output="$(docker buildx imagetools create --tag "${target_ref}" --tag "${extra_ref}" \
    "oci-layout://${layout}@${want}" 2>&1)"; then
    echo "${output}" >&2
    echo "::error::could not copy ${name} (${want}) to ${target_ref}." >&2
    exit 1
  fi

  for ref in "${target_ref}" "${extra_ref}"; do
    got="$(digest_of "${ref}")"
    if [ "${got}" != "${want}" ]; then
      echo "::error::${ref} has digest ${got}, the scanned image has ${want}." >&2
      exit 1
    fi
  done
  echo "${target_ref} ${want}"
done
