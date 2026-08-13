---
name: endchat
description: Clean up after a /chat session. Deletes the auto-created feature/<name> and claude/<name> branches if they contain no real work, and switches the local checkout back to dev.
disable-model-invocation: true
allowed-tools: Bash(git *), Read
---

# End chat

Close out a `/chat` session by removing the orphaned branches that the
session-start hook created. Refuses to run if the branches contain real
work (anything beyond the `chore: set feature name` or init commit).

## Why this skill exists

Session start no longer pushes anything, so a session that never named a
feature and never pushed leaves no branch behind, and this skill has nothing
to do. A `feature/<name>` branch exists only if the `claude/` branch was
pushed: either by `set-feature-name.sh` (the `chore: set feature name`
commit) or by a code push. Pushing triggers `claude-to-feature-branch.yml`,
which creates `feature/<name>` from `dev` and deletes the source
`claude/<name>` branch on the remote.

If that branch holds no real work (for example you named the feature, then
decided to only chat), it is orphan cruft. This skill cleans it up.

## Steps

### 1. Determine branch names

    BRANCH=$(git branch --show-current)

If `$BRANCH` does not start with `claude/`, tell the user this skill only
runs on a `claude/` session branch, and stop.

    FEATURE_NAME=$(bash .claude/scripts/resolve-feature-name.sh "$BRANCH")
    FEATURE_BRANCH="feature/$FEATURE_NAME"

### 2. Refuse if there is uncommitted local work

    git status --porcelain

If the working tree is dirty, stop and tell the user to either commit and
run `/mergedev`, or discard the changes manually before retrying. Do not
discard changes on the user's behalf.

### 3. Refuse if the feature branch has real commits

Fetch and inspect the remote feature branch:

    git fetch origin "$FEATURE_BRANCH" 2>/dev/null || true

If the remote branch exists, check what it contains beyond the merge base
with `dev`:

    git fetch origin dev
    COMMITS=$(git log "origin/dev..origin/$FEATURE_BRANCH" --pretty=format:"%H %s" 2>/dev/null || true)

The branch is "empty" if every line of `$COMMITS` matches one of:

- `chore: set feature name (...)`
- `chore: initialize feature branch (...)`
- `chore: clean up stale signal file from previous merge`

If any other commit appears, **stop**. Tell the user the feature branch
contains real work and they should run `/mergedev` instead, or manually
review and decide. List the unexpected commits so the user can see what
would be lost.

### 4. Confirm with the user

Even if the branch looks empty, summarize what is about to happen and ask
for confirmation before deleting anything:

    About to delete:
      - remote: feature/<name>      (name/init commit only, safe)
      - remote: claude/<name>-...   (if it still exists)
      - local: claude/<name>-...    (after switching to dev)

    Proceed? (y/N)

### 5. Delete remote branches

    git push origin --delete "$FEATURE_BRANCH" 2>&1 || echo "feature branch already gone"
    git push origin --delete "$BRANCH" 2>&1 || echo "claude branch already gone (workflow may have deleted it)"

Both deletions are best-effort; the `claude-to-feature-branch.yml` workflow
usually deletes the `claude/` branch already.

### 6. Switch local checkout to dev

    git fetch origin dev
    git checkout dev
    git pull --ff-only origin dev
    git branch -D "$BRANCH" 2>/dev/null || true

### 7. Summary

Tell the user:

- which branches were deleted
- that they are now on `dev` locally
- they can start a new session whenever they want; the next `claude/*`
  branch will reinitialize cleanly

Do not chain into other skills.
