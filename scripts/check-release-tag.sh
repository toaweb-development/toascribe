#!/usr/bin/env bash
# scripts/check-release-tag.sh <tag> — tag vX.Y.Z[-rc.N] må være versjonen i sannhetskilden.
# From VERSIONING_STANDARD_2026 §4.1. The first step of the build job in .github/workflows/release.yml.
set -euo pipefail
VERSION_FILE="${VERSION_FILE:-package.json}"   # package.json | pyproject.toml | VERSION; frontend/+backend/: backend/pyproject.toml
tag="${1:?bruk: check-release-tag.sh <tag>}"
want="${tag#v}"
case "$VERSION_FILE" in
  *package.json)   have="$(grep -m1 -oP '"version"\s*:\s*"\K[^"]+' "$VERSION_FILE")" ;;
  *pyproject.toml) have="$(grep -m1 -oP '^version\s*=\s*"\K[^"]+' "$VERSION_FILE")" ;;
  *)               have="$(tr -d '[:space:]' < "$VERSION_FILE")" ;;
esac
if [ "$have" != "$want" ]; then
  echo "::error::Tag ${tag} matcher ikke ${VERSION_FILE} (${have:-ingen versjon}) — bump i chore(release)-commiten og tagg den" >&2
  exit 1
fi
case "$want" in *-rc.*) exit 0 ;; esac
grep -q "^## \[${want}\] - " CHANGELOG.md \
  || { echo "::error::CHANGELOG.md mangler '## [${want}] - YYYY-MM-DD'" >&2; exit 1; }
echo "tag ${tag} = ${VERSION_FILE} ${have}: OK"
