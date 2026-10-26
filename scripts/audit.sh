#!/usr/bin/env bash
# The dependency audit (SECURITY_STANDARD_2026 §9): a gate before every release, run by `pnpm release:check`, and weekly by
# .github/workflows/audit.yml for new advisories in what is already out.
#
# The documented exceptions in pnpm-workspace.yaml (auditConfig.ignoreGhsas) are not a silent switch-off: they carry a review
# date, and this fails when it has passed.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

review_by="$(sed -n 's/^# audit-exceptions-review-by: *//p' pnpm-workspace.yaml)"
if ! printf '%s' "${review_by}" | grep -Eq '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'; then
  echo "::error::pnpm-workspace.yaml has no '# audit-exceptions-review-by: YYYY-MM-DD' line" >&2
  exit 1
fi
today="$(date -u +%F)"
if [ "${today}" \> "${review_by}" ]; then
  echo "::error::The audit exceptions in pnpm-workspace.yaml were due for review on ${review_by}. Run 'pnpm audit --prod' and update them." >&2
  exit 1
fi
echo "Audit exceptions are due for review on ${review_by}."

pnpm audit --prod --audit-level high
