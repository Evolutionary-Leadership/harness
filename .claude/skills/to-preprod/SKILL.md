---
name: to-preprod
description: Merge the current feature branch into preprod, the gate before production. Use when the user says "merge to preprod", "ship it to the gate", or invokes /to-preprod.
disable-model-invocation: true
argument-hint: "[optional: PR title]"
allowed-tools: Bash(git *), Bash(bash .claude/scripts/*), Bash(node scripts/*), Read, Write, Glob, Grep
---

# To preprod

Take the current feature through the gate. `preprod` is the branch between
feature branches and production: a feature that has been built
and tested waits there until a release promotes it to `main`.

This skill does not merge anything itself. It writes the `.pr-description.md`
signal file, commits it, and pushes; the GitHub Action picks the signal up and
handles PR creation and auto-merge.

It is also how a `/review` PR lands after humans approve it. The workflow
reuses the open PR instead of opening a second one, so run `/to-preprod`
rather than clicking the GitHub merge button.

## The closing block

Every reply carries one, per the contract in `getting-started`. Here it
carries the merge:

- `Good to know`: what the signal push set in motion on the remote (the PR
  the Action opens, the auto-merge, the branch deletions that follow), the
  docs audit result, and, where the spec loop is connected, the preprod
  gate's result (how many drifted rows, each covered by which proposal).
- `Act later`: anything this merge deliberately left undone, naming where it
  should be done.
- `Act next`: what the user must watch or do now, and plainly whether this
  session is finished with them. If the workflow is still running, say that
  is what `Act next` is waiting on.

Run inside `/feature` phase 5, this skill contributes those items into that
skill's block rather than emitting a second one.

## Steps

### 1. Determine the feature name

    BRANCH=$(git branch --show-current)
    FEATURE_NAME=$(bash .claude/scripts/resolve-feature-name.sh "$BRANCH")
    FEATURE_BRANCH="feature/$FEATURE_NAME"

This prefers the slug in `.harness-feature` (set via `set-feature-name.sh`)
and falls back to the random session codename, matching the workflows.

### 2. Gather all changes and sync with preprod

Fetch and diff against preprod to understand what is going through the gate:

    git fetch origin preprod
    git log origin/preprod..HEAD --oneline
    git diff origin/preprod..HEAD --stat

Also check if a `feature/<name>` branch exists and include its commits:

    git fetch origin feature/<name> 2>/dev/null
    git log origin/preprod..origin/feature/<name> --oneline 2>/dev/null

Review ALL changes (not just the latest commit) to write an accurate PR
description.

**Pre-empt merge conflicts with preprod.** The workflow merges this branch
into `preprod` through the PR; if `preprod` has advanced in a conflicting way,
the PR cannot merge and the workflow leaves it open. Merge `preprod` into the
current branch now so any conflict surfaces here, where you can resolve it,
instead of stalling the PR:

    git merge origin/preprod --no-edit

If the merge succeeds cleanly, continue. If it reports conflicts, resolve
them with the discipline below rather than aborting.

#### Resolving conflicts

This section is the harness's one home for merge-conflict discipline;
`/feature` phase 0 and `/continue` point here when their resume merges
conflict.

1. **See the state.** List the conflicted files
   (`git diff --name-only --diff-filter=U`), and read the surrounding
   history so you know what each side was doing.
2. **Find the primary sources for each conflict.** Understand why each
   side changed: read the commit messages, the PRs, and the originating
   spec or ticket issues (per `docs/agents/issue-tracker.md`). Do not
   resolve a hunk whose intent you have not established.
3. **Resolve each hunk.** Preserve both intents where possible. Where
   they are incompatible, pick the side matching this merge's stated goal
   and note the trade-off. Do not invent new behaviour in a resolution.
   For generated, lock, or signal files, prefer the `preprod` version. Always
   resolve; never `--abort`.
4. **Run the checks.** Run the `check:` command from `.harness-version`
   (or the project's typecheck and tests) and fix anything the merge
   broke.
5. **Finish.** Stage everything and complete the merge:

       git add -A
       git commit --no-edit

After resolving, remember what you changed: in your final message to the
user note which files conflicted and how you resolved each one. A clean
merge needs no mention. If a conflict is genuinely ambiguous and you
cannot resolve it safely (two incompatible intents in the same hunk),
stop and ask the user instead of guessing.

**Sweep leaked feature contexts.** If the merge from preprod brought in any
`.harness/feature-context/*.md` for *other* features (leaked past a merge
that bypassed this skill and the cleanup workflow), delete them now; the
deletion rides along with this merge.

### 3. Run docs-updater agent

Before writing the PR description, launch the docs-updater agent so the
documentation lands in the same merge as the code. Use the Agent tool:

    Launch the docs-updater agent with prompt:
    "Delta audit for a merge to preprod. Base is origin/preprod.
     Read docs/README.md as the manifest and route every finding through it.
     Enforce architecture `sources:` globs against the changed paths, verify
     surface-table counts, treat docs/decisions/ as append-only, and flag any
     doc over its budget instead of adding prose. Run
     scripts/check-docs.mjs if it exists."

Wait for the agent to complete. If it committed documentation changes, those
changes will be included in the merge automatically.

Act on the two parts of its report that are not self-resolving:

- **Checker errors**: fix them now. If `node scripts/check-docs.mjs` is in
  the `check:` line of `.harness-version`, they will fail the merge gate
  anyway; fixing them here saves a round trip.
- **"Needs you"**: a suggested ADR, an over-budget doc, or a conflict it
  could not resolve. Handle it, or carry it into the PR description under a
  **Docs** heading so it is visible after the merge. Do not drop it silently.

### 4. Consume the feature context

Read `.harness/feature-context/$FEATURE_NAME.md` (contract in
`.claude/HARNESS.md`) if it exists. It is the input for the PR
description: the decisions, rejections, and scope boundary it records
belong in the body below, and the docs audit above should have promoted
anything permanent into `docs/`.

**(connected)** Also hold its `## Spec verdicts` table, its `## Suspect rows`
table and its change key (the Tracker section): step 4b gates on the first
and step 5 copies all three into the PR body, and the file is deleted in 4c.

A suspect row is a `drifted` verdict the judge could not evidence
(`.claude/SPEC-LOOP.md`, the judge section). It never gates
anything and never becomes a claim, so the gate below does not read it; it
goes into the PR body because the context that held it is about to be
deleted, and a person still has to see it.

### 4b. Run the preprod gate **(connected)**

**This step forks on one key.** Read it first:

    SPEC_PRODUCT=$(sed -n 's/^spec_product: *//p' .harness-version | tail -1)

**Empty or absent: skip this whole step and go to 4c.** This repository has
not connected a specification, there are no verdicts to gate on, and nothing
about the loop is mentioned to the user. The rest of this step is the
connected shape.

The gate refuses a merge that carries drift **the branch itself introduced**
and nobody decided. It does not refuse drift that was already recorded before
the branch existed: an audit of an existing product routinely records dozens
of drifted criteria at once, and gating on those stops merges that never
touched them.

It has two modes, and both compute the same rows and print the same words:

| Mode | What it does with a row that would stop the merge |
|---|---|
| `evaluate` | Prints it in full, under the same heading, and merges anyway |
| `enforce` | Prints it in full, under the same heading, and stops |

The mode is `gate-mode:` in `.harness-version`; an absent key reads
`evaluate`. A feature context may **tighten** it to `enforce` for one branch
and may never loosen it, because a branch that can switch off the gate it is
failing is not a gate. Say which file the mode came from before anything else.

**Read the change's proposals and the baseline.** The baseline is not a new
artifact: Spec Universe already records conformance per criterion, and
`/release` refreshes it at every release, so the record IS the state as of the
last release. Read it live, one call per distinct node carrying a `drifted`
row:

    SU="bash .claude/scripts/spec-universe.sh"
    KEY=<the change key, from .harness-feature or the context's Tracker section>
    $SU change-proposals "$KEY"                 > /tmp/proposals.json
    for NODE in <every node with a drifted row>; do $SU node "$NODE"; done \
      | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.stringify(s.trim().split(/(?<=})\s*(?={)/).map(JSON.parse))))' \
      > /tmp/nodes.json

**Any non-zero exit from the client stops the merge in BOTH modes** and writes
no signal file, because a gate cannot pass on a specification it could not
read. Report what the client printed;
`.claude/SPEC-LOOP.md` tells the three faults apart. The mode
governs drift tolerance and nothing else.

If the verdict table is missing and the branch changes anything under the
domain roots, run `/code-review` now (fixed point `origin/preprod`) rather
than merging unjudged; a branch that touches no domain file passes the gate
vacuously, and the PR body says so.

**Run the gate.** The classification and the copy live in the script, so the
two modes cannot drift apart in wording:

    node scripts/gate-run.mjs --key="$KEY" \
      --verdicts=.harness/feature-context/"$FEATURE_NAME".md \
      --nodes=/tmp/nodes.json --proposals=/tmp/proposals.json \
      --head-sha="$(git rev-parse HEAD)" \
      --merge-base="$(git merge-base origin/preprod HEAD)" \
      --branch="$FEATURE_BRANCH" --work-item=<the work item URL>

Report its output verbatim. Exit `1` means the merge stops: end the skill here,
before step 4c, with nothing retired and nothing pushed. Exit `2` is a
configuration fault in the mode or a missing key; fix it and run again.

How it classifies, so a reader of the report knows what they are looking at:

| Recorded conformance | Baseline | A `drifted` row on it |
|---|---|---|
| `drifted` | `known` | reported, never blocks: the branch did not cause it |
| `matched` | `matched` | **new drift**, and it blocks under `enforce` |
| absent, or anything else | `pending` | an absence, not a regression, never blocks |

A row judged against a proposal is always new drift: the proposed text has no
prior conformance record to have drifted from. `unverifiable` rows never block
and go into the PR body under `Act later` as anchors to repair. New drift is
covered, and so does not block, by an `accepted` or `promoted` proposal under
the change key whose node is that row's node; a `draft` or `declined` proposal
and no proposal at all each block, naming the one missing piece.

**One row is exempt from the mode and stops in both.** A proposal on a node
whose effective strictness is `legal` or `contractual`, accepted by an identity
that is not a `user`, stops the merge under `evaluate` too: Spec Universe
refuses that acceptance over MCP and `/v1`, so it is a security control and not
drift. The script marks it `[stops in both modes]`.

Every stop names exactly one missing piece and one deep link
(`{SPEC_UNIVERSE_URL}/nodes/<node key>` for a proposal to decide,
`{SPEC_UNIVERSE_URL}/changes/<KEY>` for the change as a whole).

**Record the run.** The script writes `.harness/gate-runs/<KEY>-<n>.json`,
which is COMMITTED and reaches `preprod`: it is the ledger the false-drift rate
is computed from after ten features, and a ledger that dies at the merge is no
ledger. Post the same rows as one comment on the change's work item, asking in
one line for the disposition (`true-drift` where the row was a real regression,
`false-drift` where it was not), and re-run the command with
`--disposition-url=<that comment's URL>` so the record points at where the
answer will be written. Commit the record with the context retirement in 4c.

### 4c. Retire the feature context, and keep any run record

Delete the context, and commit the gate run alongside it where there is one:

    git rm .harness/feature-context/"$FEATURE_NAME".md
    git add .harness/gate-runs 2>/dev/null || true
    git commit -m "chore: retire feature context for $FEATURE_NAME"

The context lives only while the feature is in flight; it never passes the
gate. (If someone merges around this skill, the cleanup workflow removes the
leftover from `preprod`; it names that one file and touches nothing else under
`.harness/`.)

**`.harness/gate-runs/` is the opposite case and MUST pass the gate.** It is
the ledger the false-drift rate is computed from after ten features. Never
delete it here, and never gitignore it.

### 5. Write `.pr-description.md`

Create `.pr-description.md` at the repo root. If `$ARGUMENTS` is provided, use
it as the PR title. Otherwise, generate a concise title from the changes.

Format:

    ---
    title: Short PR title (under 70 characters)
    ---

    ## Summary
    - 3-5 bullet points explaining what changed and why

    ## Spec
    - Dormant: a link to the spec issue on the tracker, if the feature has
      one. Connected: the change key, its work item (`<KEY>: <title>`, #N),
      and the Spec Universe change view `{SPEC_UNIVERSE_URL}/changes/<KEY>`

    ## Spec verdicts
    - Connected only. The verdict table from the feature context, verbatim
      and unaltered (its shape is `/code-review`'s). `/release` reads this
      section to claim conformance once production serves the release, so it
      is the one place the verdicts survive the merge. Say "no domain file
      changed; no node implicated" when the gate passed vacuously.

    ## Suspect rows
    - Connected only. The `## Suspect rows` table from the feature context,
      verbatim, or "no suspect row" when there was none. These are drifted
      verdicts that showed no concrete input and wrong result, so they gate
      nothing and are never claimed; the PR body is the only place they
      survive the merge. Never move one into `## Spec verdicts`.

    ## Preprod gate
    - Connected only. The mode and the file it came from, the row counts by
      verdict, the drifted rows split into new, known and pending, and either
      every row that would have stopped this merge or "nothing would have
      stopped this merge". Name the run record's path and link the
      disposition comment. This section is how the false-drift rate is
      computable from GitHub alone, so it is written even when the gate
      passed vacuously.

    ## Code review findings
    - The /code-review findings summary from the end of /feature phase 4,
      including anything deliberately not addressed and why. Omit only if
      /code-review never ran (e.g. quick mode on a trivial change).

    ## What's new
    - User-facing changes described in plain language

    ## Technical changes
    - Key implementation details, files changed, architectural decisions

    ## How to test
    - Steps to verify the feature works correctly

### 6. Commit and push

Push any pending feature work **first**, so the whole branch (including the
conflict resolution from step 2 and the context retirement from step 4c) is
on the remote before the signal file triggers the workflow:

    git push -u origin <current-branch>

Then add the signal file as its own commit and push it. `.pr-description.md`
is in `.gitignore` (it is a signal file, and no signal file may pass the gate),
so the `-f` flag is required to stage it on the `claude/` branch:

    git add -f .pr-description.md
    git commit -m "chore: trigger auto-merge to preprod"
    git push -u origin <current-branch>

### 7. Inform the user

Tell the user:
- The auto-merge has been triggered
- The GitHub Action will create a PR from `feature/<name>` to `preprod` and
  merge it (or reuse and merge the open `/review` PR, if one exists)
- Any conflicts with `preprod` were already resolved locally in step 2; report
  which files conflicted and how you resolved them. The PR should now merge
  cleanly. (If the workflow still cannot merge, it leaves a comment on the PR
  with manual resolution steps.)
- The feature branch will be cleaned up automatically
- They can stay in this chat and chain `/release` once the merge lands. The
  release skill works on `preprod` and never re-pushes the `claude/` branch, so
  it will not re-trigger feature branch creation.
- Next time, `/release` on its own would have done both: run from an
  unmerged `claude/` branch it asks one confirmation, follows this
  procedure, waits for `preprod` to settle, and then ships. Mention it once,
  as an option; it is a bigger act than a merge and stays the user's call.

### 8. If the workflow fails

If the GitHub Actions run for this push fails, the recovery path depends on
where it broke. Open the Actions tab in GitHub and find the run titled
"Merge feature branch to preprod (to-preprod)" triggered by the `claude/<branch>`
push.

Common failure modes:

- **Workflow run failed mid-step** (e.g. a transient git push race): re-push
  the local `claude/` branch with `git push -u origin <branch>`. If the remote
  `claude/` branch was already deleted by `claude-to-feature-branch.yml`, the
  push creates a fresh branch and retriggers the chain. The workflow is
  idempotent, so re-runs do not duplicate commits or work.
- **PR opened but could not auto-merge** (conflicts with preprod): the workflow
  leaves a comment on the PR with manual resolution steps. Check out
  `feature/<name>` locally, merge `preprod` into it, resolve the conflicts using
  the discipline in step 2, push, and merge the PR by hand.
- **PR did not open at all**: the workflow errored before PR creation. Read
  the failed step's logs in the Actions tab. Most common cause: a missing or
  empty `PAT_TOKEN` secret. The workflow now fails fast with an explicit
  `::error::PAT_TOKEN is missing or empty...` annotation pointing at
  Settings → Secrets and variables → Actions; the PAT needs `repo` and
  `workflow` scopes (or fine-grained equivalent: Contents r/w, Pull
  requests r/w, Workflows r/w). Other causes: branch protection on `preprod`
  that requires explicit reviewers. **Recovery when `PAT_TOKEN` was
  missing**: add the secret, then re-push the `claude/` branch
  (`git push -u origin <branch>`) to retrigger. Because cleanup now runs
  *after* PR creation, the signal file is still on `feature/<name>` and
  the rerun picks up cleanly.

Do not confuse the recovery push above with the gotcha already documented in
`CLAUDE.md`: after a successful merge, both the `claude/` and `feature/`
branches are deleted remotely, and pushing again re-creates everything from
scratch. That warning applies to post-success pushes, not to recovery from a
failed workflow run.

### 9. Update memory files if warranted

If the session revealed broadly useful lessons (new conventions, gotchas, etc.),
update CLAUDE.md. Do NOT add feature-specific WIP notes.
