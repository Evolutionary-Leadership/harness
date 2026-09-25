#!/usr/bin/env bash
set -euo pipefail

# Fetch the Railway preview URL committed to the matching feature
# branch by feature-branch-railway.yml.
#
# Usage:
#   .claude/scripts/get-railway-url.sh                  # derive from current claude/ branch
#   .claude/scripts/get-railway-url.sh feature/foo      # explicit feature branch
#   .claude/scripts/get-railway-url.sh --wait           # poll until the URL lands
#
# The default is ONE fetch: print the URL if .railway-url exists on the
# fetched branch, say so on stderr if it does not, and return. That is
# the shape the post-push hook needs, because a hook never sleeps: it
# runs inside the session's tool call and every second it waits is a
# second the session is blocked for a preview nobody may open. Polling
# is a thing the session does on purpose, with --wait, which keeps the
# 80-second ladder for the explicit call on the /review path.
#
# Output:
#   stdout: the URL on success, nothing on miss.
#   stderr: human-readable progress and miss diagnostics.
# Exit code:
#   0 always (so PostToolUse hooks never fail Claude's tool calls).

WAIT=false
FEATURE_BRANCH=""
for ARG in "$@"; do
  case "$ARG" in
    --wait) WAIT=true ;;
    *) FEATURE_BRANCH="$ARG" ;;
  esac
done

if [[ -z "$FEATURE_BRANCH" ]]; then
  BRANCH=$(git branch --show-current 2>/dev/null || echo "")
  if [[ ! "$BRANCH" == claude/* ]]; then
    echo "Not on a claude/ branch and no feature branch argument given." >&2
    echo "Usage: $0 [feature/<name>] [--wait]" >&2
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

# One fetch. Without --wait this is the whole script.
URL=$(read_url || echo "")
if [[ -n "$URL" ]]; then
  echo "$URL"
  exit 0
fi

if [[ "$WAIT" != true ]]; then
  echo "Railway preview URL not yet available on $FEATURE_BRANCH." >&2
  echo "The GitHub Action may still be provisioning. Re-run this script later, or poll:" >&2
  echo "  bash .claude/scripts/get-railway-url.sh --wait" >&2
  exit 0
fi

# --wait only: the sleep ladder. 80 seconds in total, which covers the
# environmentCreate fork plus the URL publish on a normal run.
echo "Waiting for Railway preview URL on $FEATURE_BRANCH..." >&2
WAITS=(5 5 10 10 15 15 20)
for SLEEP_FOR in "${WAITS[@]}"; do
  sleep "$SLEEP_FOR"
  URL=$(read_url || echo "")
  if [[ -n "$URL" ]]; then
    echo "$URL"
    exit 0
  fi
done

echo "" >&2
echo "Railway preview URL not yet available on $FEATURE_BRANCH." >&2
echo "The GitHub Action may still be provisioning. Re-run this script later:" >&2
echo "  bash .claude/scripts/get-railway-url.sh --wait" >&2
exit 0
