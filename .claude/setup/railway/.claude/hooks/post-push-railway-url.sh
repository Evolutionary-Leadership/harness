#!/usr/bin/env bash
set -euo pipefail

# PostToolUse hook: runs after `git push` on claude/ branches.
# Shows the Railway preview URL when one has been published.
# Stdout from PostToolUse hooks is added to Claude's context.
#
# A hook never sleeps. This one makes exactly one fetch through
# get-railway-url.sh (without --wait) and reports what it found; polling
# is a script the session runs on purpose:
#   bash .claude/scripts/get-railway-url.sh --wait

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

# Only act on pushes to claude/ branches
if ! echo "$COMMAND" | grep -q 'git push'; then
  exit 0
fi

BRANCH=$(git branch --show-current 2>/dev/null || echo "")
if [[ ! "$BRANCH" == claude/* ]]; then
  exit 0
fi

# Resolve the feature branch name: prefer the slug in .harness-feature, else
# fall back to the random session codename. Shared resolver keeps this in
# agreement with the workflows and get-railway-url.sh.
SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)
FEATURE_NAME=$(bash "$SCRIPT_DIR/../scripts/resolve-feature-name.sh" "$BRANCH")
FEATURE_BRANCH="feature/$FEATURE_NAME"

# Previews are opt-in: line 2 of .harness-feature reads `preview: yes` when
# feature-branch-railway.yml is meant to provision one (set-feature-name.sh
# --preview=yes writes it; /review flips it). Anything else means no
# environment is coming, so a miss below is not worth a line of context.
PREVIEW=no
if [[ -f .harness-feature ]] &&
  [[ "$(sed -n 2p .harness-feature | tr -d '[:space:]')" == "preview:yes" ]]; then
  PREVIEW=yes
fi

# One fetch, no --wait. The helper owns the fetch and the poll, so a session
# that wants to block re-queries with the same script and its --wait flag.
URL=$(bash "$SCRIPT_DIR/../scripts/get-railway-url.sh" "$FEATURE_BRANCH" 2>/dev/null || true)

if [[ -z "$URL" ]]; then
  if [[ "$PREVIEW" != yes ]]; then
    exit 0
  fi
  echo ""
  echo "Railway preview URL not yet available. The GitHub Action may still be provisioning."
  echo "Re-query later with: bash .claude/scripts/get-railway-url.sh --wait"
  exit 0
fi

echo ""
echo "=========================================="
echo "  Railway preview: $URL"
echo "  Railway redeploys the preview on every push to $FEATURE_BRANCH."
echo "=========================================="
exit 0
