#!/usr/bin/env bash
set -euo pipefail

# Fetch the Railway preview URL committed to the matching feature
# branch by feature-branch-railway.yml. Polls if not yet present.
#
# Usage:
#   .claude/scripts/get-railway-url.sh                  # derive from current claude/ branch
#   .claude/scripts/get-railway-url.sh feature/foo      # explicit feature branch
#
# Output:
#   stdout: the URL on success, nothing on miss.
#   stderr: human-readable progress and miss diagnostics.
# Exit code:
#   0 always (so PostToolUse hooks never fail Claude's tool calls).

FEATURE_BRANCH="${1:-}"

if [[ -z "$FEATURE_BRANCH" ]]; then
  BRANCH=$(git branch --show-current 2>/dev/null || echo "")
  if [[ ! "$BRANCH" == claude/* ]]; then
    echo "Not on a claude/ branch and no feature branch argument given." >&2
    echo "Usage: $0 [feature/<name>]" >&2
    exit 0
  fi
  SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)
  FEATURE_NAME=$(bash "$SCRIPT_DIR/resolve-feature-name.sh" "$BRANCH")
  FEATURE_BRANCH="feature/$FEATURE_NAME"
fi

read_url() {
  git fetch origin "$FEATURE_BRANCH" 2>/dev/null || return 1
  git show "origin/$FEATURE_BRANCH:.railway-url" 2>/dev/null || return 1
}

# Fast path: try once before announcing a wait.
URL=$(read_url || echo "")
if [[ -n "$URL" ]]; then
  echo "$URL"
  exit 0
fi

echo "Waiting for Railway preview URL on $FEATURE_BRANCH..." >&2
WAITS=(5 5 10 10 15 15 20)
for WAIT in "${WAITS[@]}"; do
  sleep "$WAIT"
  URL=$(read_url || echo "")
  if [[ -n "$URL" ]]; then
    echo "$URL"
    exit 0
  fi
done

echo "" >&2
echo "Railway preview URL not yet available on $FEATURE_BRANCH." >&2
echo "The GitHub Action may still be provisioning. Re-run this script later:" >&2
echo "  bash .claude/scripts/get-railway-url.sh" >&2
exit 0
