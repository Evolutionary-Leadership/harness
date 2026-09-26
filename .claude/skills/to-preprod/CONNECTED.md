# To preprod: the connected half

Read this only from `/to-preprod`, once `.harness-version` carries a `spec_product:` line. Each
section names the core step it extends; nothing here runs when the loop is dormant, and nothing
about the loop is mentioned to the user then. `.claude/SPEC-LOOP.md` owns the loop's vocabulary
(the verdicts, the baseline states, the three client faults); this file owns what this skill does
with them.

## What the context holds for the gate (step 4)

Beside what the core reads, hold three things from `.harness/feature-context/$FEATURE_NAME.md`:
its `## Spec verdicts` table, its `## Suspect rows` table and the change key (`## Change key`, or
the Tracker section). The gate below reads the first and the key; the PR body carries all three,
because the context is deleted in step 6 and a person still has to see them.

A suspect row is a `drifted` verdict the judge could not evidence (`.claude/SPEC-LOOP.md`, the
judge section). It never gates anything and never becomes a claim, so the gate does not read it.

## The preprod gate (step 4b)

The gate refuses a merge that carries drift **the branch itself introduced** and nobody decided. It
does not refuse drift recorded before the branch existed: an audit of an existing product routinely
records dozens of drifted criteria at once, and gating on those stops merges that never touched
them. Two modes compute the same rows and print the same words:

| Mode | What it does with a row that would stop the merge |
|---|---|
| `evaluate` | Prints it in full, under the same heading, and merges anyway |
| `enforce` | Prints it in full, under the same heading, and stops |

The mode is `gate-mode:` in `.harness-version`; an absent key reads `evaluate`. A feature context
may **tighten** it to `enforce` for one branch and may never loosen it, because a branch that can
switch off the gate it is failing is not a gate. Say which file the mode came from before anything
else.

**Read the change's proposals and the baseline.** The baseline is not a new artifact: Spec Universe
already records conformance per criterion, and `/release` refreshes it at every release, so the
record IS the state as of the last release. Read it live, one call per distinct node carrying a
`drifted` row:

    SU="bash .claude/scripts/spec-universe.sh"
    KEY=<the change key>
    $SU change-proposals "$KEY"                 > /tmp/proposals.json
    for NODE in <every node with a drifted row>; do $SU node "$NODE"; done \
      | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.stringify(s.trim().split(/(?<=})\s*(?={)/).map(JSON.parse))))' \
      > /tmp/nodes.json

**Any non-zero exit from the client stops the merge in BOTH modes** and writes no signal file,
because a gate cannot pass on a specification it could not read. Report what the client printed;
`.claude/SPEC-LOOP.md` tells the three faults apart. The mode governs drift tolerance and nothing
else.

If the verdict table is missing and the branch changes anything under the domain roots, run
`/code-review` now (fixed point `origin/preprod`) rather than merging unjudged; a branch that
touches no domain file passes the gate vacuously, and the PR body says so.

**Run the gate.** The classification and the copy live in the script, so the two modes cannot
drift apart in wording:

    node scripts/gate-run.mjs --key="$KEY" \
      --verdicts=.harness/feature-context/"$FEATURE_NAME".md \
      --nodes=/tmp/nodes.json --proposals=/tmp/proposals.json \
      --head-sha="$(git rev-parse HEAD)" \
      --merge-base="$(git merge-base origin/preprod HEAD)" \
      --branch="$FEATURE_BRANCH" --work-item=<the work item URL>

Report its output verbatim. Exit `1` means the merge stops: end the skill here, before step 4c,
with nothing retired and nothing pushed. Exit `2` is a configuration fault in the mode or a missing
key; fix it and run again. It reads the changed-file set from `<merge-base>...<head>` itself
(`--changed-files=<file, one path per line>` overrides that when git is unavailable).

How it classifies, so a reader of the report knows what they are looking at:

| Recorded conformance | Baseline | A `drifted` row on it |
|---|---|---|
| `drifted` | `known` | reported, never blocks: the branch did not cause it |
| `matched`, and the row's `where` file has a hunk in the diff | `matched` | **new drift**, and it blocks under `enforce` |
| `matched`, and the row's `where` file has no hunk in the diff | `known-stale-baseline` | reported under its own heading, never blocks: the drift predates the branch and the recorded `matched` is stale |
| absent, or anything else | `pending` | an absence, not a regression, never blocks |

A row judged against a proposal is always new drift: the proposed text has no prior conformance
record to have drifted from. `unverifiable` rows never block and go into the PR body and under `Act
later` as anchors to repair. New drift is covered, and so does not block, by an `accepted` or
`promoted` proposal under the change key whose node is that row's node; a `draft` or `declined`
proposal and no proposal at all each block, naming the one missing piece.

**One row is exempt from the mode and stops in both.** A proposal on a node whose effective
strictness is `legal` or `contractual`, accepted by an identity that is not a `user`, stops the
merge under `evaluate` too: Spec Universe refuses that acceptance over MCP and `/v1`, so it is a
security control and not drift. The script marks it `[stops in both modes]`.

Every stop names exactly one missing piece and one deep link (`{SPEC_UNIVERSE_URL}/nodes/<node
key>` for a proposal to decide, `{SPEC_UNIVERSE_URL}/changes/<KEY>` for the change as a whole).

**Record the run.** The script writes `.harness/gate-runs/<KEY>-<n>.json` and prints its path on
the `Run record:` line. The record is COMMITTED and reaches `preprod`: it is the ledger the
false-drift rate is computed from after ten features, and a ledger that dies at the merge is no
ledger. Post the same rows as one comment on the change's work item (`mcp__github__add_issue_comment`),
asking in one line for the disposition (`true-drift` where the row was a real regression,
`false-drift` where it was not), and re-run the command with `--disposition-url=<that comment's
URL>` so the record points at where the answer will be written. The record rides in the signal
commit (below).

## The signal commit (step 6)

Stage the run record with the retirement, before the commit the core shows:

    git add .harness/gate-runs/"$KEY"-*.json

**`.harness/gate-runs/` is the opposite case from the context and MUST pass the gate.** Never
delete it here, and never gitignore it. `/release` reads the record from `main` by the path the PR
body names, so a record that misses the commit ships a release with nothing to claim.

## The PR body (step 5)

The `## Spec` bullet adds, after the change key and work item the core names, the Spec Universe
change view `{SPEC_UNIVERSE_URL}/changes/<KEY>`. Directly under `## Spec`, and before
`## Code review findings`, add these three sections in this order:

    ## Spec verdicts
    - The verdict table from the feature context, verbatim and unaltered (its shape is
      /code-review's). /release reads this section to claim conformance once production
      serves the release, so it is the one place the verdicts survive the merge. Say
      "no domain file changed; no node implicated" when the gate passed vacuously.

    ## Suspect rows
    - The `## Suspect rows` table from the feature context, verbatim, or "no suspect row"
      when there was none. They gate nothing and are never claimed; the PR body is the only
      place they survive the merge. Never move one into `## Spec verdicts`.

    ## Preprod gate
    - The mode and the file it came from, the row counts by verdict, the drifted rows split
      into new, known, stale baseline and pending, and either every row that would have
      stopped this merge or "nothing would have stopped this merge". Name the run record's
      path (`.harness/gate-runs/<KEY>-<n>.json`) and link the disposition comment. This
      section is how the false-drift rate is computable from GitHub alone, so it is written
      even when the gate passed vacuously.

`/release` takes the change key and work item from `## Spec` and the run record path from
`## Preprod gate`; a PR body naming no record ships unclaimed.

## The closing block

`Good to know` adds the gate's result: the mode, how many drifted rows, each covered by which
proposal (or stale, known or pending), and the run record path. `Act later` carries every
`unverifiable` row as an anchor to repair, and the disposition the work item comment is waiting
for.
