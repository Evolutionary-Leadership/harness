---
name: release
description: Ship dev to production. Create a release PR, tag a version, and generate a GitHub Release. Production Railway deploys automatically.
disable-model-invocation: true
argument-hint: "[optional: major|minor|patch (default: patch)]"
allowed-tools: Bash(git *), Read, Write, Edit, Glob, Grep, mcp__github__push_files
---

# Release to production

Push a release commit directly to dev via the GitHub MCP server. The
`release.yml` workflow then creates a PR from dev to main, merges it,
tags the version, and creates a GitHub Release.

**Important:** This skill pushes directly to dev. It does NOT go through
the mergedev workflow chain.

**Why MCP and not `git push`:** In the harness sandbox, `origin` is a
local git proxy that only allows pushes to the current session's
`claude/<branch>`. Pushes to `dev`, `main`, or any other branch are
rejected with HTTP 403. `mcp__github__push_files` goes through
api.github.com using the harness's PAT and bypasses the proxy. The
same call also works in a non-sandboxed checkout, so the skill has a
single code path for both environments.

## Steps

### 1. Preflight checks

    CURRENT_BRANCH=$(git branch --show-current)

Abort with a clear message if the current branch is `main`; you cannot
release from main.

Determine the GitHub owner and repo from the remote URL, you will need
them for the MCP call in step 7:

    REMOTE_URL=$(git config --get remote.origin.url)

The owner/repo is the last two path components (e.g.
`some-org/some-repo`), regardless of whether the remote points at
github.com or the harness local proxy.

### 2. Determine version

    git fetch origin dev main --tags

Get the last release tag:

    LAST_TAG=$(git describe --tags --abbrev=0 origin/main 2>/dev/null || echo "v0.0.0")

Parse the version type from `$ARGUMENTS` (default: `patch`):
- `major` to bump major (e.g., v1.2.3 to v2.0.0)
- `minor` to bump minor (e.g., v1.2.3 to v1.3.0)
- `patch` to bump patch (e.g., v1.2.3 to v1.2.4)

Calculate the new version accordingly. Store it as `$NEW_VERSION`.

### 3. Check for changes

    git log "$LAST_TAG"..origin/dev --oneline

If there are no commits between the last tag and origin/dev, abort with:
"Nothing to release: dev and main are at the same point."

### 4. Generate release notes

Gather commit messages and categorize them into:
- **Features**: new functionality (commits containing "feat", "add", "new")
- **Fixes**: bug fixes (commits containing "fix", "bug", "patch")
- **Improvements**: everything else (refactors, chores, docs, etc.)

Keep notes concise. Use commit subject lines only.

### 5. Build the new CHANGELOG.md content

Read the current CHANGELOG.md from dev (in case the working tree is
stale or the file does not exist locally):

    git show origin/dev:CHANGELOG.md 2>/dev/null || echo ""

If it returned content, prepend the new release section after the
`# Changelog` heading. If it returned empty, build a fresh file with
the heading.

Format:

    # Changelog

    ## [v1.3.0] - YYYY-MM-DD

    ### Features
    - Dark mode toggle (#45)

    ### Fixes
    - Fix login redirect (#43)

    ### Improvements
    - Refactor auth module

Hold the full new content in memory as `$CHANGELOG_CONTENT`. You may
optionally write it to the local working tree for inspection; step 7
will revert any working-tree changes before the skill exits.

### 6. Build `.release-description.md` content

This is a single signal file at the repo root (NOT `.pr-description.md`).
Hold its content in memory as `$RELEASE_DESC_CONTENT`:

    ---
    version: v1.3.0
    type: minor
    ---

    ## Release v1.3.0

    ### Features
    - Dark mode toggle (#45)

    ### Fixes
    - Fix login redirect bug (#43)

### 7. Push directly to dev via the GitHub MCP server

This is the critical step. Do NOT use `git push origin dev`: the
harness proxy rejects it with HTTP 403, and even outside the harness
the MCP path works the same.

Call `mcp__github__push_files` with:

- `owner`: the owner parsed in step 1
- `repo`: the repo parsed in step 1
- `branch`: `dev`
- `message`: `chore: release $NEW_VERSION`
- `files`: an array with exactly these two entries:
  - `{ path: "CHANGELOG.md", content: <CHANGELOG_CONTENT from step 5> }`
  - `{ path: ".release-description.md", content: <RELEASE_DESC_CONTENT from step 6> }`

The MCP call creates a single commit on origin/dev with both files. It
does not modify the local working tree or local refs.

After the call succeeds, leave the working tree clean:

    # Discard any local edits made while composing the files in steps 5 and 6
    git checkout -- CHANGELOG.md 2>/dev/null || true
    rm -f .release-description.md

Then fetch so the new commit is visible locally:

    git fetch origin dev
    git log origin/dev -1 --oneline

The latest commit should be `chore: release $NEW_VERSION`.

If `mcp__github__push_files` returns an error, do NOT fall back to
`git push origin dev`: it will 403 in the harness. Surface the error
to the user and stop. The working tree should still be clean because
nothing was committed locally.

### 8. Inform the user

Tell the user:
- The release commit was pushed to `dev` via the GitHub API
  (`mcp__github__push_files`), bypassing the local git proxy.
- The `release.yml` workflow will now:
  1. Create a PR from dev to main
  2. Merge the PR
  3. Tag version `$NEW_VERSION` and create a GitHub Release
- Share the version number and key changes.
- If main has branch protection with required checks, the merge will
  wait for checks to pass (auto-merge).

### 9. Best-effort orphan branch cleanup

A `claude/<name>` session creates a `feature/<name>` branch and Railway
environment only once it pushes (the slug commit from
`set-feature-name.sh`, or any code push); the source `claude/<name>`
branch is then normally deleted by `claude-to-feature-branch.yml`. Since
the release skill bypasses the feature-branch chain entirely, if such a
branch exists neither cleanup is guaranteed to have happened. Deleting
the remote `feature/<name>` branch (when it succeeds) triggers
`feature-branch-cleanup.yml`, which removes any associated Railway
environment automatically.

Attempt deletion, but treat it as best-effort:

    if [[ "$CURRENT_BRANCH" == claude/* ]]; then
      FEATURE_NAME=$(bash .claude/scripts/resolve-feature-name.sh "$CURRENT_BRANCH")
      git push origin --delete "feature/$FEATURE_NAME" 2>/dev/null || true
      git push origin --delete "$CURRENT_BRANCH" 2>/dev/null || true
    fi

**Harness limitation:** The local git proxy rejects deletes of branches
it does not consider session-owned (HTTP 403), and there is no
GitHub-MCP tool for deleting a branch. Expect these deletes to fail in
the sandbox. If they do, mention to the user that the orphan
`feature/<name>` (and possibly `claude/<name>`) branches may need to be
cleaned up manually on GitHub, or will be cleaned up by the workflows
that respond to the dev push.

The working tree must be clean when the skill exits. If anything was
left modified by step 5 or step 6, revert it now:

    git checkout -- CHANGELOG.md 2>/dev/null || true
    rm -f .release-description.md
