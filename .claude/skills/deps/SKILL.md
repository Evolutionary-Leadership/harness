---
name: deps
description: Review and handle Dependabot PRs. Group by risk, batch-merge safe patches, flag breaking changes.
disable-model-invocation: true
allowed-tools: Bash(git *), Bash(gh *), Read, Glob, Grep
---

# Handle dependency updates

Review open Dependabot PRs, assess risk levels, batch-merge safe patches, and
flag breaking changes for human review.

## Steps

### 1. List open dependency PRs

    gh pr list --state open --author "app/dependabot" --json number,title,body,labels,createdAt --jq '.[]'

If no Dependabot PRs are open, inform the user and exit.

### 2. Categorize by risk level

Group each PR into one of these categories:

**Safe to merge (patch updates):**
- Patch version bumps (e.g., 1.2.3 → 1.2.4)
- Dev dependency updates (test frameworks, linters, build tools)
- Security patches

**Review recommended (minor updates):**
- Minor version bumps (e.g., 1.2.0 → 1.3.0)
- Runtime dependencies with new features

**Manual review required (breaking changes):**
- Major version bumps (e.g., 1.x → 2.x)
- Dependencies with known breaking changes noted in PR body
- Core framework updates (React, Next.js, Express, etc.)

### 3. Present the assessment

Show a grouped summary:

    DEPENDENCY UPDATE REPORT
    ========================

    Safe to merge (3 patches):
      PR #50: Bump eslint from 8.56.0 to 8.56.1
      PR #51: Bump @types/node from 20.11.0 to 20.11.1
      PR #52: Bump vitest from 1.2.0 to 1.2.1

    Review recommended (1 minor):
      PR #53: Bump express from 4.18 to 4.19, new features, check changelog

    Manual review required (1 major):
      PR #54: Bump next from 14.x to 15.x, BREAKING: App Router changes

### 4. Offer actions

Ask the user what they'd like to do:
- **Merge all safe patches**: batch merge all patch-level updates
- **Merge specific PRs**: user picks which ones
- **Skip**: do nothing, just report

### 5. Execute merges (if requested)

For each PR the user approves:

    gh pr merge <number> --merge

Report results:

    Merged: PR #50, #51, #52
    Failed: PR #53 (merge conflict, needs manual resolution)
    Skipped: PR #54 (major update, needs manual review)
