---
name: continue
description: Resume work on an in-progress feature branch. Lists active features with their feature context and preview URLs, lets you pick one, and lands you mid-flow with the reasoning intact.
disable-model-invocation: true
argument-hint: "[optional: feature name to continue]"
allowed-tools: Bash(git *), Bash(gh *), Read, Glob, Grep
---

# Continue an in-progress feature

List active feature branches, show each one's feature context beside its
git summary, and resume the one the user picks. The feature context (the
committed file `.harness/feature-context/<slug>.md`, contract in
`.claude/HARNESS.md`) is what makes this a real handover: colleague A's
reasoning, not just their commits.

## Steps

### 1. List active feature branches, with their context

    git fetch origin --prune
    git branch -r | grep 'origin/feature/' | sed 's|origin/||'

For each branch, show the git summary:

    for branch in $(git branch -r | grep 'origin/feature/' | sed 's|origin/||'); do
      echo "$branch"
      git log "origin/$branch" -1 --format="  Last commit: %s (%cr)"
      URL=$(git show "origin/$branch:.railway-url" 2>/dev/null || echo "")
      [ -n "$URL" ] && echo "  Preview: $URL"
    done

    gh pr list --base dev --state open --json number,title,headRefName --jq '.[] | "  PR #\(.number): \(.title) (\(.headRefName))"'

(Where `gh` is unavailable, list open PRs per the GitHub MCP note in
`docs/agents/issue-tracker.md`.)

Then, for each branch, read its feature context without checking anything
out:

    git show "origin/feature/<name>:.harness/feature-context/<name>.md" 2>/dev/null

Show the context's phase, next step, and open questions beside the git
summary. A branch without a context file predates the flow or skipped it;
say so rather than guessing at its state.

### 2. Select a feature

If `$ARGUMENTS` is provided, match it against the feature names.
Otherwise, present the list and ask the user which feature to continue.

### 3. Fetch and checkout

    FEATURE="feature/<name>"
    git fetch origin "$FEATURE"
    git checkout -b "claude/<name>-<sessionId>" "origin/$FEATURE"

Where `<sessionId>` is the current session identifier suffix from the
branch name you are on, or a short random suffix.

### 4. Sweep stale contexts

A context file whose feature branch no longer exists on the remote leaked
past a merge that bypassed `/mergedev` and the cleanup workflow. Delete
any such file under `.harness/feature-context/` in the working tree now
(commit the deletion; it rides along with the next push). This is a
safety net, not the intended path.

### 5. Hand over to the feature flow

Delegate to `/feature`'s resume logic (its phase 0): it merges the
feature branch, loads the feature context, verifies the phase against the
tracker artifacts, and gates before continuing. Do not improvise a
separate resume here.

If the context marks the feature "awaiting human review" (a `/review` PR
is open), say so: the likely work is addressing review comments, and the
exit after that is `/mergedev` on the same PR.

### 6. Ready to work

Tell the user:

- You are now on a working branch for this feature
- The Railway preview URL, if one is published
- The phase the feature context says it is in, and the recorded next step
- The decisions already settled (so nobody re-litigates them by accident)
- Then confirm the next step before doing it
