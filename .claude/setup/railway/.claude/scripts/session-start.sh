#!/usr/bin/env bash
set -euo pipefail

# Resume previous work on session start.
# Feature provisioning now happens on Claude's FIRST push: either the slug
# commit from .claude/scripts/set-feature-name.sh (preferred) or any first
# code push (falls back to the random codename). So this hook no longer
# pushes an init commit. It only resumes work when a feature branch already
# exists for this session's resolved name.
BRANCH=$(git branch --show-current 2>/dev/null || echo "")
if [[ "$BRANCH" == claude/* ]]; then
  SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)
  FEATURE_NAME=$(bash "$SCRIPT_DIR/resolve-feature-name.sh" "$BRANCH")
  FEATURE_BRANCH="feature/$FEATURE_NAME"

  if git fetch origin "$FEATURE_BRANCH" 2>/dev/null; then
    # Feature branch exists: merge previous work
    if git merge "origin/$FEATURE_BRANCH" --no-edit 2>/dev/null; then
      echo "Merged $FEATURE_BRANCH into local branch. Previous feature work is available."
    else
      git merge --abort 2>/dev/null || true
      echo "Warning: Could not auto-merge $FEATURE_BRANCH. You may need to merge manually."
    fi

    # Show Railway preview URL if environment already exists
    RAILWAY_URL=$(git show "origin/$FEATURE_BRANCH:.railway-url" 2>/dev/null || echo "")
    if [[ -n "$RAILWAY_URL" ]]; then
      echo ""
      echo "=========================================="
      echo "  Railway preview: $RAILWAY_URL"
      echo "=========================================="
    fi
  else
    # No feature branch yet: fresh session. Do NOT push here.
    # Provisioning happens on the first push (see getting-started Step 0).
    echo "Fresh session on $BRANCH (no feature branch yet)."
    echo "Name this feature before your first push so the branch and Railway"
    echo "environment are created with a meaningful name:"
    echo "  bash .claude/scripts/set-feature-name.sh <slug>"
    echo "If you skip it, the first push falls back to the random codename"
    echo "($FEATURE_NAME). Skip naming entirely for read-only or question-only"
    echo "sessions."
  fi
fi

# Unconfigured-template nag. /setup deletes itself on success, so its
# presence IS the unconfigured state. No flag files. The technical
# foundation, when chosen, is materialized by /setup itself, so there is
# no staged-but-unbuilt state to nag about.
if [ -d .claude/skills/setup ]; then
  cat <<'SETUP'
==========================================================
  UNCONFIGURED TEMPLATE: run /setup before anything else.
  It picks the variant (Railway or code-only), pushes one
  commit, and deletes itself. Until then, nothing else in
  this repository is ready to use.
==========================================================
SETUP
fi

cat <<'HARNESS'
<EXTREMELY_IMPORTANT>
You have Superpowers.
**RIGHT NOW, go read**: .claude/skills/getting-started/SKILL.md
</EXTREMELY_IMPORTANT>
HARNESS
