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
# First every blob in the layout is hashed and must match its file name: a blob's name is only a claim, and buildx copies the
# bytes it finds. Once the blob of the index digest is proven, everything under it is fixed too, because every manifest and
# layer is referenced by digest. Then every image is taken from the layout by the digest the build scanned, never by tag;
# the layout's tag must point at the same digest too. After the copy, the version tag and the extra tag in the target must
# both have that digest. Nothing is rebuilt, and the attestations (provenance
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

blobs=0
for blob in "${layout}"/blobs/sha256/*; do
  [ -f "${blob}" ] || continue
  if [ "$(sha256sum <"${blob}" | cut -c1-64)" != "$(basename "${blob}")" ]; then
    echo "::error::blob $(basename "${blob}") in ${layout} does not match its hash." >&2
    exit 1
  fi
  blobs=$((blobs + 1))
done
if [ "${blobs}" -eq 0 ]; then
  echo "::error::${layout} has no blobs." >&2
  exit 1
fi
echo "${blobs} blobs in ${layout} match their hashes."

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
