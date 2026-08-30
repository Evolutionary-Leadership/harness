---
name: hotfix
description: Emergency production fix. Branch from main, fix, PR to main, auto-tag patch release, back-merge to preprod.
disable-model-invocation: true
argument-hint: "<description of the fix needed>"
allowed-tools: Bash(git *), Bash(gh *), Bash(node scripts/check-docs.mjs*), Bash(python3 scripts/check-docs.py*), Read, Write, Edit, Glob, Grep
---

# Hotfix: emergency production fix

Create a hotfix branch from `main`, apply the fix, and trigger a fast-track
release directly to production. Bypasses the normal feature → preprod → release flow.

## Steps

### 1. Create hotfix branch

    git fetch origin main
    git checkout -b hotfix/<name> origin/main

Derive `<name>` from `$ARGUMENTS`. Slugify it (lowercase, hyphens, no spaces).

### 2. Apply the fix

Do the work the user described. Keep changes minimal; a hotfix should fix the
specific issue and nothing else.

### 3. Docs, fast path

A hotfix skips the full docs audit on purpose: `/to-preprod` and `/review` run
the docs-updater agent, but an outage is not the moment for a taxonomy sweep.
Do only what is cheap and what would otherwise be lost:

1. If `scripts/check-docs.mjs` exists, run it. It takes about a second and
   catches a link or reference the fix just broke:

       node scripts/check-docs.mjs

2. If the fix touches auth, secrets, limits, or input validation, update
   `docs/SECURITY.md` now. That table is the one an agent trusts under
   pressure, and a hotfix is exactly when it gets stale.

3. If the fix changes a documented surface (a route, a tool, an env var),
   update its row. One row, not a rewrite.

Everything else is a follow-up, and follow-ups get written down or they do
not happen. Add these to the PR body as a checklist:

- the runbook for the procedure you just improvised (`docs/runbooks/`)
- the ADR, if the fix encodes a tradeoff worth keeping
  (`/document adr "<title>"`)
- the regression test, and its row in `docs/SECURITY.md` if it asserts a
  security property

### 4. Determine next patch version

    LAST_TAG=$(git describe --tags --abbrev=0 origin/main 2>/dev/null || echo "v0.0.0")
    # Bump patch: v1.2.3 → v1.2.4

### 5. Write `.pr-description.md`

Create the signal file with `hotfix: true` in frontmatter:

    ---
    title: "Hotfix: <description>"
    hotfix: true
    version: v1.2.4
    ---

    ## Hotfix: <description>

    ### Problem
    - What broke in production

    ### Fix
    - What this hotfix changes

    ### Risk assessment
    - Impact and scope of the change

### 6. Commit and push

    git add -A
    git commit -m "hotfix: <description>"
    git push -u origin hotfix/<name>

### 7. Inform the user

Tell the user:
- The hotfix workflow will create a PR from `hotfix/<name>` → `main`
- After merge, version `$NEW_VERSION` will be tagged automatically
- A GitHub Release will be created marked as a hotfix
- `main` will be back-merged into `preprod` to prevent drift
- Production will be updated immediately
