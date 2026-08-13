#!/usr/bin/env bash
# Give this web session a meaningful feature name. Writes the slug to
# .harness-feature, commits, and pushes so the GitHub Action creates
# feature/<slug> and provisions Railway under that name. Run BEFORE the first
# push. Falls back to the random codename if never called.
set -euo pipefail
RAW="${1:-}"
if [ -z "$RAW" ]; then
  echo "Usage: set-feature-name.sh <slug>   (e.g. fix-login-seed)" >&2
  exit 2
fi
SLUG="$(printf '%s' "$RAW" \
  | tr '[:upper:]' '[:lower:]' \
  | tr ' _' '--' \
  | sed -E 's/[^a-z0-9-]//g; s/-+/-/g; s/^-+//; s/-+$//' \
  | cut -c1-40 \
  | sed -E 's/-+$//')"
if ! printf '%s' "$SLUG" | grep -Eq '^[a-z0-9][a-z0-9-]*$'; then
  echo "Could not derive a valid slug from: $RAW" >&2
  exit 1
fi
case "$SLUG" in
  dev | main | HEAD) echo "Reserved name: $SLUG" >&2; exit 1 ;;
esac
BRANCH="$(git branch --show-current 2>/dev/null || echo "")"
if [[ "$BRANCH" != claude/* ]]; then
  echo "Not on a claude/* session branch (on '$BRANCH'); nothing to do." >&2
  exit 0
fi
if [ -f .harness-feature ] &&
  [ "$(head -n1 .harness-feature | tr -d '[:space:]')" = "$SLUG" ]; then
  echo "Feature name already set to: $SLUG"
  exit 0
fi
git config user.name "claude-code[bot]" 2>/dev/null || true
git config user.email "claude-code[bot]@users.noreply.github.com" 2>/dev/null || true
printf '%s\n' "$SLUG" > .harness-feature
git add .harness-feature
git commit -q -m "chore: set feature name ($SLUG)"
if git push -u origin "$BRANCH" 2>&1; then
  echo "Feature name set: $SLUG  ->  feature/$SLUG (Railway environment provisioning)"
else
  (
    for delay in 2 4 8; do
      sleep "$delay"
      git push -u origin "$BRANCH" 2>/dev/null && exit 0
    done
  ) &>/dev/null &
  disown 2>/dev/null || true
  echo "Feature name set: $SLUG (push retrying in background)"
fi
