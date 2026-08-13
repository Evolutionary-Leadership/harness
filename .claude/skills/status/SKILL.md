---
name: status
description: Show team dashboard. Active features, pending PRs, unreleased changes, and production status.
disable-model-invocation: true
allowed-tools: Bash(git *), Bash(gh *), Read, Glob, Grep
---

# Team status dashboard

Show a concise overview of the team's current state: what's in flight, what's
pending review, and what's deployed.

## Steps

### 1. Fetch latest state

    git fetch origin --prune

### 2. Gather data

Run these commands and collect the output:

**Active feature branches:**

    git branch -r | grep 'origin/feature/' | sed 's|origin/||'

For each feature branch, check if there's an open PR:

    gh pr list --base dev --state open --json number,title,headRefName,reviews,statusCheckRollup --jq '.[]'

**Latest release:**

    git describe --tags --abbrev=0 2>/dev/null || echo "No releases yet"

**Unreleased changes on dev** (commits since last tag):

    LAST_TAG=$(git describe --tags --abbrev=0 2>/dev/null || echo "")
    if [ -n "$LAST_TAG" ]; then
      git log "$LAST_TAG"..origin/dev --oneline
    else
      git log origin/dev --oneline -20
    fi

### 3. Format the dashboard

Present the data as a concise, scannable dashboard:

    TEAM STATUS
    ===========

    Active features:
      feature/dark-mode      PR #45 (open, 2 approvals, checks passing)
      feature/api-caching    in progress (no PR yet)

    Pending review:
      PR #45: Add dark mode toggle (feature/dark-mode -> dev)

    Unreleased on dev (since v1.1.0):
      - abc1234 Fix login redirect (#43)
      - def5678 Add user avatars (#44)

    Production: v1.1.0 (tagged 2024-03-15)

If there are no feature branches, PRs, or tags, say so clearly. Don't show
empty sections; skip them.

### 4. Highlight action items

If anything needs attention, call it out:
- PRs with failing checks
- PRs with no reviewers assigned
- Feature branches with no activity for 7+ days
- Large number of unreleased changes on dev (suggest a release)
