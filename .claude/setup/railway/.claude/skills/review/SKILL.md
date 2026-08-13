---
name: review
description: Submit a PR for team review (without auto-merge). Use when the user says "submit for review", "create a PR", or invokes /review.
disable-model-invocation: true
argument-hint: "[optional: PR title]"
allowed-tools: Bash(git *), Read, Write, Glob, Grep
---

# Submit for review

Create a PR from the current feature branch to dev for team review. Unlike
`/mergedev`, this does NOT auto-merge; the PR stays open for human review.

Uses the same `.pr-description.md` signal file pattern as `/mergedev`, but
with `review: true` in frontmatter so the workflow skips auto-merge.

This is the harness's *process* review: it requests humans. The *code*
review is `/code-review`, which has normally already run at the end of
`/feature` phase 4; its findings go into the PR body below so reviewers
start from them.

## Steps

### 1. Determine the feature name

    BRANCH=$(git branch --show-current)
    FEATURE_NAME=$(bash .claude/scripts/resolve-feature-name.sh "$BRANCH")
    FEATURE_BRANCH="feature/$FEATURE_NAME"

This prefers the slug in `.harness-feature` (set via `set-feature-name.sh`)
and falls back to the random session codename, matching the workflows.

### 2. Gather all changes

Fetch and diff against dev to understand what's being submitted:

    git fetch origin dev
    git log origin/dev..HEAD --oneline
    git diff origin/dev..HEAD --stat

Also check if a `feature/<name>` branch exists and include its commits:

    git fetch origin feature/<name> 2>/dev/null
    git log origin/dev..origin/feature/<name> --oneline 2>/dev/null

Review ALL changes (not just the latest commit) to write an accurate PR
description.

### 3. Run the docs audit

A PR opened for human review gets the same documentation audit as an
auto-merged one. A reviewer reading stale docs is exactly as misled as an
agent reading them, and review is where a missing ADR is cheapest to catch.

Launch the docs-updater agent with the Agent tool:

    Launch the docs-updater agent with prompt:
    "Delta audit for a PR being opened for review. Base is origin/dev.
     Read docs/README.md as the manifest and route every finding through it.
     Enforce architecture `sources:` globs against the changed paths, verify
     surface-table counts, treat docs/decisions/ as append-only, and flag any
     doc over its budget instead of adding prose. Run
     scripts/check-docs.mjs if it exists."

Wait for it to finish. If it committed documentation changes, they ship with
the PR. Fold its report into the PR description:

- put anything under "Needs you" (a suggested ADR, an over-budget doc, a
  conflict it could not resolve) into the PR body under a **Docs** heading,
  so the reviewer sees it rather than discovering it after merge
- if the checker reported errors, fix them before creating the PR

### 4. Write `.pr-description.md`

Create `.pr-description.md` at the repo root. If `$ARGUMENTS` is provided, use
it as the PR title. Otherwise, generate a concise title from the changes.

Also include the Railway preview URL in the PR body so reviewers can test
(using `$FEATURE_BRANCH` resolved in step 1):

    PREVIEW_URL=$(git show "origin/$FEATURE_BRANCH:.railway-url" 2>/dev/null || echo "")

**Important:** Include `review: true` in the frontmatter to prevent auto-merge.

Optionally read the `reviewers:` field from `.harness-version` and include it.

Format:

    ---
    title: Short PR title (under 70 characters)
    review: true
    reviewers: teammate1, teammate2
    ---

    **Preview:** https://feature-dark-mode-production.up.railway.app

    ## Summary
    - 3-5 bullet points explaining what changed and why

    ## Spec
    - Link to the spec issue on the tracker (the issue whose title carries
      the feature slug), so reviewers can check the diff against what was
      agreed. Omit only if the feature has no spec issue.

    ## Code review findings
    - The findings summary from the /code-review run at the end of phase 4
      (per axis: Standards and Spec), including anything deliberately not
      addressed and why. If /code-review has not run, run it now (fixed
      point: origin/dev) rather than omitting the section.

    ## What's new
    - User-facing changes described in plain language

    ## Technical changes
    - Key implementation details, files changed, architectural decisions

    ## How to test
    - Steps to verify the feature works correctly
    - Include the Railway preview URL for live testing

### 5. Update the feature context

Mark the feature context (`.harness/feature-context/<slug>.md`, contract
in `.claude/HARNESS.md`) "awaiting human review", with the PR reference
and what a follow-up session should do when review comments arrive. Keep
the file: the review window is exactly when a colleague may `/continue`
this feature to address comments.

### 6. Commit and push

    git add .pr-description.md .harness/feature-context/
    git commit -m "chore: submit for review"
    git push -u origin <current-branch>

### 7. Inform the user

Tell the user:

- A PR has been created from `feature/<name>` to `dev` for review
- The PR will NOT be auto-merged; it requires human approval
- If reviewers were configured, they have been assigned
- The Railway preview environment stays active for reviewers to test
- Share the PR URL once the workflow creates it (it will appear in the
  GitHub Actions run)
- **When the review is approved, land it with `/mergedev`**, not the
  GitHub merge button: `/mergedev` reuses the open PR, refreshes it, and
  cleans up the feature context. (If someone does click the button, the
  cleanup workflow removes the leftover context from dev.)
- The feature context carries the state; a colleague can pick this up
  any time with `/continue`
