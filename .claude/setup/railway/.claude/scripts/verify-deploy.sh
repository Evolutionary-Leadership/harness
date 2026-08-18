#!/usr/bin/env bash
set -euo pipefail

# Verify that a Railway environment is serving the code that was just
# pushed, not merely answering HTTP.
#
# The app bakes RAILWAY_GIT_COMMIT_SHA into the x-harness-sha response
# header (starter: server.js middleware; foundation: next.config.ts
# headers()). The sha that DEPLOYS is the tip of feature/<name>: the
# GitHub Action merges the claude/ push into the feature branch, so the
# deployed commit is that merge commit, never the local HEAD. This
# script therefore compares the served header against the freshly
# fetched feature-branch tip, re-fetching every attempt in case the
# merge lands mid-poll.
#
# Usage:
#   .claude/scripts/verify-deploy.sh                # feature flow: derive branch, resolve URL
#   .claude/scripts/verify-deploy.sh <url> <sha>    # explicit target (other skills)
#
# Output (stdout, stable lines for the calling skill):
#   deploy-verified: <url> sha=<short>
#   deploy-pending: <url> serving=<short|none>
# Progress goes to stderr. Exit 0 always, so callers never hard-fail.

ATTEMPTS=32   # x 15s = 8 minutes; a first push provisions a whole environment
INTERVAL=15

URL="${1:-}"
EXPECTED="${2:-}"
FEATURE_BRANCH=""

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)

if [[ -z "$URL" ]]; then
  BRANCH=$(git branch --show-current 2>/dev/null || echo "")
  if [[ ! "$BRANCH" == claude/* ]]; then
    echo "Not on a claude/ branch and no URL argument given." >&2
    echo "Usage: $0 [<url> <sha>]" >&2
    exit 0
  fi
  FEATURE_NAME=$(bash "$SCRIPT_DIR/resolve-feature-name.sh" "$BRANCH")
  FEATURE_BRANCH="feature/$FEATURE_NAME"
  URL=$(bash "$SCRIPT_DIR/get-railway-url.sh" "$FEATURE_BRANCH")
  if [[ -z "$URL" ]]; then
    echo "deploy-pending: (no-url) serving=none"
    exit 0
  fi
fi

expected_sha() {
  if [[ -n "$EXPECTED" ]]; then
    echo "$EXPECTED"
    return
  fi
  git fetch -q origin "$FEATURE_BRANCH" 2>/dev/null || true
  git rev-parse "origin/$FEATURE_BRANCH" 2>/dev/null || echo ""
}

# Prefix-tolerant compare: either side may be the short form.
sha_match() {
  local a="$1" b="$2"
  [[ -n "$a" && -n "$b" ]] || return 1
  [[ "$a" == "$b"* || "$b" == "$a"* ]]
}

SEEN="none"
for i in $(seq 1 "$ATTEMPTS"); do
  WANT=$(expected_sha)
  HDRS=$(curl -sfI --max-time 10 "$URL" 2>/dev/null || true)
  if [[ -n "$HDRS" ]] && echo "$HDRS" | grep -qi '^x-harness: live'; then
    GOT=$(echo "$HDRS" | grep -i '^x-harness-sha:' | awk '{print $2}' | tr -d '\r' || true)
    [[ -n "$GOT" ]] && SEEN="$GOT"
    if sha_match "$GOT" "$WANT"; then
      echo "deploy-verified: $URL sha=${GOT:0:7}"
      exit 0
    fi
  fi
  if (( i % 4 == 0 )); then
    echo "Still waiting for the deploy ($(( i * INTERVAL ))s elapsed; serving: ${SEEN:0:7})..." >&2
  fi
  if (( i < ATTEMPTS )); then sleep "$INTERVAL"; fi
done

echo "deploy-pending: $URL serving=${SEEN:0:7}"
exit 0
