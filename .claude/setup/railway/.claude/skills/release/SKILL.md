---
name: release
description: Ship preprod to production. Merge preprod onto main, tag a version, and publish a GitHub Release. Production Railway deploys automatically.
argument-hint: "[optional: major|minor|patch (default: the step 2 proposal)] [--quick]"
allowed-tools: Bash(git *), Bash(bash .claude/scripts/*), Bash(node scripts/*), Read, Write, Edit, Glob, Grep, AskUserQuestion, mcp__github__push_files, mcp__github__list_pull_requests, mcp__github__pull_request_read, mcp__github__issue_write, mcp__github__add_issue_comment
---

# Release to production

Push one release commit to `preprod`. The `release.yml` workflow then merges
`preprod` onto `main` (`--no-ff`, falling back to a pull request only when the
direct push is refused), tags the version, publishes a GitHub Release and
fast-forwards `preprod` to `main`.

**This skill knows where it is being run from.** Releasing ships everything
sitting on `preprod`, not just your own work. Every run reports its **blast
radius** (step 3), so nobody ships a colleague's half-finished feature
without seeing it, and a run from a `claude/` branch whose work has not
landed takes the feature all the way to `main` in one go (steps 4 and 5).

## Authority

**This skill reaches production, so a session may complete it only under
authority.** It ships everything queued on `preprod` to `main`, tags it, and
publishes a GitHub Release; in a repository that syncs a template, it reaches
every downstream scaffold too. **Check this first, before any other step.**
Work you are not allowed to file is work you should not start, and
discovering the block at the exit is the failure this section exists to
remove (a forge decision record).

    AUTHORITY=$(sed -n 's/^agent-authority: *//p' .harness-version | tail -1)

Authority is satisfied by **any** of these three forms, and by nothing else:

1. **A grant.** `release` appears in `agent-authority:` in `.harness-version`.
   The person who owns this repository granted it ahead of time, in a commit.
2. **A user asking, in this turn.** They typed `/release`, or said in words to
   do it, or picked it at a `/feature` phase 5 exit gate. A relayed report
   that somebody once approved releases is not this; the ask is in the turn.
3. **`--ship` in the invocation of the `/feature` run that chained here.** A
   person typed it about this session, so it is release authority. Step 4's
   confirmation is skipped under it; step 3's blast-radius report is always
   produced and recorded.

**`--ship` is the third form because a person typed it about this session.**
It is a decision made in the invocation, by the person who started the run,
about the work this run would produce: the owner's decision, recorded in a
forge decision record together with the trade it accepts (a one-command path
from an idea to a tagged release on `main`, against the protection a grant
alone gave). `/hotfix` and `/rollback` keep their two forms; the flag reaches
neither.

**Under form 1 or form 3 the run goes all the way, and does not stop to ask
again.** The grant or the flag is the consent and says nobody is there to be
asked twice, so step 4's confirmation is answered and skipped, exactly as
`--quick` skips it, and the run takes the feature from its branch to
`preprod` to `main` carrying everything already queued there. **Step 3's
blast-radius report is still produced in full and still recorded** (in the
reply, and in the feature context when `/feature` chained here): a release
nobody was asked about is allowed; a release nobody can read afterwards is
not.

**If none of the three holds, stop here and stand down.** Do not compute
anything, do not write a signal file, do not push. Emit the stand-down block
(`getting-started`, Step 3c) with `reason: authority-not-granted`, and say
plainly what this session did finish and that it is not complete.

**Performing these steps by hand is the same act, and is refused the same
way.** A forge decision record lets a session reach this procedure by reading
this file rather than invoking the skill; that route is open, and it is not a
way around this section. Writing the signal file, committing it and pushing
it without authority IS this skill, whatever it is called at the time. A
guard that stopped only the literal invocation would guard nothing.

## The invocation

```text
$ARGUMENTS
```

It carries at most a bump type (`major`, `minor`, `patch`) and `--quick`.

## The closing block

Every reply carries one, per the contract in `getting-started` (Step 3b). A
release is the one place the block is load-bearing rather than convenient:

- `Good to know`: the **blast radius** first, always. Everything queued on
  `preprod`, not just this feature, and the number the release will consume.
  Nobody should approve a release from prose alone. Then the items
  `LANDING.md` names, once step 10b has run.
- `Act later`: anything this release does not carry, naming where it belongs.
- `Act next`: the single confirmation the user owes, or, once the release is
  away, what to watch and where (the workflow, the tag, the template sync).

Run as `/feature` phase 5's exit or chained after `/to-preprod`, this skill
adds its items to the outermost skill's block rather than emitting a second.

## Steps

### 1. Preflight and situation

    CURRENT_BRANCH=$(git branch --show-current)

Abort with a clear message if the current branch is `main`; you cannot
release from main. Note the GitHub owner and repo for step 9: the last two
path components of `git config --get remote.origin.url`, whether the remote
points at github.com or the harness local proxy.

**Fetch once.** Steps 1, 2 and 3 share this fetch; nothing before step 5
fetches again:

    git fetch origin preprod main --tags
    LAST_TAG=$(git describe --tags --abbrev=0 origin/main 2>/dev/null || echo "v0.0.0")
    git log origin/preprod..HEAD --oneline

**Work out the situation**, because the next steps differ by it:

| Situation | How to tell | What it means |
|---|---|---|
| **On `preprod`** | `CURRENT_BRANCH` is `preprod` | The ordinary release. Everything being shipped is already on `preprod` |
| **Landed feature** | on a `claude/` branch, and `git log origin/preprod..HEAD` is empty | This session's work is already merged. Behaves exactly like the `preprod` case |
| **Unlanded feature** | on a `claude/` branch with commits not on `preprod` | The chain case: this feature has to reach `preprod` before it can reach `main`. Steps 4 and 5 handle it |

Anything else (a `feature/` branch, a detached head, a hand-made branch) is
the unlanded case if it has commits `preprod` does not, else the landed case.

### 2. Determine version

**Which rule applies depends on whether something else already owns the
version.** Check once:

    test -f .github/workflows/harness-version-bump.yml && test -f VERSION

**If both exist, compute the next version from `VERSION`.** A merge adds its
prose to the changelog's `## [Unreleased]` and leaves the number alone, so
`VERSION` on `preprod` is the *last released* version and this release
consumes exactly one number, knowable here, before anything is pushed:

    CURRENT=$(git show origin/preprod:VERSION | tr -d '[:space:]')
    NEW_VERSION="v$(node scripts/release-identity.mjs next-version "$CURRENT" <type>)"

Do **not** write `VERSION` yourself: `release.yml` stamps it, the migration
and the changelog together from the version in the signal file, so one step
owns all four. **If either is missing, calculate from `$LAST_TAG`:** `major`
bumps v1.2.3 to v2.0.0, `minor` to v1.3.0, `patch` to v1.2.4.

**Propose the type before anyone picks one.** Scan the range for the words
a breaking change tends to carry, in subjects and bodies, and new migration
files for a dropped column:

    git log "$LAST_TAG"..origin/preprod --format='%h %s%n%b' \
      | grep -inE '!:|BREAKING|\bdrop\b|\bremove\b|\bretire\b'
    for f in $(git diff --name-only --diff-filter=A "$LAST_TAG" origin/preprod -- migrations drizzle); do
      git show "origin/preprod:$f" | grep -in 'DROP COLUMN' | sed "s|^|$f:|"
    done

Any hit proposes `minor` while the current version is below 1.0 and `major`
from 1.0 on; no hit proposes `patch`. The proposal quotes every matching
line, so the reader judges the words and not the grep. The type is then
settled in this order: a type named in the invocation wins; otherwise the
proposal stands under `--quick`, under `--ship`, and wherever step 4 asks
nothing; otherwise step 4's question carries the proposal with its quoted
lines and the answer may change it. Store the result as `$NEW_VERSION`.

### 3. Compute the blast radius

**Do this on every run, from every branch, including under `--quick` and
`--ship`.** This is the step that answers "what am I actually shipping", and
the answer is almost never "my feature".

    git log "$LAST_TAG"..origin/preprod --oneline

That range is everything already queued on `preprod` for the next release.
Group it by the pull request each commit merged in and count it. The merge
commits carry the PR number in their subject and the author is the second
parent's, so no API call is needed:

    git log "$LAST_TAG"..origin/preprod --merges --format='%h %s' \
      | while read -r sha subject; do
          echo "$subject :: $(git log -1 --format=%an "$sha^2")"
        done

If that returns nothing, the repo squash-merges: fall back to the `(#NN)`
reference and `%an` of each commit, and where even that is absent, list the
commits ungrouped. An empty grouping must never read as an empty blast
radius, and never report "no pull requests". In the unlanded case, add this
feature's own commits, which are not in that range yet (`git log
origin/preprod..HEAD`, fetched in step 1).

Present the two groups **distinctly labelled**, because they carry different
risk: **Yours**, the commits from this session, which you know the state of;
and **Riding along**, everything else in the range, merged by someone else,
which you are shipping to production whether or not you have looked at it.
Name each PR and its author. Then a one-line count: "N commits across M pull
requests, K of them yours." If both groups are empty, abort with: "Nothing
to release: preprod and main are at the same point."

Hold this report. Step 4 uses it as the body of the question, and step 10
prints it in the summary whether or not step 4 ran.

### 4. Confirm, unless `--quick` or unattended

Skip this step entirely in three cases:

1. `--quick` was passed: the user asserting they have already thought about
   what this ships. It takes step 2's proposal and never skips step 3's report.
2. **The run is unattended under authority form 1 or form 3**: a
   `/feature --ship` run reached this skill, or `.harness-version` carries
   `agent-authority: release`. The `## Authority` section above is where that
   is settled; there is nobody to ask, and the flag or the grant already
   answered. Say in the reply that the question was skipped and why, and
   record it.
3. The situation is `preprod` or landed-feature with nothing riding along that
   the user has not already seen.

Otherwise ask exactly one question with `AskUserQuestion`, with the step 3
report and step 2's bump proposal as its body. In the **unlanded** case, the
question names the whole path explicitly: this takes the feature from its
branch, to `preprod`, to `main`, and tags a release, in one command; the
merge to `preprod` happens first and everything riding along ships with it.
In the **preprod** and **landed** cases, ask only when something is riding
along: "this ships N commits you did not write, listed above". A release of
only your own reviewed work needs no question. If the user declines, stop.
Do not offer a partial release; there is no such thing.

**Step 3's report is produced and reported whatever happens here.** Skipping
the question never skips the blast radius: the whole of `LAST_TAG..preprod`
goes in the reply, and in the feature context when `/feature` chained here, so
the decision is auditable even when nobody made it in the moment.

### 5. Unlanded case only: run the merge, then settle

Skip this step entirely in the `preprod` and landed-feature cases. The
feature has to reach `preprod` before it can reach `main`, and where a
changelog accumulator exists, its entry has to land before the release can be
composed from it.

**Run the merge by following the merge skill's own file:**

Read `.claude/skills/to-preprod/SKILL.md` and work its steps in order.

That means all of them: resolve the feature name, merge `preprod` in and
resolve conflicts with its discipline, run the docs-updater agent, retire the
feature context, write `.pr-description.md`, push the branch, then push the
signal file. Do not reimplement any of it here; a second copy would drift
from the first. Following a user-invoked skill's file is deliberate and is
recorded in a forge decision record; the authorization for THIS step is the
authority checked at the top of this file, which the run already satisfied,
and step 4's question, where it ran, was about the blast radius and not
about permission.

**Then wait for the merge to land.** Poll every 10 s, capped at about ten
minutes:

    git fetch origin preprod
    git merge-base --is-ancestor <the merge commit> origin/preprod

**Then settle, only where the accumulator exists**
(`test -f .github/workflows/harness-version-bump.yml`). It fires on the same
merge and appends that merge's prose to `## [Unreleased]` in its own
`[changelog]` commit a moment later, so a changelog read before it lands is
missing the very feature this release is being cut for. Wait for that
specific commit: poll `git fetch origin preprod` every 10 s, capped at 5
minutes, until this succeeds:

    git log <the merge commit>..origin/preprod --format=%s | grep -q '\[changelog\]'

Where the workflow is absent there is nothing to wait for: continue at once.

**On timeout, stop.** Say plainly which of these happened, and that no
release was cut either way: the merge landed but the `[changelog]` commit
never did (re-run `/release` from `preprod` once the accumulator has run; the
feature is safe on `preprod`, only the release is outstanding), or the merge
never landed (the to-preprod workflow has not finished or has failed; point at
its recovery section, "If the workflow fails" in the merge skill, which owns
that diagnosis). Do not push a release after a timeout on the assumption it
will be fine.

**Recompute from the landed tip.** Everything after this step reads
`origin/preprod` again. The blast radius from step 3 was measured before the
merge, so the feature's commits have moved from "yours, not yet on preprod"
into the range itself; say so when you print it in step 10 rather than
showing a stale split.

### 6. Categorize the commits

Categorize the commit subjects into **Features** (containing "feat", "add",
"new"), **Fixes** ("fix", "bug", "patch") and **Improvements** (everything
else). Keep it concise; subject lines only. Steps 7 and 8 use the result.

### 7. Build the new CHANGELOG.md content

**Skip this whole step when something else stamps the changelog, and say in one
line that you skipped it and why.** Two shapes qualify: step 2's accumulator
(`harness-version-bump.yml` plus `VERSION`) filling `## [Unreleased]` for
`release.yml` to stamp; or a `release.yml` whose own step rewrites
`## [Unreleased]` to the release version and runs here (read its `if:`: the
shipped step needs `VERSION` and `scripts/release-identity.mjs` both, so one of
them alone still composes). Composing here is how three releases lost theirs.

Otherwise, read the current file from preprod, in case the working tree is
stale or the file does not exist locally (`git show
origin/preprod:CHANGELOG.md 2>/dev/null || echo ""`). If it returned content,
prepend the new release section after the `# Changelog` heading; if empty,
build a fresh file with the heading. The section is `## [v1.3.0] -
YYYY-MM-DD` followed by step 6's categories as `### Features`, `### Fixes`,
`### Improvements`, one bullet per commit with its `(#NN)`. Hold the full new
content in memory as `$CHANGELOG_CONTENT`; step 9 writes it into the release
commit.

### 7b. Generate the downstream release note

**Skip this step entirely where `release-notes/` or
`scripts/release-notes-brief.mjs` is absent.** Only the authoring repo
publishes to a template repo; a downstream project has neither, and this
step is written to disappear there rather than to be deleted. Where they
exist the note is **required** (`release.yml` fails the release without
`release-notes/$NEW_VERSION.md`): read `RELEASE-NOTE.md` beside this file and
work it in order. It drafts, validates and accepts the note; step 9 carries
the file it produces.

### 8. Build `.release-description.md` content

This is a single signal file at the repo root (NOT `.pr-description.md`).
Hold its content in memory as `$RELEASE_DESC_CONTENT`; the body after the
front matter is step 6's categorized list under `## Release v1.3.0`:

    ---
    version: v1.3.0
    type: minor
    cleanup-branch: claude/<name>
    ---

    ## Release v1.3.0

    ### Features
    - Dark mode toggle (#45)

The `cleanup-branch:` key names the `claude/` branch when the chain ran from
one (step 5). `release.yml` parses it and deletes the branch server-side
with the harness PAT, which is the only deletion path that works from inside
the sandbox. Omit the key entirely in the `preprod` and landed-feature cases;
there is no orphan to clean up.

### 9. Push the release commit to preprod

The commit carries, always, `.release-description.md` (step 8); plus
`release-notes/<version>.md` whenever step 7b ran (the release fails without
it); plus `CHANGELOG.md` when step 7 composed one. Its message is
`chore: release $NEW_VERSION`. **Never push `VERSION` from here.**
`release.yml` writes it, the migration and the changelog stamp in one commit,
from the version in the signal file; pushing it here as well would give one
number two owners, which is the failure that rule exists to prevent.

**Try the direct path first, with a dry run.** Build the commit in a
throwaway worktree on `origin/preprod`, so the session's branch and working
tree never change, then ask the remote whether it would take the push:

    WT=$(mktemp -d) && git worktree add --detach "$WT" origin/preprod
    (cd "$WT" && <write the files above> && git add -A && git commit -q -m "chore: release $NEW_VERSION")
    git -C "$WT" push --dry-run origin HEAD:refs/heads/preprod

**On success, push for real:** `git -C "$WT" push origin HEAD:refs/heads/preprod`.

**On refusal, push through the GitHub API instead.** In the harness sandbox,
`origin` is a local git proxy that allows pushes only to the session's own
`claude/<branch>`; a push to `preprod` is rejected with HTTP 403, and the dry
run learns that before anything is sent. Call `mcp__github__push_files` with
`owner` and `repo` from step 1, `branch` `preprod`, the message above, and
`files` holding the same paths and contents; it creates a single commit on
`origin/preprod` and modifies nothing locally. If it returns an error,
surface the error and stop; the direct push was refused already, so there is
nothing to retry.

Either way, remove the worktree, then fetch so the new commit is visible:

    git worktree remove --force "$WT"
    git fetch origin preprod
    git log origin/preprod -1 --oneline

The latest commit should be `chore: release $NEW_VERSION`. **Remember which
path took the push**; step 10 reports it.

### 10. Inform the user

Tell the user:
- Which path pushed the release commit to `preprod`: the direct push, or
  `mcp__github__push_files` after the dry run was refused.
- The `release.yml` workflow will now merge `preprod` onto `main` with
  `--no-ff` (a PR, gated by any required checks, only if that push is
  refused), tag `$NEW_VERSION`, create a GitHub Release, fast-forward `preprod`.
- The version number, the bump type and why (step 2's quoted lines when
  there were any), and key changes.
- **Print the step 3 blast-radius report**, whether or not step 4 asked
  anything. `--quick` and `--ship` skip the question, never the record:
  after the fact, "what shipped" has to be answerable.
- That step 10b follows, so the session stays open until production serves
  the release, then closes the work items it shipped.

### 10b. Land the release and close the changes

**Every release, connected or not.** Read `LANDING.md` beside this file and
work it in order: wait for `main` to carry the release, verify production
with `verify-deploy.sh` (only `deploy-verified:` or `deploy-equivalent:`
continues), find the change keys in the PR bodies, run `CONNECTED.md` when
`.harness-version` has a non-empty `spec_product:` line, close each change's
work item, and carry its items in the closing block. A release production
does not yet serve closes nothing.

### 11. Best-effort orphan branch cleanup

**`cleanup-branch:` does the `claude/` branch already.** When step 8 wrote
that key, `release.yml` deletes that branch server-side with the harness
PAT once the release lands. This step is about what is left over, and about
the case where no key was written: a `claude/<name>` session creates a
`feature/<name>` branch and Railway environment only once it pushes (the
slug commit from `set-feature-name.sh`, or any code push), and
`claude-to-feature-branch.yml` then normally deletes the source
`claude/<name>` branch. The release skill bypasses that chain, so if such a
branch exists neither cleanup is guaranteed to have happened. Deleting the
remote `feature/<name>` branch (when it succeeds) triggers
`feature-branch-cleanup.yml`, which removes any associated Railway
environment automatically. Attempt deletion, but treat it as best-effort:

    if [[ "$CURRENT_BRANCH" == claude/* ]]; then
      FEATURE_NAME=$(bash .claude/scripts/resolve-feature-name.sh "$CURRENT_BRANCH")
      git push origin --delete "feature/$FEATURE_NAME" 2>/dev/null || true
      git push origin --delete "$CURRENT_BRANCH" 2>/dev/null || true
    fi

**Harness limitation:** the local git proxy rejects deletes of branches it
does not consider session-owned (HTTP 403), and there is no GitHub-MCP tool
for deleting a branch, so expect these deletes to fail in the sandbox. What
to tell the user then depends on step 8: if `cleanup-branch:` was written,
the `claude/` branch is the workflow's problem now and needs no mention; say
only that `feature/<name>` may linger. If it was not (the `preprod` and
landed-feature cases), the orphan branches may need cleaning up by hand on
GitHub, or will be cleaned up by the workflows that respond to the preprod
push.

The working tree must be clean when the skill exits; step 9 built the
release commit in a worktree, so revert anything still modified:

    git checkout -- CHANGELOG.md VERSION 2>/dev/null || true
    rm -f .release-description.md
