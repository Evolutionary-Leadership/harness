#!/usr/bin/env bash
# Echo the feature name for the current claude/* session.
# Prefer the explicit slug in .harness-feature (set via set-feature-name.sh),
# otherwise fall back to the random session codename. Keeps the shell consumers
# in agreement with the GitHub workflows.
# Only line 1 of .harness-feature is the slug. Line 2, when present, is the
# preview marker (`preview: yes|no`) that only feature-branch-railway.yml
# reads; this resolver and every other reader take `head -n1`.
# Usage: resolve-feature-name.sh [<branch>]
set -euo pipefail
BRANCH="${1:-$(git branch --show-current 2>/dev/null || echo "")}"
WITHOUT_PREFIX="${BRANCH#claude/}"
CODENAME="${WITHOUT_PREFIX%-*}"
SLUG=""
if [ -f .harness-feature ]; then
  SLUG="$(head -n1 .harness-feature | tr -d '[:space:]')"
fi
if printf '%s' "$SLUG" | grep -Eq '^[a-z0-9][a-z0-9-]{0,40}$' &&
  [ "$SLUG" != preprod ] && [ "$SLUG" != dev ] && [ "$SLUG" != main ]; then
  echo "$SLUG"
else
  echo "$CODENAME"
fi
