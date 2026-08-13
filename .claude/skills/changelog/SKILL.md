---
name: changelog
description: Auto-generate or update CHANGELOG.md from merged PRs since the last release tag.
disable-model-invocation: true
argument-hint: "[optional: version label, e.g. v1.2.0]"
allowed-tools: Bash(git *), Bash(gh *), Read, Write, Glob, Grep
---

# Generate changelog

Read merged PRs and commits since the last release tag, extract meaningful
changes, and update CHANGELOG.md.

## Steps

### 1. Determine the range

    git fetch origin dev --tags
    LAST_TAG=$(git describe --tags --abbrev=0 2>/dev/null || echo "")

If `$ARGUMENTS` is provided, use it as the version label. Otherwise, use
"Unreleased".

### 2. Gather changes

**From merged PRs** (preferred, richer descriptions):

    if [ -n "$LAST_TAG" ]; then
      gh pr list --base dev --state merged --search "merged:>=$(git log -1 --format=%aI $LAST_TAG)" --json number,title,body,labels,mergedAt --jq '.[]'
    else
      gh pr list --base dev --state merged --limit 50 --json number,title,body,labels,mergedAt --jq '.[]'
    fi

**From commits** (fallback if no PRs found):

    if [ -n "$LAST_TAG" ]; then
      git log "$LAST_TAG"..origin/dev --oneline
    else
      git log origin/dev --oneline -50
    fi

### 3. Categorize changes

Group changes into these categories based on PR titles, labels, and content:

- **Features**: new functionality (`feat:`, `feature`, `add`)
- **Fixes**: bug fixes (`fix:`, `bug`, `patch`)
- **Improvements**: enhancements, refactors (`improve`, `refactor`, `enhance`)
- **Breaking changes**: anything marked breaking or with major API changes
- **Other**: everything else (chores, docs, deps)

Extract the "What's new" section from PR bodies when available; these are
user-facing descriptions written by the developer.

### 4. Write CHANGELOG.md

If CHANGELOG.md exists, prepend the new section. If not, create it.

Format:

    # Changelog

    ## [v1.2.0] - 2024-03-15

    ### Features
    - Dark mode toggle (#45)
    - User avatars (#44)

    ### Fixes
    - Fix login redirect bug (#43)

    ### Improvements
    - Refactor auth middleware for clarity (#42)

    ## [v1.1.0] - 2024-03-01
    ...

Rules:
- Include PR numbers as `(#N)` references
- Keep descriptions concise (one line each)
- Use the date of the newest merged PR or today's date
- Preserve all existing changelog entries below the new section

### 5. Report

Show the user the generated changelog section and confirm it looks correct
before committing. If they want changes, edit accordingly.
