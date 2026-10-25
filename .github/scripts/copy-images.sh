#!/usr/bin/env bash
# Copies the scanned images from one registry to another, byte for byte, and proves it.
#
#   copy-images.sh SOURCE_PREFIX TARGET_PREFIX VERSION EXTRA_TAG
#   copy-images.sh localhost:5000/toaweb-development ghcr.io/toaweb-development 0.4.0 sha-3f9a1c2
#
# The release workflow builds into a throwaway registry, scans there, and runs this to publish; the pull request dry run
# (ci.yml) runs the same script against a second throwaway registry. So the copy is exercised on every pull request, and
# only the target differs on a release.
#
# `docker buildx imagetools create` with one source copies the manifest list as it is, with the provenance and SBOM
# attestations that sit beside it; nothing is rebuilt, so the digest that was scanned is the digest that is published.
# The script checks that, and stops if a digest changed.
#
# A version tag that already exists in the target is never overwritten (a re-run after a failure finishes the job instead of
# replacing images that users may already have pulled).
set -euo pipefail

if [ "$#" -ne 4 ]; then
  echo "usage: $0 SOURCE_PREFIX TARGET_PREFIX VERSION EXTRA_TAG" >&2
  exit 2
fi
source_prefix="$1"
target_prefix="$2"
version="$3"
extra_tag="$4"

# The images the release publishes: the five that users run and the development-only mailpit (docker/compose.build.yaml).
names=(proxy site admin api postgres mailpit)

digest_of() {
  docker buildx imagetools inspect --format '{{json .Manifest}}' "$1" | jq -er .digest
}

for name in "${names[@]}"; do
  source_ref="${source_prefix}/toascribe-${name}:${version}"
  target_ref="${target_prefix}/toascribe-${name}:${version}"
  extra_ref="${target_prefix}/toascribe-${name}:${extra_tag}"

  if docker buildx imagetools inspect "${target_ref}" > /dev/null 2>&1; then
    echo "::notice::${target_ref} is already published; not overwritten."
    continue
  fi

  want="$(digest_of "${source_ref}")"
  # buildx prints its progress on stderr; show it only when the copy fails.
  if ! output="$(docker buildx imagetools create --tag "${target_ref}" --tag "${extra_ref}" "${source_ref}" 2>&1)"; then
    echo "${output}" >&2
    echo "::error::could not copy ${source_ref} to ${target_ref}."
    exit 1
  fi

  for ref in "${target_ref}" "${extra_ref}"; do
    got="$(digest_of "${ref}")"
    if [ "${got}" != "${want}" ]; then
      echo "::error::${ref} has digest ${got}, the scanned image has ${want}."
      exit 1
    fi
  done
  echo "${target_ref} ${want}"
done
