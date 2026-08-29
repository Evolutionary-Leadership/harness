---
name: release
description: Ship dev to production. Create a release PR, tag a version, and generate a GitHub Release. Production Railway deploys automatically.
disable-model-invocation: true
argument-hint: "[optional: major|minor|patch (default: patch)] [--quick]"
allowed-tools: Bash(git *), Read, Write, Edit, Glob, Grep, AskUserQuestion, mcp__github__push_files
---

# Release to production

Push a release commit directly to dev via the GitHub MCP server. The
`release.yml` workflow then creates a PR from dev to main, merges it,
tags the version, and creates a GitHub Release.

**Important:** This skill pushes directly to dev. On `dev` it does NOT go
through the mergedev workflow chain.

**This skill knows where it is being run from.** Releasing is not a local
act: it ships everything sitting on `dev`, not just your own work. Two
things follow, and they are steps 1, 3 and 4 below. Every run reports its
**blast radius**, so nobody ships a colleague's half-finished feature
without seeing it. And a run started from a `claude/` branch whose work
has not landed asks one deliberate question before taking the feature all
the way to `main` in one go.

**Why MCP and not `git push`:** In the harness sandbox, `origin` is a
local git proxy that only allows pushes to the current session's
`claude/<branch>`. Pushes to `dev`, `main`, or any other branch are
rejected with HTTP 403. `mcp__github__push_files` goes through
api.github.com using the harness's PAT and bypasses the proxy. The
same call also works in a non-sandboxed checkout, so the skill has a
single code path for both environments.

## Steps

### 1. Preflight and situation

    CURRENT_BRANCH=$(git branch --show-current)

Abort with a clear message if the current branch is `main`; you cannot
release from main.

Determine the GitHub owner and repo from the remote URL, you will need
them for the MCP call in step 9:

    REMOTE_URL=$(git config --get remote.origin.url)

The owner/repo is the last two path components (e.g.
`some-org/some-repo`), regardless of whether the remote points at
github.com or the harness local proxy.

**Parse `$ARGUMENTS` for `--quick`** as well as the version type. `--quick`
is the user asserting they have already thought about what this ships. It
skips the question in step 4. It does not skip the report in step 3.

**Work out the situation**, because the next three steps differ by it:

    git fetch origin dev main --tags
    git log origin/dev..HEAD --oneline

| Situation | How to tell | What it means |
|---|---|---|
| **On `dev`** | `CURRENT_BRANCH` is `dev` | The ordinary release. Everything being shipped is already on `dev` |
| **Landed feature** | on a `claude/` branch, and `git log origin/dev..HEAD` is empty | This session's work is already merged. Behaves exactly like the `dev` case |
| **Unlanded feature** | on a `claude/` branch with commits not on `dev` | The chain case: this feature has to reach `dev` before it can reach `main`. Steps 4 and 8 handle it |

Anything else (a `feature/` branch, a detached head, a hand-made branch)
is the unlanded case if it has commits `dev` does not, and the landed case
if it does not.

### 2. Determine version

    git fetch origin dev main --tags

Get the last release tag, which step 3 needs either way:

    LAST_TAG=$(git describe --tags --abbrev=0 origin/main 2>/dev/null || echo "v0.0.0")

**Which rule applies depends on whether something else already owns the
version.** Check once:

    test -f .github/workflows/harness-version-bump.yml && test -f VERSION

**If both exist, read the version; do not calculate one.** A version bump
workflow moves `VERSION` on every merge, and the tag publishes that number
rather than carrying one of its own, so `v` + `VERSION` **is** the tag. Two
rules for one number is what makes a release page and a project's own
version file disagree.

    NEW_VERSION="v$(git show origin/dev:VERSION | tr -d '[:space:]')"

`--minor` or `--major` raises it first, because the judgement that a batch
adds up to a minor is one you can only make here, looking at step 3's blast
radius. Compute the raised number from `VERSION`, not from `$LAST_TAG`, and
carry the `VERSION` file itself in step 9 so the tag and the file stay equal.
Without an argument, publish `VERSION` as it stands.

**If either is missing, calculate as before.** Parse the version type from
`$ARGUMENTS` (default: `patch`):
- `major` to bump major (e.g., v1.2.3 to v2.0.0)
- `minor` to bump minor (e.g., v1.2.3 to v1.3.0)
- `patch` to bump patch (e.g., v1.2.3 to v1.2.4)

Calculate the new version from `$LAST_TAG` accordingly.

Either way, store the result as `$NEW_VERSION`.

### 3. Compute the blast radius

**Do this on every run, from every branch, including under `--quick`.**
This is the step that answers "what am I actually shipping", and the
answer is almost never "my feature".

    git log "$LAST_TAG"..origin/dev --oneline

That range is everything already queued on `dev` for the next release.
Group it by the pull request each commit merged in (`git log
"$LAST_TAG"..origin/dev --merges --oneline` gives the merge commits; the
PR number is in their subject), and count it.

If that returns nothing, the repo squash-merges and there are no merge
commits to group by. Do not report "no pull requests": fall back to the
`(#NN)` reference in each commit subject, and where even that is absent,
list the commits ungrouped. An empty grouping must never read as an empty
blast radius.

In the unlanded case, add this feature's own commits, which are not in
that range yet:

    git log origin/dev..HEAD --oneline

Present the two groups **distinctly labelled**, because they carry
different risk:

- **Yours**: the commits from this session, which you know the state of.
- **Riding along**: everything else in the range, merged by someone else,
  which you are shipping to production whether or not you have looked at
  it. Name each PR and its author.

Then a one-line count: "N commits across M pull requests, K of them yours."

If both groups are empty, abort with: "Nothing to release: dev and main
are at the same point."

Hold this report. Step 4 uses it as the body of the question, and step 10
prints it in the summary whether or not step 4 ran.

### 4. Confirm, unless `--quick`

Skip this step entirely when `--quick` was passed, and when the situation
is `dev` or landed-feature with nothing riding along that the user has not
already seen. Otherwise ask exactly one question with `AskUserQuestion`,
with the step 3 report as its body.

In the **unlanded** case, the question names the whole path explicitly:
this takes the feature from its branch, to `dev`, to `main`, and tags a
release, in one command. Say that the merge to `dev` happens first and
that everything riding along ships with it.

In the **dev** and **landed** cases, ask only when something is riding
along: "this ships N commits you did not write, listed above". A release
of only your own reviewed work needs no question.

If the user declines, stop. Do not offer a partial release; there is no
such thing.

### 5. Unlanded case only: run the merge, then wait for dev to settle

Skip this step entirely in the `dev` and landed-feature cases.

The feature has to reach `dev` before it can reach `main`, and `dev` has to
come to rest before the release can be composed from it.

**Run the merge by following the merge skill's own file:**

Read `.claude/skills/mergedev/SKILL.md` and work its steps in order.

That means all of them: resolve the feature name, merge `dev` in and
resolve conflicts with its discipline, run the docs-updater agent, retire
the feature context, write `.pr-description.md`, push the branch, then push
the signal file. Do not reimplement any of it here; a second copy of the
conflict discipline and the docs audit would drift from the first.

Following a user-invoked skill's file is deliberate and is recorded in ADR
0017. `disable-model-invocation` gates the Skill tool, not a file read, and
the authorization is the user's answer in step 4 (or their `--quick`).

**Then wait: merge, then settle.**

    git fetch origin dev
    git merge-base --is-ancestor <the merge commit> origin/dev

Poll that until the merge is an ancestor of `origin/dev`. Then keep
fetching until `origin/dev`'s tip has stopped moving for about a minute.
Cap the whole wait at about ten minutes.

The settle window is the point, and it is not padding. Where a version bump
workflow exists it fires on the same merge and moves `VERSION` a moment
later, so a version read before it lands is the *previous* release's number
and step 2 would tag a value that is already stale. Repos without a version
bump settle at once. One rule covers both.

**On timeout, stop.** Say plainly which of these happened, and that no
release was cut either way:

- The merge landed but `dev` never settled: re-run `/release` from `dev`
  once it is quiet. The feature is safe on `dev`; only the release is
  outstanding.
- The merge never landed: the mergedev workflow has not finished or has
  failed. Point at its recovery section ("If the workflow fails" in the
  merge skill), which owns that diagnosis.

Do not push a release after a timeout on the assumption it will be fine.

**Recompute from the settled tip.** Everything after this step reads
`origin/dev` again. The blast radius from step 3 was measured before the
merge, so the feature's commits have moved from "yours, not yet on dev"
into the range itself; say so when you print it in step 10 rather than
showing a stale split.

### 6. Generate release notes

Gather commit messages and categorize them into:
- **Features**: new functionality (commits containing "feat", "add", "new")
- **Fixes**: bug fixes (commits containing "fix", "bug", "patch")
- **Improvements**: everything else (refactors, chores, docs, etc.)

Keep notes concise. Use commit subject lines only.

### 7. Build the new CHANGELOG.md content

**Skip this whole step when the version bump owns the changelog**, which is
the same condition as step 2: a `harness-version-bump.yml` plus a `VERSION`
file. Such a workflow writes one entry per merge, in the commit that moves
`VERSION`, so the entries are already on `dev` and there is nothing to
compose. Composing one here would mean holding the entire changelog inline
in step 9's call, which is how three consecutive releases shipped without an
entry when nobody noticed the step had been skipped.

Otherwise, read the current CHANGELOG.md from dev (in case the working tree
is stale or the file does not exist locally):

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
optionally write it to the local working tree for inspection; step 9
will revert any working-tree changes before the skill exits.

### 8. Build `.release-description.md` content

This is a single signal file at the repo root (NOT `.pr-description.md`).
Hold its content in memory as `$RELEASE_DESC_CONTENT`:

When the chain ran from a `claude/` branch (step 5), add a
`cleanup-branch:` key naming that branch:

    ---
    version: v1.3.0
    type: minor
    cleanup-branch: claude/<name>
    ---

`release.yml` parses that key and deletes the branch server-side with the
harness PAT, which is the only deletion path that works from inside the
sandbox. Omit the key entirely in the `dev` and landed-feature cases;
there is no orphan to clean up.

    ---
    version: v1.3.0
    type: minor
    ---

    ## Release v1.3.0

    ### Features
    - Dark mode toggle (#45)

    ### Fixes
    - Fix login redirect bug (#43)

### 9. Push directly to dev via the GitHub MCP server

This is the critical step. Do NOT use `git push origin dev`: the
harness proxy rejects it with HTTP 403, and even outside the harness
the MCP path works the same.

Call `mcp__github__push_files` with:

- `owner`: the owner parsed in step 1
- `repo`: the repo parsed in step 1
- `branch`: `dev`
- `message`: `chore: release $NEW_VERSION`
- `files`: always
  `{ path: ".release-description.md", content: <RELEASE_DESC_CONTENT from step 8> }`,
  plus **exactly one** of:
  - `{ path: "CHANGELOG.md", content: <CHANGELOG_CONTENT from step 7> }` when
    step 7 composed one.
  - `{ path: "VERSION", content: <the raised number, no leading v> }` when the
    version bump owns the changelog **and** `--minor` or `--major` raised the
    version in step 2. A few bytes, so this never revives the inline-size
    problem that step 7 avoids.
  - Neither, when the bump owns the changelog and the version was published
    as it stands. The signal file alone is the whole commit.

The MCP call creates a single commit on origin/dev. It does not modify the
local working tree or local refs.

After the call succeeds, leave the working tree clean:

    # Discard any local edits made while composing the files in steps 7 and 8
    git checkout -- CHANGELOG.md VERSION 2>/dev/null || true
    rm -f .release-description.md

Then fetch so the new commit is visible locally:

    git fetch origin dev
    git log origin/dev -1 --oneline

The latest commit should be `chore: release $NEW_VERSION`.

If `mcp__github__push_files` returns an error, do NOT fall back to
`git push origin dev`: it will 403 in the harness. Surface the error
to the user and stop. The working tree should still be clean because
nothing was committed locally.

### 10. Inform the user

Tell the user:
- The release commit was pushed to `dev` via the GitHub API
  (`mcp__github__push_files`), bypassing the local git proxy.
- The `release.yml` workflow will now:
  1. Create a PR from dev to main
  2. Merge the PR
  3. Tag version `$NEW_VERSION` and create a GitHub Release
- Share the version number and key changes.
- **Print the step 3 blast-radius report**, whether or not step 4 asked
  anything. `--quick` skips the question, never the record: after the
  fact, "what shipped" has to be answerable.
- If main has branch protection with required checks, the merge will
  wait for checks to pass (auto-merge).

### 11. Best-effort orphan branch cleanup

**`cleanup-branch:` does the `claude/` branch already.** When step 8 wrote
that key, `release.yml` deletes that branch server-side with the harness
PAT once the release lands. This step is about what is left over, and
about the case where no key was written.

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
the sandbox.

What to tell the user when they do fail depends on step 8. If
`cleanup-branch:` was written, the `claude/` branch is the workflow's
problem now and needs no mention; say only that `feature/<name>` may
linger. If it was not (the `dev` and landed-feature cases), fall back to
the old advice: the orphan branches may need cleaning up by hand on
GitHub, or will be cleaned up by the workflows that respond to the dev
push.

The working tree must be clean when the skill exits. If anything was
left modified by step 7 or step 8, revert it now:

    git checkout -- CHANGELOG.md VERSION 2>/dev/null || true
    rm -f .release-description.md
