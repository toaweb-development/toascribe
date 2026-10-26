#!/usr/bin/env bash
# scripts/release-notes.sh <tag> — skriver versjonens CHANGELOG-seksjon til stdout.
# From VERSIONING_STANDARD_2026 §4.1. Used by the release job in .github/workflows/release.yml.
set -euo pipefail
tag="${1:?bruk: release-notes.sh <tag>}"
version="${tag#v}"
notes="$(awk -v v="${version}" '
  $0 ~ "^## \\[" v "\\]" { on = 1; next }
  /^## \[/ || /^\[[^]]+\]: / { on = 0 }
  on
' CHANGELOG.md)"
[ -n "${notes//[[:space:]]/}" ] || { echo "CHANGELOG.md har ingen seksjon for ${version}" >&2; exit 1; }
printf '%s\n' "$notes"
