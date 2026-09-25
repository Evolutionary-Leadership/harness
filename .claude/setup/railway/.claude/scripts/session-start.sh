#!/usr/bin/env bash
set -euo pipefail

# Resume previous work on session start.
# Feature provisioning now happens on Claude's FIRST push: either the slug
# commit from .claude/scripts/set-feature-name.sh (preferred) or any first
# code push (falls back to the random codename). So this hook no longer
# pushes an init commit. It only resumes work when a feature branch already
# exists for this session's resolved name.
SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)

# A git identity, once, for the repository only. A sandbox that can name
# nobody would otherwise refuse the first commit of every skill that commits;
# set-feature-name.sh's per-command fallback stays as the backstop. A session
# that already has an identity (local Claude Code, a person's own config) is
# left exactly as it is, and nothing here is ever written globally.
if [ -z "$(git config user.email 2>/dev/null || true)" ]; then
  git config user.name "Claude" 2>/dev/null || true
  git config user.email "noreply@anthropic.com" 2>/dev/null || true
fi

BRANCH=$(git branch --show-current 2>/dev/null || echo "")
if [[ "$BRANCH" == claude/* ]]; then
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

# One ping when a cockpit is configured, so the cockpit hears the session
# before any seam reports, and the one refusal that means "no product knows
# this repository" is read here rather than at the tenth report. No key: none
# is minted yet. A repository that derives nothing gets the client's own line.
if bash "$SCRIPT_DIR/cockpit.sh" configured; then
  PING=$(bash "$SCRIPT_DIR/cockpit.sh" ping 2>&1 || true)
  case "$PING" in
    *"(404)"*)
      REPO=$(git remote get-url origin 2>/dev/null | sed -E 's#/*$##; s#\.git$##; s#^.*[:/]([^/:]+/[^/]+)$#\1#' || true)
      echo "cockpit: no product is configured against ${REPO:-this repository} (404); reports will not be recorded until it is linked in the cockpit"
      ;;
    "") ;;
    *) echo "$PING" ;;
  esac
fi

cat <<'HARNESS'
<EXTREMELY_IMPORTANT>
RIGHT NOW, go read: .claude/skills/getting-started/SKILL.md
It holds the closing block every reply ends with (Step 3b), the stand-down
block (Step 3c) and the rule that skills are mandatory (Step 3).
Session flavour: /chat (talk), /brainstorm (think) or /feature (build).
</EXTREMELY_IMPORTANT>
HARNESS
