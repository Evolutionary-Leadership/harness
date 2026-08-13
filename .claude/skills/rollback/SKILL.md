---
name: rollback
description: Revert production to the previous release tag and create a tracking issue.
disable-model-invocation: true
argument-hint: "[optional: tag to revert to, e.g. v1.2.3]"
allowed-tools: Bash(git *), Bash(gh *), Read, Write, Glob, Grep
---

# Rollback production

Revert `main` to a previous release tag when the current production deploy is
broken. Creates a tracking issue for the incident.

## Steps

### 1. Identify the target version

    git fetch origin main --tags

List recent tags:

    git tag --sort=-version:refname | head -10

If `$ARGUMENTS` is provided, use it as the target tag. Otherwise, default to
the second-most-recent tag (the one before the current release):

    CURRENT_TAG=$(git describe --tags --abbrev=0 origin/main)
    PREVIOUS_TAG=$(git tag --sort=-version:refname | sed -n '2p')

Confirm with the user: "Roll back from $CURRENT_TAG to $PREVIOUS_TAG?"

### 2. Create revert

    git checkout main
    git pull origin main
    git revert --no-commit "$PREVIOUS_TAG"..HEAD
    git commit -m "revert: rollback to $PREVIOUS_TAG"
    git push origin main

This reverts all commits between the target tag and HEAD on main, keeping
full git history (no force push).

### 3. Create tracking issue

    gh issue create \
      --title "Rollback: $CURRENT_TAG → $PREVIOUS_TAG" \
      --body "## Rollback Summary

    **From:** $CURRENT_TAG
    **To:** $PREVIOUS_TAG
    **Date:** $(date -u +%Y-%m-%dT%H:%M:%SZ)
    **Trigger:** [describe what went wrong]

    ## Reverted changes
    $(git log $PREVIOUS_TAG..$CURRENT_TAG --oneline)

    ## Action items
    - [ ] Investigate root cause
    - [ ] Fix the issue on dev
    - [ ] Re-release with fix
    "

### 4. Inform the user

Tell the user:
- Production has been rolled back to `$PREVIOUS_TAG`
- A tracking issue has been created
- The revert commit is on `main`, so no history was lost
- Next steps: investigate the issue, fix it on dev, then do a new release
- If using Railway: production will redeploy automatically from the updated main
