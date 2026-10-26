#!/usr/bin/env bash
# Prints the index digest of every release image in a registry, as one line of JSON: {"proxy":"sha256:…",…}.
#
#   image-digests.sh SOURCE_PREFIX VERSION
#
# The build job of .github/workflows/release.yml and `pnpm release:check` read the digests once, right after the build, and
# then scan, export (scripts/export-images.sh) and publish (scripts/publish-images.sh) those digests and nothing else.
set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "usage: $0 SOURCE_PREFIX VERSION" >&2
  exit 2
fi
source_prefix="$1"
version="$2"

# The images the release publishes: the five that users run and the development-only mailpit (docker/compose.build.yaml).
names=(proxy site admin api postgres mailpit)

digests='{}'
for name in "${names[@]}"; do
  digest="$(docker buildx imagetools inspect --format '{{json .Manifest}}' "${source_prefix}/toascribe-${name}:${version}" |
    jq -er .digest)"
  if [[ ! "${digest}" =~ ^sha256:[0-9a-f]{64}$ ]]; then
    echo "::error::no digest for toascribe-${name}:${version}" >&2
    exit 1
  fi
  digests="$(jq -c --arg name "${name}" --arg digest "${digest}" '. + {($name): $digest}' <<<"${digests}")"
done
printf '%s\n' "${digests}"
