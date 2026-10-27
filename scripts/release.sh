#!/usr/bin/env bash
# scripts/release.sh [--dry-run] X.Y.Z[-rc.N] — den eneste veien til en release (VERSIONING_STANDARD §4).
# Sjekker → check + audit → versjon i sannhetskilden → commit → annotert tag → atomisk push av main + tag.
# Feiler noe, er ingenting pushet. --dry-run kjører bare sjekkene, check og audit.
set -euo pipefail

# toascribe: the root package.json is the source; every workspace package.json and the TOASCRIBE_VERSION default of the two
# compose files and .env.example mirror it (test/version-mirror.test.ts). The globs are expanded after the cd to the repo root.
VERSION_FILE="${VERSION_FILE:-package.json}"
MIRROR_FILES="${MIRROR_FILES:-apps/*/package.json packages/*/package.json themes/*/package.json cli/package.json docker/compose.yaml docker/compose.build.yaml docker/.env.example}"
# release:check: actionlint, pnpm check with the database and e-mail tests, the image build, Trivy, the route checks, the
# publish dry run and the e2e suite (scripts/release-check.sh).
CHECK_CMD="${CHECK_CMD:-pnpm release:check}"
# The documented exceptions' review date, then pnpm audit --prod --audit-level high (SECURITY_STANDARD §9).
AUDIT_CMD="${AUDIT_CMD-scripts/audit.sh}"
REMOTE="${REMOTE:-origin}"

audit_node() { (cd "$1" && pnpm audit --prod --audit-level=high); }
audit_python() {   # SECURITY_STANDARD §9; eksporten havner utenfor arbeidskopien
  local tmp status=0
  tmp="$(mktemp -d)"
  (cd "$1" && uv export --frozen --no-dev --no-emit-project --format requirements.txt -o "$tmp/requirements-audit.txt" \
    && uvx pip-audit==2.10.1 -r "$tmp/requirements-audit.txt" --disable-pip --strict) || status=$?
  rm -rf "$tmp"
  return "$status"
}

die() { echo "release: $*" >&2; exit 1; }

read_version() {
  case "$1" in
    *package.json)   grep -m1 -oP '"version"\s*:\s*"\K[^"]+' "$1" || true ;;
    *pyproject.toml) grep -m1 -oP '^version\s*=\s*"\K[^"]+' "$1" || true ;;
    *compose*.yaml)  grep -m1 -oP 'TOASCRIBE_VERSION:-\K[^}]+' "$1" || true ;;   # toascribe: the image tag's default
    *.env.example)   grep -m1 -oP '^TOASCRIBE_VERSION=\K\S+' "$1" || true ;;
    *)               tr -d '[:space:]' < "$1" ;;
  esac
}

write_version() {   # første versjonslinje byttes; resten av fila står urørt
  case "$1" in
    *package.json)   sed -i -E "0,/\"version\"[[:space:]]*:[[:space:]]*\"[^\"]*\"/s//\"version\": \"$2\"/" "$1" ;;
    *pyproject.toml) sed -i -E "0,/^version[[:space:]]*=[[:space:]]*\"[^\"]*\"/s//version = \"$2\"/" "$1" ;;
    *compose*.yaml)  sed -i -E "s/(TOASCRIBE_VERSION:-)[^}]+/\1$2/g" "$1" ;;   # toascribe: every image line
    *.env.example)   sed -i -E "s/^TOASCRIBE_VERSION=.*/TOASCRIBE_VERSION=$2/" "$1" ;;
    *)               printf '%s\n' "$2" > "$1" ;;
  esac
  [ "$(read_version "$1")" = "$2" ] || die "fikk ikke skrevet $2 til $1"
}

# semver_gt A B: A > B. Bare X.Y.Z og X.Y.Z-rc.N; X.Y.Z-rc.N < X.Y.Z.
semver_gt() {
  local a b i
  IFS=. read -r -a a <<< "$(sed -E 's/-rc\./ /; s/^([0-9.]+)$/\1 999999999/; s/ /./' <<< "$1")"
  IFS=. read -r -a b <<< "$(sed -E 's/-rc\./ /; s/^([0-9.]+)$/\1 999999999/; s/ /./' <<< "$2")"
  for i in 0 1 2 3; do
    (( 10#${a[i]} > 10#${b[i]} )) && return 0
    (( 10#${a[i]} < 10#${b[i]} )) && return 1
  done
  return 1
}

dry_run=0
case "${1:-}" in --dry-run) dry_run=1; shift ;; esac
version="${1:?bruk: scripts/release.sh [--dry-run] X.Y.Z[-rc.N]}"
version="${version#v}"
tag="v${version}"
[[ $version =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-rc\.(0|[1-9][0-9]*))?$ ]] \
  || die "'$version' er ikke X.Y.Z eller X.Y.Z-rc.N"

cd "$(git rev-parse --show-toplevel)"

# a. main, ren arbeidskopi, ny og høyere versjon
[ "$(git symbolic-ref --quiet --short HEAD || true)" = main ] || die "ikke på main"
[ -z "$(git status --porcelain)" ] || die "arbeidskopien er ikke ren (git status)"
[ -f "$VERSION_FILE" ] || die "$VERSION_FILE finnes ikke (sett VERSION_FILE øverst)"
current="$(read_version "$VERSION_FILE")"
[[ $current =~ ^[0-9]+\.[0-9]+\.[0-9]+(-rc\.[0-9]+)?$ ]] || die "fant ingen gyldig versjon i $VERSION_FILE ('$current')"
semver_gt "$version" "$current" || die "$version er ikke høyere enn nåværende $current"
for f in $MIRROR_FILES; do [ -f "$f" ] || die "speilet $f finnes ikke"; done
git rev-parse --quiet --verify "refs/tags/$tag" >/dev/null && die "taggen $tag finnes allerede lokalt"
git remote get-url "$REMOTE" >/dev/null 2>&1 || die "remoten $REMOTE finnes ikke"
git fetch --quiet --no-tags "$REMOTE" || die "fikk ikke hentet fra $REMOTE"
remote_tags="$(git ls-remote --tags "$REMOTE" "refs/tags/$tag")" || die "fikk ikke lest tagger fra $REMOTE"
[ -z "$remote_tags" ] || die "taggen $tag finnes allerede på $REMOTE"
if git rev-parse --quiet --verify "refs/remotes/$REMOTE/main" >/dev/null; then
  git merge-base --is-ancestor "$REMOTE/main" HEAD || die "$REMOTE/main har commits som lokal main ikke har"
fi

# b. CHANGELOG-seksjonen (ikke for -rc)
if [[ $version != *-rc.* ]]; then
  grep -qE "^## ${version//./\\.} — [0-9]{4}-[0-9]{2}-[0-9]{2}\$" CHANGELOG.md 2>/dev/null \
    || die "CHANGELOG.md mangler '## ${version} — YYYY-MM-DD' (skriv den og commit først)"
fi

# c. check og audit
echo "release: check ($CHECK_CMD)"
( eval "$CHECK_CMD" ) || die "check feilet"
if [ -n "$AUDIT_CMD" ]; then
  echo "release: audit ($AUDIT_CMD)"
  ( eval "$AUDIT_CMD" ) || die "audit feilet (high/critical med fiks stopper releasen; SECURITY_STANDARD §9)"
else
  echo "release: audit hoppet over (AUDIT_CMD er tom)"
fi
[ -z "$(git status --porcelain)" ] || die "check/audit endret arbeidskopien (git status); commit eller ignorer det først"

if (( dry_run )); then
  echo "release: --dry-run OK: $current → $version. Ingenting er endret eller pushet."
  exit 0
fi

# d. versjonen inn i sannhetskilden og speilene
for f in "$VERSION_FILE" $MIRROR_FILES; do write_version "$f" "$version"; done

# e. commit og annotert tag
# shellcheck disable=SC2086  # MIRROR_FILES er bevisst mellomromsdelt
if ! git add -- "$VERSION_FILE" $MIRROR_FILES || ! git commit --quiet -m "release: $tag"; then
  # shellcheck disable=SC2086
  git restore --staged --worktree -- "$VERSION_FILE" $MIRROR_FILES || true
  die "commit feilet; versjonsfilene er tilbakestilt, ingenting er pushet"
fi
git tag -a "$tag" -m "$tag" || { git reset --quiet --hard HEAD~1; die "tag feilet; release-commiten er fjernet, ingenting er pushet"; }

# f. main og taggen i én atomisk push
if ! git push --atomic "$REMOTE" main "$tag"; then
  echo "release: push feilet; ingenting er pushet. Commit og tag ligger lokalt." >&2
  echo "  prøv igjen:  git push --atomic $REMOTE main $tag" >&2
  echo "  eller angre: git tag -d $tag && git reset --hard HEAD~1" >&2
  exit 1
fi
echo "release: $tag pushet (main + tag)"
