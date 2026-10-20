#!/usr/bin/env bash
# No force push or deletion of main, and no moved or deleted version tags.
set -euo pipefail
is_zero() { case $1 in *[!0]*) return 1 ;; *) return 0 ;; esac; }
status=0
while read -r _local_ref local_oid remote_ref remote_oid; do
  case $remote_ref in
    refs/heads/main | refs/tags/v*) ;;
    *) continue ;;
  esac
  if is_zero "$local_oid"; then
    echo "blocked: deleting $remote_ref" >&2; status=1; continue
  fi
  is_zero "$remote_oid" && continue                       # new branch or new tag
  case $remote_ref in
    refs/tags/*)
      [ "$local_oid" = "$remote_oid" ] || { echo "blocked: moving tag ${remote_ref#refs/tags/}" >&2; status=1; } ;;
    *)
      if ! git merge-base --is-ancestor "$remote_oid" "$local_oid" 2>/dev/null; then
        echo "blocked: force push to main (or fetch first: the remote has commits you do not)" >&2; status=1
      fi ;;
  esac
done
exit "$status"
