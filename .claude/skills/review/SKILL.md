---
name: review
description: Submit a PR for team review (without auto-merge). Use when the user says "submit for review", "create a PR", or invokes /review.
argument-hint: "[optional: PR title]"
allowed-tools: Bash(git *), Bash(bash .claude/scripts/set-feature-name.sh *), Bash(node scripts/check-docs.mjs*), Read, Write, Glob, Grep
---

# Submit for review

Create a PR from the current feature branch to preprod for team review. Unlike
`/to-preprod`, this does NOT auto-merge; the PR stays open for human review.

Uses the same `.pr-description.md` signal file pattern as `/to-preprod`, but
with `review: true` in frontmatter so the workflow skips auto-merge.

This is the harness's *process* review: it requests humans. The *code*
review is `/code-review`, which has normally already run at the end of
`/feature` phase 4; its findings go into the PR body below so reviewers
start from them.

## Authority

**A session may complete this skill alone, and should.** It opens a pull
request and merges nothing: the PR waits for the humans it assigns, and an
approved one lands later through `/to-preprod`. Asking for review is the one
act in the flow whose whole purpose is to put a person in the loop, so it needs
no grant in `.harness-version` and checks for none.

If you have reached this skill legitimately, finish it; do not stop to ask a
person to open the PR for you (the forge decision record on granting exit
authority in configuration).

## Steps

### 1. Determine the feature name

    BRANCH=$(git branch --show-current)
    FEATURE_NAME=$(bash .claude/scripts/resolve-feature-name.sh "$BRANCH")
    FEATURE_BRANCH="feature/$FEATURE_NAME"

This prefers the slug in `.harness-feature` (set via `set-feature-name.sh`)
and falls back to the random session codename, matching the workflows.

### 2. Gather all changes

Fetch and diff against preprod to understand what's being submitted:

    git fetch origin preprod
    git log origin/preprod..HEAD --oneline
    git diff origin/preprod..HEAD --stat

Also check if a `feature/<name>` branch exists and include its commits:

    git fetch origin feature/<name> 2>/dev/null
    git log origin/preprod..origin/feature/<name> --oneline 2>/dev/null

Review ALL changes (not just the latest commit) to write an accurate PR
description.

### 3. Run the docs audit

A PR opened for human review gets the same documentation audit as an
auto-merged one: a reviewer reading stale docs is exactly as misled as an
agent reading them. The audit runs once per diff, so read the feature context
(`.harness/feature-context/<slug>.md`) first:

- **It has a `## Docs verdict` line**: `/feature` phase 4 already audited this
  diff. Carry that verdict into the PR body (step 4) and skip the rest of
  this step.
- **It has none** (this skill was invoked outside `/feature`): scope the
  audit with the checker, then run the agent only when there is scope.

      node scripts/check-docs.mjs --diff origin/preprod

  When it prints `nothing`, the verdict is `nothing to update`: record it at
  step 5 and skip the agent. Otherwise launch the docs-updater agent with the
  Agent tool, pasting the checker's output verbatim as its scope:

      Launch the docs-updater agent with prompt:
      "Delta audit for a PR being opened for review. Base is origin/preprod.

       ## Scope (from check-docs --diff)

       <the checker's output, every line>"

  Wait for it to finish. If it committed documentation changes, they ship
  with the PR.

Either way, fold the audit into the PR description:

- put anything under "Needs you" (a suggested ADR, an over-budget doc, a
  conflict it could not resolve) into the PR body under a **Docs** heading,
  so the reviewer sees it rather than discovering it after merge
- if the checker reported errors, fix them before creating the PR

### 4. Write `.pr-description.md`

Create `.pr-description.md` at the repo root. If `$ARGUMENTS` is provided, use
it as the PR title. Otherwise, generate a concise title from the changes.

**Important:** Include `review: true` in the frontmatter to prevent auto-merge.

Optionally read the `reviewers:` field from `.harness-version` and include it.

Format:

    ---
    title: Short PR title (under 70 characters)
    review: true
    reviewers: teammate1, teammate2
    ---

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
      point: origin/preprod) rather than omitting the section.

    ## What's new
    - User-facing changes described in plain language

    ## Technical changes
    - Key implementation details, files changed, architectural decisions

    ## How to test
    - Steps to verify the feature works correctly

### 5. Update the feature context

Mark the feature context (`.harness/feature-context/<slug>.md`, contract
in `.claude/HARNESS.md`) "awaiting human review", with the PR reference,
the docs verdict when step 3 produced one, and what a follow-up session
should do when review comments arrive. Keep the file: the review window is
exactly when a colleague may `/continue` this feature to address comments.

### 6. Commit and push

On Railway, the preview environment is what reviewers test, and previews are
opt-in per feature: when line 2 of `.harness-feature` is `preview: no` or
absent, flip it first with a naming-style commit, so the push below
provisions the preview:

    bash .claude/scripts/set-feature-name.sh --no-push "$FEATURE_NAME" --preview=yes

The preview then lives until `feature-merge-cleanup.yml` tears it down after
the merge.

    git add .pr-description.md .harness/feature-context/
    git commit -m "chore: submit for review"
    git push -u origin <current-branch>

### 7. Inform the user

Tell the user:

- A PR has been created from `feature/<name>` to `preprod` for review
- The PR will NOT be auto-merged; it requires human approval
- If reviewers were configured, they have been assigned
- Share the PR URL once the workflow creates it (it will appear in the
  GitHub Actions run)
- **When the review is approved, land it with `/to-preprod`**, not the
  GitHub merge button: `/to-preprod` reuses the open PR, refreshes it, and
  cleans up the feature context. (If someone does click the button, the
  cleanup workflow removes the leftover context from preprod.)
- The feature context carries the state; a colleague can pick this up
  any time with `/continue`
