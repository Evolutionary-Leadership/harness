#!/usr/bin/env bash
set -euo pipefail

# PostToolUse hook: runs after `git push` on claude/ branches.
# Shows Railway preview URL and waits for deployment to complete.
# Stdout from PostToolUse hooks is added to Claude's context.

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

# Delegate the fetch/poll/read to the on-demand helper. Keeping all
# polling logic in one place means the user can re-query later with
# the same script when provisioning runs longer than this hook's budget.
URL=$(bash "$SCRIPT_DIR/../scripts/get-railway-url.sh" "$FEATURE_BRANCH" 2>/dev/null || true)

if [[ -z "$URL" ]]; then
  echo ""
  echo "Railway preview URL not yet available. The GitHub Action may still be provisioning."
  echo "Re-query later with: bash .claude/scripts/get-railway-url.sh"
  exit 0
fi

echo ""
echo "=========================================="
echo "  Railway preview: $URL"
echo "  Deploying... (typically 30-120s)"
echo "=========================================="
exit 0
