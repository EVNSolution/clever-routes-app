#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat >&2 <<'USAGE'
Usage:
  scripts/apply-github-rulesets.sh [OWNER/REPO]

Applies the standard CLEVER GitHub branch rulesets to a target repo.

Policy:
  repository visibility: public required for GitHub Free organizations.
  main: PR-only updates, no required approving reviewers.
  dev: PR-only updates, no required approving reviewers.
  all other branches: no GitHub ruleset from this script.

Requires:
  - gh CLI authenticated for the target repo
  - GitHub repository Administration write permission
USAGE
}

if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
  usage
  exit 0
fi

if ! command -v gh >/dev/null 2>&1; then
  echo "gh CLI is required. Install and authenticate gh before applying rulesets." >&2
  exit 1
fi

repo_full_name="${1:-}"
if [ -z "$repo_full_name" ]; then
  repo_full_name="$(gh repo view --json nameWithOwner --jq .nameWithOwner)"
fi

case "$repo_full_name" in
  */*) ;;
  *)
    usage
    echo "Invalid repository name: $repo_full_name" >&2
    exit 2
    ;;
esac

owner="${repo_full_name%%/*}"
repo="${repo_full_name#*/}"
repo_api="repos/${owner}/${repo}"

gh auth status >/dev/null

visibility="$(gh repo view "$repo_full_name" --json visibility --jq .visibility)"
if [ "$visibility" != "PUBLIC" ]; then
  echo "GitHub Free organization rulesets require a public repository." >&2
  echo "Current visibility for ${repo_full_name}: ${visibility}" >&2
  echo "Make the repository public or upgrade the organization account before applying CLEVER rulesets." >&2
  exit 3
fi

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

ruleset_id() {
  local name="$1"
  gh api "${repo_api}/rulesets?targets=branch" \
    --jq ".[] | select(.source_type == \"Repository\" and .name == \"${name}\") | .id" |
    head -n 1
}

upsert_ruleset() {
  local name="$1"
  local payload="$2"
  local id

  id="$(ruleset_id "$name")"
  if [ -n "$id" ]; then
    gh api --method PUT "${repo_api}/rulesets/${id}" --input "$payload" >/dev/null
    echo "updated ruleset: ${name}"
  else
    gh api --method POST "${repo_api}/rulesets" --input "$payload" >/dev/null
    echo "created ruleset: ${name}"
  fi
}

main_payload="${tmp_dir}/main-ruleset.json"
dev_payload="${tmp_dir}/dev-ruleset.json"

cat > "$main_payload" <<'JSON'
{"name":"CLEVER protect main","target":"branch","enforcement":"active","conditions":{"ref_name":{"include":["refs/heads/main"],"exclude":[]}},"rules":[{"type":"pull_request","parameters":{"allowed_merge_methods":["merge","squash","rebase"],"dismiss_stale_reviews_on_push":true,"require_code_owner_review":false,"require_last_push_approval":false,"required_approving_review_count":0,"required_review_thread_resolution":false}},{"type":"deletion"},{"type":"non_fast_forward"}]}
JSON

cat > "$dev_payload" <<'JSON'
{"name":"CLEVER protect dev","target":"branch","enforcement":"active","conditions":{"ref_name":{"include":["refs/heads/dev"],"exclude":[]}},"rules":[{"type":"pull_request","parameters":{"allowed_merge_methods":["merge","squash","rebase"],"dismiss_stale_reviews_on_push":true,"require_code_owner_review":false,"require_last_push_approval":false,"required_approving_review_count":0,"required_review_thread_resolution":false}},{"type":"deletion"},{"type":"non_fast_forward"}]}
JSON

upsert_ruleset "CLEVER protect main" "$main_payload"
upsert_ruleset "CLEVER protect dev" "$dev_payload"

echo "CLEVER GitHub rulesets applied to ${repo_full_name}."
