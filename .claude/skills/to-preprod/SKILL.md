---
name: to-preprod
description: Merge the current feature branch into preprod, the gate before production. Use when the user says "merge to preprod", "ship it to the gate", or invokes /to-preprod.
argument-hint: "[optional: PR title]"
allowed-tools: Bash(git *), Bash(bash .claude/scripts/*), Bash(node scripts/*), Read, Write, Glob, Grep
---

# To preprod

## The invocation

```text
$ARGUMENTS
```

Read `CONNECTED.md` beside this file when `.harness-version` has a `spec_product:` line. Otherwise
it does not apply and is not read.

Take the current feature through the gate: `preprod` is the branch between feature branches and
production, where a built and tested feature waits until a release promotes it to `main`. This
skill merges nothing itself. It writes the `.pr-description.md` signal file, commits it
with the feature context's retirement, and pushes once; `claude-to-preprod.yml` opens the PR and
auto-merges it. It is also how a `/review` PR lands after humans approve it: the workflow reuses the
open PR, so run `/to-preprod` rather than clicking the GitHub merge button.

## Authority

**A session may complete this skill alone, and should.** It reaches no production surface: the
signal push hands the work to a GitHub Action that auto-merges into `preprod`, the branch before
production and not production. Nothing here needs a grant in `.harness-version`, and nothing here
checks for one. A session that did the work is the right thing to file it: having reached this skill
legitimately, finish it; do not stop to ask a person to run it for you (a forge decision record).

## The closing block

Every reply carries one, per the contract in `getting-started` (Step 3b). Here it carries the merge:

- `Good to know`: what the signal push set in motion on the remote (the PR, the auto-merge, the
  branch deletions that follow) and the docs verdict. Connected: `CONNECTED.md` adds the gate's result.
- `Act later`: anything this merge deliberately left undone, naming where it should be done.
- `Act next`: what the user must watch or do now, and plainly whether this session is finished with
  them. If the workflow is still running, say that is what it waits on.

Run inside `/feature` phase 5, this skill contributes those items into that block, never a second one.

## Steps

### 1. Determine the feature name

    BRANCH=$(git branch --show-current)
    FEATURE_NAME=$(bash .claude/scripts/resolve-feature-name.sh "$BRANCH")
    FEATURE_BRANCH="feature/$FEATURE_NAME"

This prefers the slug in `.harness-feature` (set via `set-feature-name.sh`) and falls back to the
random session codename, matching the workflows.

**If `.harness-feature` is gone but the session named its feature** (a `chore: set feature name
(<slug>)` commit in `git log origin/preprod..HEAD`, or a feature context under that slug), restore
it before anything is pushed, and without a push of its own:

    bash .claude/scripts/set-feature-name.sh --no-push <slug>

`--no-push` matters on Railway: a naming push provisions an environment (the one the workflow tore
down when the PR opened); the signal push is one provisioning skips. A naming commit that arrived
with someone else's branch is not yours to restore; name this session's own feature instead. The
usual way to lose the name is merging `feature/<name>` back into this branch after its PR opened:
the workflow stripped the signal files from it, and the merge carries the deletion across. The
workflows refuse a push that lost its name rather than open `feature/<codename>` (and, on Railway,
an environment) beside the real branch.

### 2. Gather all changes and sync with preprod

Fetch and diff against preprod to see what is going through the gate, including the commits already
on `feature/<name>` if that branch exists:

    git fetch origin preprod
    git log origin/preprod..HEAD --oneline
    git diff origin/preprod..HEAD --stat
    git fetch origin "$FEATURE_BRANCH" 2>/dev/null
    git log origin/preprod..origin/"$FEATURE_BRANCH" --oneline 2>/dev/null

Review ALL changes (not just the latest commit) to write an accurate PR description.

**Pre-empt merge conflicts with preprod.** If `preprod` has advanced in a conflicting way, the PR
cannot merge and the workflow leaves it open. Merge `preprod` into the current branch now so any
conflict surfaces here, where you can resolve it:

    git merge origin/preprod --no-edit

A clean merge continues. A conflict is resolved with the discipline below, never aborted.

#### Resolving conflicts

This section is the harness's one home for merge-conflict discipline; `/feature` phase 0 and
`/continue` point here when their resume merges conflict.

1. **See the state.** List the conflicted files (`git diff --name-only --diff-filter=U`), and read
   the surrounding history so you know what each side was doing.
2. **Find the primary sources for each conflict.** Understand why each side changed: read the commit
   messages, the PRs, and the originating spec or ticket issues (per `docs/agents/issue-tracker.md`).
   Do not resolve a hunk whose intent you have not established.
3. **Resolve each hunk.** Preserve both intents where possible. Where they are incompatible, pick the
   side matching this merge's stated goal and note the trade-off. Do not invent new behaviour in a
   resolution. For generated and lock files, prefer the `preprod` version and regenerate. Signal
   files (`.harness-feature`, `.pr-description.md`) are the opposite: keep this branch's version; a
   copy that reached `preprod` belongs to another session. Always resolve; never `--abort`.
4. **Run the checks.** Run the `check:` command from `.harness-version` (or the project's typecheck
   and tests) and fix anything the merge broke.
5. **Finish.** Stage each resolved file by name (never `-A`) and complete the merge:

       git add <each file from step 1>
       git commit --no-edit

In your final message note which files conflicted and how you resolved each one; a clean merge
needs no mention. If a conflict is genuinely ambiguous and you cannot resolve it safely (two
incompatible intents in the same hunk), stop and ask the user instead of guessing.

**Sweep leaked feature contexts.** If the merge from preprod brought in any
`.harness/feature-context/*.md` or `.harness/journey/*.md` for *other* features (leaked past a merge
that bypassed this skill and the cleanup workflow), delete them now; the deletion rides along.

**Check the ADR numbers after the merge.** A duplicated ADR number is a conflict git cannot see: two
branches that each wrote a record without claiming its number pick the same one, and the merge
above is clean either way. Ask:

    bash .claude/scripts/coordination.sh adr-collisions "$FEATURE_BRANCH"

Silence means every record this branch adds has a number of its own. Each `ADR NNNN:` line names
one of this branch's records and the record that already holds the number. A record on `preprod`,
or one another feature claimed, keeps its number; against another in-flight branch, the branch that
finds the collision moves (it has a session in front of it):

1. Claim a new number exactly as `/document` Mode A step 1 does.
2. `git mv docs/decisions/<old>-<slug>.md docs/decisions/<new>-<slug>.md`, and change the number in
   the record's title line.
3. Change every citation this branch added, and only those:
   `git diff -U0 origin/preprod...HEAD | grep -E '^(\+\+\+ |\+.*<old>)'` lists them. A citation of
   `<old>` on a line this branch did not add is the other record's: leave it. A link names the file,
   so it takes the new filename.
4. Move the record's row in `docs/README.md` to the new number.
5. Run the checks. `check-docs.mjs` refuses a number still shared and a citation left dangling.

Say in the final message which record moved, and from which number to which.

### 3. Run the docs audit

The audit runs once per diff, so read the feature context (`.harness/feature-context/$FEATURE_NAME.md`)
first:

- **It has a `## Docs verdict` line**: `/feature` phase 4 audited this diff. Carry that verdict into
  the PR body (step 5) and skip the rest of this step.
- **It has none** (this skill was invoked outside `/feature`): scope the audit with the checker, then
  run the agent only when there is scope.

      node scripts/check-docs.mjs --diff origin/preprod

  When it prints `nothing`, the verdict is `nothing to update`: carry it into the PR body and skip
  the agent. Otherwise launch the docs-updater agent with the Agent tool, pasting the checker's
  output verbatim as its scope, so the documentation lands in the same merge as the code:

      Launch the docs-updater agent with prompt:
      "Delta audit for a merge to preprod. Base is origin/preprod.

       ## Scope (from check-docs --diff)

       <the checker's output, every line>"

  Wait for it to finish. If it committed documentation changes, they ride in this merge.

Either way, act on the two parts of a report that are not self-resolving. **Checker errors**: fix
them now; when `node scripts/check-docs.mjs` is in the `check:` line of `.harness-version` they fail
the merge gate anyway. **"Needs you"** (a suggested ADR, an over-budget doc, a conflict it could not
resolve): handle it, or carry it into the PR body under `## Docs` so it is visible after the merge.

### 4. Consume the feature context

Read `.harness/feature-context/$FEATURE_NAME.md` (contract in `.claude/HARNESS.md`) if it exists. It
is the input for the PR description: the decisions, rejections, scope boundary, docs verdict and
work item it records belong in the body below; the docs audit above promoted anything permanent.

### 4b. Run the preprod gate

Connected: see `CONNECTED.md`, "The preprod gate" (it also says what the context holds for the
gate). Dormant, there is no gate here and nothing about one is mentioned to the user.

### 4c. Retire the touched set

Stage the deletion of this feature's journey file, for step 6's signal commit to carry:

    bash .claude/scripts/journey.sh retire

That push starts `journey-sync.yml`, which deletes the record on `coordination`; no MCP call. The
declaration exists only while the branch does: once this merges, GitHub owns the code, and the
journey position ends at `built` (`.claude/JOURNEY.md`). A `journey:` line (no file on this
branch, say) is advisory: say it and carry on; the next `/feature` session sweeps any record left
behind. Nothing here is worth stalling a merge for.

### 5. Write `.pr-description.md`

Create `.pr-description.md` at the repo root. If the invocation carries a title, use it as the PR
title; otherwise generate a concise one from the changes. The front matter is read line by line,
not parsed as YAML: write the title unquoted, even when it carries a colon (`title: MYPR-6: the bot
look`); the workflow strips one surrounding pair of quotes and takes the rest verbatim, escapes
included. The `Why:` line points at the work item, whose `## Why` is written once and never re-typed.

    ---
    title: Short PR title (under 70 characters)
    ---

    Why: <work item URL>

    ## Summary
    - 3-5 bullet points explaining what changed

    ## Spec
    - The change key and work item, `<KEY>: <title>` (#N), which /release closes once production
      serves it; then the spec issue, if any. Connected: CONNECTED.md, "The PR body", adds three.

    ## Code review findings
    - The /code-review findings from the end of /feature phase 4, with anything deliberately
      not addressed and why. Omit only if /code-review never ran.

    ## Docs
    - The docs verdict (step 3) and anything left under "Needs you"; omit when neither says anything.

    ## What's new
    - User-facing changes described in plain language

    ## Technical changes
    - Key implementation details, files changed, architectural decisions

    ## How to test
    - Steps to verify the feature works correctly

### 6. Commit and push, once

If the branch carries unpushed commits (`git log origin/"$BRANCH"..HEAD`, or no remote branch yet),
push them first: code beside the signal starts `claude-to-feature-branch.yml` too, whose bot-token
merge can land on the stripped head and cost the gate a recovery round. A `/feature` run pushed at
the end of phase 5, so there is normally nothing to push here.

Then retire the context and add the signal in ONE commit, beside the journey file's staged deletion
(step 4c). None passes the gate: the context and the journey file live only while the feature is in
flight, and `.pr-description.md` is in `.gitignore`, hence the `-f`. Stage by path, never `-A`:

    git rm --quiet --ignore-unmatch .harness/feature-context/"$FEATURE_NAME".md
    git add -f .pr-description.md
    git commit -m "chore: trigger auto-merge to preprod"
    git push -u origin "$BRANCH"

No check run starts on this push: all three paths are `paths-ignore`d by `feature-branch-checks.yml`,
so the pull request's one run is the gate; `journey-sync.yml` starts and deletes the record.
`claude-to-feature-branch.yml` still merges the commit into `feature/`, racing the gate's own merge;
both retry and stop once the commit is in, by design.
Connected: see `CONNECTED.md`, "The signal commit".

### 7. Inform the user

- The auto-merge has been triggered: the Action merges this push into `feature/<name>`, strips the
  signal files, opens a PR to `preprod` (or reuses the open `/review` PR), gates on CI, merges and
  cleans the feature branch up afterwards.
- Which files conflicted with `preprod` in step 2, and how each was resolved. (If the workflow
  still cannot merge, it leaves a comment on the PR with manual steps.)
- They can stay in this chat and chain `/release` once the merge lands; it works on `preprod` and
  never re-pushes the `claude/` branch, so it re-triggers nothing here. Next time, `/release` on its
  own would have done both (one confirmation, this procedure, a wait for `preprod` to settle, then
  the ship). Mention it once, as an option; it is a bigger act than a merge and stays the user's call.

### 8. If the workflow fails

Open the Actions tab and find the run titled "Merge feature branch to preprod (to-preprod)"
triggered by the `claude/<branch>` push; the recovery depends on where it broke.

**A recovery push re-triggers the workflow only if it changes `.pr-description.md`.** The workflow
starts on a push whose diff touches that file and on no other: a push that fixes the problem but
leaves the signal file as it was merges into `feature/<name>` and never reaches the PR. So every
recovery below ends the same way: record what the recovery was in the body of `.pr-description.md`
(step 7 reports it anyway), then commit and push it exactly as step 6 does, message included:

    git add -f .pr-description.md
    git commit -m "chore: trigger auto-merge to preprod"
    git push -u origin "$BRANCH"

The message is part of the contract: on Railway it keeps the recovery push from provisioning a
preview environment again. The workflow reuses the open PR and strips the signal files again.

| Failure | Recovery |
|---|---|
| **PR opened but did not merge: it conflicts with `preprod`** (`preprod` moved after the signal push) | Recover here, on this `claude/` branch: `git fetch origin preprod && git merge origin/preprod`, resolve with the discipline in step 2, run the checks, re-trigger as above. **Never merge `origin/feature/<name>` into this branch to recover**: the workflow stripped the signal files from it when it opened the PR, and the merge carries the deletion across, `.harness-feature` included (step 1 restores the name) |
| **"The PR head cannot produce a CI check"** (a bot-pushed head, often the Railway URL publish landing on top of the strip) | Re-trigger as above: the run re-strips the signal files as a PAT push, which starts a real check, and merges on its green. Pushing the head again by any other route starts a check and nothing that merges |
| **Workflow run failed mid-step** (e.g. a transient git push race) | Re-trigger as above. If the remote `claude/` branch was already deleted, the push creates a fresh branch and restarts the chain; the workflow is idempotent, so re-runs duplicate nothing |
| **A push already created a stray `feature/<codename>` branch** (and, on Railway, an environment) | A session cannot delete it: the git proxy refuses every branch but its own. Dispatch `feature-branch-remove.yml` with `mcp__github__actions_run_trigger` (method `run_workflow`, ref `preprod`, inputs `{"branch": "feature/<codename>"}`). It refuses a branch with an open PR or a touched-set record, so close such a PR first |
| **PR did not open at all** (the workflow errored before PR creation) | Read the failed step's logs. Most common cause: a missing or empty `PAT_TOKEN` secret, reported by an `::error::PAT_TOKEN is missing or empty...` annotation pointing at Settings → Secrets and variables → Actions; the PAT needs `repo` and `workflow` scopes (or fine-grained: Contents r/w, Pull requests r/w, Workflows r/w). Another cause: branch protection on `preprod` requiring explicit reviewers. Add what is missing, then re-trigger as above: the branch was left stripped with no PR, and the recovery push re-adds the signal so the next run strips and opens again |

Do not confuse the recovery push with the `CLAUDE.md` gotcha: that one is about post-success pushes.

### 9. Update memory files if warranted

Broadly useful lessons (a new convention, a gotcha) go into CLAUDE.md; feature-specific WIP notes do not.
