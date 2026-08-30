---
name: release
description: Ship preprod to production. Create a release PR, tag a version, and generate a GitHub Release.
disable-model-invocation: true
argument-hint: "[optional: major|minor|patch (default: patch)] [--quick]"
allowed-tools: Bash(git *), Read, Write, Edit, Glob, Grep, AskUserQuestion, mcp__github__push_files
---

# Release to production

Push a release commit directly to preprod via the GitHub MCP server. The
`release.yml` workflow then creates a PR from preprod to main, merges it,
tags the version, and creates a GitHub Release.

**Important:** This skill pushes directly to preprod. On `preprod` it does NOT go
through the to-preprod workflow chain.

**This skill knows where it is being run from.** Releasing is not a local
act: it ships everything sitting on `preprod`, not just your own work. Two
things follow, and they are steps 1, 3 and 4 below. Every run reports its
**blast radius**, so nobody ships a colleague's half-finished feature
without seeing it. And a run started from a `claude/` branch whose work
has not landed asks one deliberate question before taking the feature all
the way to `main` in one go.

**Why MCP and not `git push`:** In the harness sandbox, `origin` is a
local git proxy that only allows pushes to the current session's
`claude/<branch>`. Pushes to `preprod`, `main`, or any other branch are
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

    git fetch origin preprod main --tags
    git log origin/preprod..HEAD --oneline

| Situation | How to tell | What it means |
|---|---|---|
| **On `preprod`** | `CURRENT_BRANCH` is `preprod` | The ordinary release. Everything being shipped is already on `preprod` |
| **Landed feature** | on a `claude/` branch, and `git log origin/preprod..HEAD` is empty | This session's work is already merged. Behaves exactly like the `preprod` case |
| **Unlanded feature** | on a `claude/` branch with commits not on `preprod` | The chain case: this feature has to reach `preprod` before it can reach `main`. Steps 4 and 8 handle it |

Anything else (a `feature/` branch, a detached head, a hand-made branch)
is the unlanded case if it has commits `preprod` does not, and the landed case
if it does not.

### 2. Determine version

    git fetch origin preprod main --tags

Get the last release tag, which step 3 needs either way:

    LAST_TAG=$(git describe --tags --abbrev=0 origin/main 2>/dev/null || echo "v0.0.0")

**Which rule applies depends on whether something else already owns the
version.** Check once:

    test -f .github/workflows/harness-version-bump.yml && test -f VERSION

**If both exist, compute the next version from `VERSION`.** Merges no
longer move `VERSION`: they add their prose to the changelog's
`## [Unreleased]` section and leave the number alone, so `VERSION` on
`preprod` is the *last released* version and this release consumes exactly
one number (ADR 0024). That is what makes the number knowable here, before
anything is pushed, which is what the release note has to be named for:

    CURRENT=$(git show origin/preprod:VERSION | tr -d '[:space:]')
    NEW_VERSION="v$(node scripts/release-identity.mjs next-version "$CURRENT" patch)"

Pass `minor` or `major` instead of `patch` when `$ARGUMENTS` asked for one;
that judgement is one you can only make here, looking at step 3's blast
radius. Do **not** write `VERSION` yourself: `release.yml` stamps it, the
migration and the changelog together from the version in the signal file,
so one step owns all four.

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

    git log "$LAST_TAG"..origin/preprod --oneline

That range is everything already queued on `preprod` for the next release.
Group it by the pull request each commit merged in (`git log
"$LAST_TAG"..origin/preprod --merges --oneline` gives the merge commits; the
PR number is in their subject), and count it.

If that returns nothing, the repo squash-merges and there are no merge
commits to group by. Do not report "no pull requests": fall back to the
`(#NN)` reference in each commit subject, and where even that is absent,
list the commits ungrouped. An empty grouping must never read as an empty
blast radius.

In the unlanded case, add this feature's own commits, which are not in
that range yet:

    git log origin/preprod..HEAD --oneline

Present the two groups **distinctly labelled**, because they carry
different risk:

- **Yours**: the commits from this session, which you know the state of.
- **Riding along**: everything else in the range, merged by someone else,
  which you are shipping to production whether or not you have looked at
  it. Name each PR and its author.

Then a one-line count: "N commits across M pull requests, K of them yours."

If both groups are empty, abort with: "Nothing to release: preprod and main
are at the same point."

Hold this report. Step 4 uses it as the body of the question, and step 10
prints it in the summary whether or not step 4 ran.

### 4. Confirm, unless `--quick`

Skip this step entirely when `--quick` was passed, and when the situation
is `preprod` or landed-feature with nothing riding along that the user has not
already seen. Otherwise ask exactly one question with `AskUserQuestion`,
with the step 3 report as its body.

In the **unlanded** case, the question names the whole path explicitly:
this takes the feature from its branch, to `preprod`, to `main`, and tags a
release, in one command. Say that the merge to `preprod` happens first and
that everything riding along ships with it.

In the **preprod** and **landed** cases, ask only when something is riding
along: "this ships N commits you did not write, listed above". A release
of only your own reviewed work needs no question.

If the user declines, stop. Do not offer a partial release; there is no
such thing.

### 5. Unlanded case only: run the merge, then wait for preprod to settle

Skip this step entirely in the `preprod` and landed-feature cases.

The feature has to reach `preprod` before it can reach `main`, and `preprod` has to
come to rest before the release can be composed from it.

**Run the merge by following the merge skill's own file:**

Read `.claude/skills/to-preprod/SKILL.md` and work its steps in order.

That means all of them: resolve the feature name, merge `preprod` in and
resolve conflicts with its discipline, run the docs-updater agent, retire
the feature context, write `.pr-description.md`, push the branch, then push
the signal file. Do not reimplement any of it here; a second copy of the
conflict discipline and the docs audit would drift from the first.

Following a user-invoked skill's file is deliberate and is recorded in ADR
0017. `disable-model-invocation` gates the Skill tool, not a file read, and
the authorization is the user's answer in step 4 (or their `--quick`).

**Then wait: merge, then settle.**

    git fetch origin preprod
    git merge-base --is-ancestor <the merge commit> origin/preprod

Poll that until the merge is an ancestor of `origin/preprod`. Then keep
fetching until `origin/preprod`'s tip has stopped moving for about a minute.
Cap the whole wait at about ten minutes.

The settle window is the point, and it is not padding. Where a changelog
accumulator workflow exists it fires on the same merge and appends that
merge's prose to `## [Unreleased]` a moment later, so a changelog read
before it lands is missing the very feature this release is being cut for,
and the note composed from it says nothing about it. Repos without one
settle at once. One rule covers both.

**On timeout, stop.** Say plainly which of these happened, and that no
release was cut either way:

- The merge landed but `preprod` never settled: re-run `/release` from `preprod`
  once it is quiet. The feature is safe on `preprod`; only the release is
  outstanding.
- The merge never landed: the to-preprod workflow has not finished or has
  failed. Point at its recovery section ("If the workflow fails" in the
  merge skill), which owns that diagnosis.

Do not push a release after a timeout on the assumption it will be fine.

**Recompute from the settled tip.** Everything after this step reads
`origin/preprod` again. The blast radius from step 3 was measured before the
merge, so the feature's commits have moved from "yours, not yet on preprod"
into the range itself; say so when you print it in step 10 rather than
showing a stale split.

### 6. Generate release notes

Gather commit messages and categorize them into:
- **Features**: new functionality (commits containing "feat", "add", "new")
- **Fixes**: bug fixes (commits containing "fix", "bug", "patch")
- **Improvements**: everything else (refactors, chores, docs, etc.)

Keep notes concise. Use commit subject lines only.

### 7. Build the new CHANGELOG.md content

**Skip this whole step when the changelog accumulator owns the changelog**,
which is the same condition as step 2: a `harness-version-bump.yml` plus a
`VERSION` file. Such a workflow appends one entry per merge to the
`## [Unreleased]` section, and `release.yml` stamps that whole section with
the version this release publishes (ADR 0024), so the prose is already on
`preprod` and there is nothing to compose. Composing one here would mean
holding the entire changelog inline in step 9's call, which is how three
consecutive releases shipped without an entry when nobody noticed the step
had been skipped.

Otherwise, read the current CHANGELOG.md from preprod (in case the working tree
is stale or the file does not exist locally):

    git show origin/preprod:CHANGELOG.md 2>/dev/null || echo ""

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

### 7b. Generate the downstream release note

**Skip this step entirely where `release-notes/` or
`scripts/release-notes-brief.mjs` is absent.** Only the authoring repo
publishes to a template repo; a downstream project has neither, and this
step is written to disappear there rather than to be deleted.

Where they exist, the note is **required**: `release.yml` fails the
release when `release-notes/$NEW_VERSION.md` is missing, because a
release that publishes no note leaves the template repo carrying new
content under the previous release (forge decision record 0023).

Draft it rather than writing from a blank file:

    node scripts/release-notes-brief.mjs --version <version without the leading v> --draft \
      > release-notes/<version>.md

That writes a complete five-section note: the brief spans every bump since
the last published note, drops the versions whose migrations touched
nothing under `templates/`, drops bullets about the factory (the checkers,
this repo's own docs and decisions), prefixes a railway-only range, and
strips the issue references, repo names and em dashes the composer
rejects. Run it without `--draft` to read the same material as a report:

    node scripts/release-notes-brief.mjs --version <version without the leading v>

**Then edit what it produced.** The draft is assembled from changelog
prose written for people who work on the harness, so it will name
internals and describe changes from the maintainer's side. Rewrite each
bullet for someone who runs a scaffolded project and has never seen this
repository, drop anything they cannot act on, and keep the five sections
in order. Two markers in the report explain what the draft did:

- **`factory only, omit from the note`**: that version changed nothing
  under `templates/`, so a downstream project cannot act on it. Leave its
  prose out entirely.
- **`railway only`**: prefix those bullets with `**Railway only:** `.

Follow `release-notes/README.md` for the rules the draft cannot apply for
you: say what a reader can do or must know rather than which file moved,
and omit a section rather than padding it.

Validate before going further, which is the same check `release.yml` and
the sync will run:

    node scripts/compose-release-notes.mjs --notes release-notes/$NEW_VERSION.md

Fix anything it reports. Step 9 carries the file in the release commit.

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
sandbox. Omit the key entirely in the `preprod` and landed-feature cases;
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

### 9. Push directly to preprod via the GitHub MCP server

This is the critical step. Do NOT use `git push origin preprod`: the
harness proxy rejects it with HTTP 403, and even outside the harness
the MCP path works the same.

Call `mcp__github__push_files` with:

- `owner`: the owner parsed in step 1
- `repo`: the repo parsed in step 1
- `branch`: `preprod`
- `message`: `chore: release $NEW_VERSION`
- `files`: always
  `{ path: ".release-description.md", content: <RELEASE_DESC_CONTENT from step 8> }`,
  plus `{ path: "release-notes/<version>.md", content: <the note from step 7b> }`
  whenever step 7b ran (the release fails without it),
  plus `{ path: "CHANGELOG.md", content: <CHANGELOG_CONTENT from step 7> }`
  when step 7 composed one.

  **Never push `VERSION` from here.** `release.yml` writes it, the migration
  and the changelog stamp in one commit, from the version in the signal file
  (ADR 0024). Pushing it here as well would give one number two owners,
  which is the failure that rule exists to prevent.

The MCP call creates a single commit on origin/preprod. It does not modify the
local working tree or local refs.

After the call succeeds, leave the working tree clean:

    # Discard any local edits made while composing the files in steps 7 and 8
    git checkout -- CHANGELOG.md VERSION 2>/dev/null || true
    rm -f .release-description.md

Then fetch so the new commit is visible locally:

    git fetch origin preprod
    git log origin/preprod -1 --oneline

The latest commit should be `chore: release $NEW_VERSION`.

If `mcp__github__push_files` returns an error, do NOT fall back to
`git push origin preprod`: it will 403 in the harness. Surface the error
to the user and stop. The working tree should still be clean because
nothing was committed locally.

### 10. Inform the user

Tell the user:
- The release commit was pushed to `preprod` via the GitHub API
  (`mcp__github__push_files`), bypassing the local git proxy.
- The `release.yml` workflow will now:
  1. Create a PR from preprod to main
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

A `claude/<name>` session creates a `feature/<name>` branch only once it
pushes (the slug commit from `set-feature-name.sh`, or any code push);
the source `claude/<name>` branch is then normally deleted by
`claude-to-feature-branch.yml`. Since the release skill bypasses the
feature-branch chain entirely, if such a branch exists neither cleanup is
guaranteed to have happened.

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
linger. If it was not (the `preprod` and landed-feature cases), fall back to
the old advice: the orphan branches may need cleaning up by hand on
GitHub, or will be cleaned up by the workflows that respond to the preprod
push.

The working tree must be clean when the skill exits. If anything was
left modified by step 7 or step 8, revert it now:

    git checkout -- CHANGELOG.md VERSION 2>/dev/null || true
    rm -f .release-description.md
