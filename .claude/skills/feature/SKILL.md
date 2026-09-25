---
name: feature
description: Build a feature end to end through gated phases sized to the change. Captures the change, sizes it S, M or L, challenges the why, grills the how, writes the spec, cuts the tickets, then implements, writing its journey position as it goes. Accepts a brainstorm idea issue as input.
argument-hint: "<description of what to build, or #<idea-issue-number>> [--quick] [--ship]"
---

<!-- Overlay rule: base and the railway override differ ONLY in phase 0's naming push and
phase 5's preview-URL steps. See .claude/HARNESS.md. -->

# Feature

## The invocation

```text
$ARGUMENTS
```

Read `SHIP.md` beside this file when the invocation carries `--ship`. Read
`CONNECTED.md` beside this file when `.harness-version` has a
`spec_product:` line. Otherwise neither applies and neither is read.

Drive a change from a one-line description (or `#<number>`, a brainstorm idea issue) to
merged-ready code, in this one session. Each phase is a journey position;
`.claude/JOURNEY.md` explains them, this file says when to write one. **Do NOT start
building in phase 0**: the change is captured, sized and planned first ("### Size" below),
the tier picks the path, and every arrow on it is a gate ("Gates").

## The phase map

| Phase | What happens | Skill | Position written | Tiers |
|---|---|---|---|---|
| 0 | Capture the change, mint its key, open its work item, size it; name the feature, create the feature context, resume previous work | this skill | `captured` | all |
| plan-and-go | One gate: the Why, a one-paragraph plan, the regression-test seam, the files it expects to touch | this skill | `committed` | S |
| 1 | One `/grilling`: round 1 challenges the why (`pursue`, `drop` or `park`), the rounds after it shape the how | `/grilling` + `/domain-modeling` | `challenging`, `challenged`, `shaping`, `shaped` | M, L |
| 1c | Assess the impact: the touched set in full, the overlap report | this skill | `assessing`, `assessed` | L (a gate only when connected) |
| 1d | Decide: build, drop or park | this skill | `deciding`, `committed` | L; M folds it into the why-and-how verdict |
| plan | `/to-spec` then `/to-tickets` back to back, one gate | `/to-spec`, `/to-tickets` | `planning`, `planned` | M; L gates after each |
| 4 | Build test-first at agreed seams, then review and audit the docs; M and L gate, S reports the verdicts and goes on | `/implement`, `/code-review`, the docs-updater | `building`, `built` | all |
| 5 | Push, take or choose the exit, hand over | this skill | none: from `verifying` on the journey is read from GitHub | all |

S writes `captured`, `committed` and `built`, and `building` where a cockpit reads
transitions; the gap is the honest rendering of four skipped states. M and L write every
state, and transitions where a cockpit reads them (`journey.sh` drops the rest). **Push
checkpoints**: the feature context is committed at every gate and pushed after Capture (the
naming push carries it), after the plan gate (plan-and-go for S) and at the end of phase 4;
phase 5 and standing down push as always. **Every position write is one line:**

    bash .claude/scripts/journey.sh phase <position> "<one sentence in the position's own terms>"

Several positions go in one call, comma-separated. A journey write pushes on its own
(`--no-push` lets a checkpoint push that follows at once carry it); `journey-sync.yml`
mirrors the record onto `coordination` and rings the cockpit, so nothing follows the call. A
`journey:` line is advisory: say it, go on. "Write `<position>`" below means this call.

## Gates

S has exactly two gates, plan-and-go and the exit (the Size table's Gates column); the phase
4 gate is M and L's. At each gate STOP and ask with `AskUserQuestion`: continue, stay, or
revise. Show what the phase produced first; wait for the answer, never assume approval,
never advance on silence; "stay" means keep working, then gate again; going backwards is
cheap, so a hole found at the plan gate returns to the grill rather than guessing. The
journey gates carry their own verdicts, in these words: **worth pursuing** (pursue, drop,
park: the end of round 1), **build it** (build, drop, park: 1d for L, the why-and-how
verdict for M), **plan-and-go** (S; its verdict is `committed`). A park or a drop does what
`.claude/JOURNEY.md`, "Gate verdicts", says, then ends this skill.

**Report the gate at both ends** (`.claude/JOURNEY.md`, "Reporting activity"), with
`REF="$KEY:gate-<name>"`: `cockpit.sh report <position> "waiting at the <name> gate: <what>"
--key="$KEY" --ref="$REF"` as the question goes out, the same with `"gate answered:
<verdict>"` and `--completes="$REF"` as the answer lands. `<name>` is the gate's label
(`plan-and-go`, `why-and-how`, `1d`, `plan`, `4`, `5`): gates 4 (M and L) and 5 are both put
at `built`. Under `--ship` the pair collapses to one report (`SHIP.md`).

**Who answers a gate can change; what a gate does never does.** Phase autopilot (the *build,
and go all the way to implement* option at the L 1d gate and the M why-and-how verdict) and
`--ship`, which declares the session unattended, are "Not stopping at gates" in `SHIP.md`.

## The feature context and the closing block

`.harness/feature-context/<slug>.md`, committed, is this feature's memory across sessions;
`.claude/HARNESS.md` owns its format and lifecycle (only the pushed copy survives the
container), and it is a rewritten summary, never a log. Beside what that contract names,
this skill writes `## Change`, `## Size`, `## Brief`, the key and work item, the gate
verdicts, `Exit route`, whether autopilot or grill autonomy was granted (naming `--ship`
where the flag did), `## Parallel work`, `## Blocked` while standing down, and `## Docs
verdict`. Refresh it whenever finished work changes what a fresh reader needs (commit prefix
`chore(context):` when it is the only file touched). **The touched set rides the same
beat**: when the plan reaches an undeclared path, widen the record in place (`touched-set.mjs
refresh --from=.harness/journey/<slug>.md --path=`, written back to that file; the next
journey write or context commit carries it); it only widens. Connected: see
`CONNECTED.md`, "Nodes in the touched set".

One closing block per reply (`getting-started`, Step 3b); only its content changes. Phase
0's carries the name and branch, the key and work item, the tier and its reason, the exit
line and the resume phase if any. At every gate `Good to know` carries what the phase
produced (plan, overlap report, settled picture, spec and tickets with their edges, diff
summary with findings, docs verdict and open tickets) and `Act next` the decision owed, said
plainly at the plan gate: approving starts the build. A grill's questions are the `Act next`
items, numbered per `/grilling`; phase 4 puts findings deliberately not acted on in `Act
later` and the next frontier ticket in `Act next`. Phase 5's exit choice is a question stage
(next letter prefix); running the exit, this skill still owns the one block and the exit
skill contributes items.

## Phase 0: capture, size, name and resume

`BRANCH=$(git branch --show-current)`. If it does not start with `claude/`, say this skill
only works on `claude/` branches and stop.

### Know which exit this session can reach, before it builds anything

    AUTHORITY=$(sed -n 's/^agent-authority: *//p' .harness-version | tail -1)

`/to-preprod` and `/review` need no grant. Without `--ship`, `/release` is reachable only if
`release` appears in that list or the user asks for it at the phase 5 gate; a no-flag run
nobody answers there takes the furthest exit the grant allows: with `agent-authority:
release` it releases, without it it will stop at `preprod` through `/to-preprod` and say so.
**With `--ship`, this run ends in a tagged release on `main`**: the flag takes `/release`
(`SHIP.md`). Say which in phase 0's closing block, in one line, and record it under `Exit
route` in the context. Under `--ship`, probe the alert path once (`SHIP.md`).

### Capture the change, and mint its key

If the invocation is `#<number>`, fetch that idea issue per `docs/agents/issue-tracker.md`:
carry its **Why** into the work item's `## Why`; **Decisions so far** are settled, **Not yet
specified** is the grill's frontier, **Destination** and **Out of scope** are the
description. Comment that a feature session picked it up; link it in the context.

The precondition is a `change-prefix:` line in `.harness-version`. Without one, stop: "This
repository has no `change-prefix:`; add the prefix the System Registry issued for it to
`.harness-version` and run `/feature` again." A made-up prefix mints keys that collide
later. Ask for three things, and wait: a **title** (one line), a **description** (one
paragraph, what will be different afterwards), the **why** (what is wrong or missing today).
An idea issue or an invocation carrying all three gets them restated in one line and
confirmed. A resumed session (a work item exists) and a continuation after a merge skip
Capture. **The key is `<PREFIX>-<n>`**, unpadded only (`MYPR-1`, never `MYPR-0001`; refuse a
padded key wherever offered): the prefix from `change-prefix:`, `n` the next number from
`counters/change-key` on `coordination`.

**Verify the prefix against the registry, before the mint.**

    PREFIX=$(sed -n 's/^change-prefix: *//p' .harness-version | tail -1)
    SYSTEM_KEY=$(sed -n 's/^system-key: *//p' .harness-version | tail -1)

With `registry: off` in `.harness-version`, or `REGISTRY_URL` or `REGISTRY_TOKEN` unset,
check nothing and say nothing: trust the line and mint. Otherwise run `bash
.claude/scripts/registry.sh prefix "$PREFIX"`: exit 0, the prefix resolves; 1 (no system has
it) or 2 (a shape no key builds from), **stop, do not mint**; 3, 4 or 5 (unset variable,
refused token, unreachable), one line naming which, then mint: an outage says nothing true
about a cached immutable prefix. On 0 compare the JSON's system with `SYSTEM_KEY`: empty,
mint and offer (never write) `system-key: <permanent key>`; matching, mint silently;
different, **stop and do not mint**, naming both systems and that one of the lines is wrong.

**Mint**: a sha-guarded compare-and-swap, `mcp__github__get_file_contents` then
`mcp__github__create_or_update_file` on branch `coordination`. Read `counters/change-key`
(one bare integer, and its sha); absent, create it with content `1` and no sha, key
`<PREFIX>-1`; else write `<n+1>` with the sha you read, key `<PREFIX>-<n+1>`. On a failed
write re-read and retry, at most three times. **Fail closed**: if the branch cannot be read
or written, stop and say so; a guessed key welds two changes together. Record the key now.

### Create the work item

Create the tracker issue per `docs/agents/issue-tracker.md`, titled exactly
`<KEY>: <title>`, with five sections:

```
## Why
<the why, verbatim>
## Challenge
<end of grill round 1: the why as it stands, what was rejected, the verdict; S: "not challenged: size S">
## Change key
`<KEY>`. Size: `<S|M|L>`.
## Specification
<by /to-spec: the spec text (S, M) or the spec issue link (L)>
## Tickets
<by /to-tickets: a checklist (S, M) or sub-issues (L)>
```

`## Why` is written once, here; the spec issue, L tickets and `.pr-description.md` carry
`Why: <work item URL>` instead. The work item is the `captured` artefact and the home of
every verdict and label (`pursue`, `parked`, `blocked`); it is never deleted, and closing it
as not planned drops the change. Run `bash .claude/scripts/cockpit.sh configured` once; on a
non-zero exit make no `cockpit.sh` ping or report call for the rest of the run (each would
print nothing and cost a turn). On 0, ring once: `bash .claude/scripts/cockpit.sh ping
--key="$KEY"`. Connected: see `CONNECTED.md`, "The work item".

### Size

Every change is sized at the end of Capture, and the tier decides which phases run. The
session states the tier and its one-line reason in the phase 0 closing block and writes it
on the work item and in the record. One word from the user overrides it. A tier may go up
mid-run (an S that finds a schema change becomes M, takes the M gate before continuing,
passing `--size=M` on its next `journey.sh phase` call so the record follows). A tier
never goes down. `--quick` means "force S".

| Tier | When | Phases | Gates |
|---|---|---|---|
| S | No schema change, no new public interface (route, action, MCP tool, env var, workflow input), no decision record, one ticket, about 50 changed lines or fewer outside tests. A bug fix with a regression test is S. A behaviour change alone does not make it M. | 0, plan-and-go, 4, 5 | plan-and-go, exit |
| M | One S exclusion holds, or 2 to 4 tickets | 0, 1 (one grill; the why is round 1), plan (spec and tickets together), 4, 5 | why-and-how verdict, plan, exit |
| L | A schema, decision record or public interface AND more than 4 tickets; or the user says L; or an idea issue with more than one open question | the full flow | as today, minus 1c when the spec loop is dormant |

### Name the feature

Derive a kebab-case slug from the description, prefixed with the lowercase key
(`mypr-1-fix-login-seed`), so every branch and environment starts with it. Run `bash
.claude/scripts/set-feature-name.sh --no-push <slug>`, with `--preview=yes` only for L or
when `/review` is the known exit. It writes `.harness-feature` and commits; checkpoint 1's
push below carries the name and creates `feature/<slug>`. It is idempotent. Then:

    FEATURE_NAME=$(bash .claude/scripts/resolve-feature-name.sh "$BRANCH")
    FEATURE_BRANCH="feature/$FEATURE_NAME"

**A continuation.** Once a part has merged, `/to-preprod` has retired its slug, record and
context; more work under the same key is a continuation (a different why is a new change).
Keep the key and the work item, skip Capture and the mint, and comment on the work item
naming the new slug and the merged pull request. Start from the merged part (`git fetch
origin preprod && git merge --no-edit origin/preprod`), name a new slug under the same key
(`mypr-6-speakers` after `mypr-6-bot-look`, never the merged slug), and render a fresh
record and context naming the merged part, `--phase` set to where this part starts
(`committed` for S, so phase 4's `building` lands only where a cockpit reads it; else the
first phase the remaining work needs; the why was challenged once). `.claude/JOURNEY.md`
says how the cockpit reads the key moving back.

### Resume, declare the touched set, read the namespace, build the brief

`git fetch origin "$FEATURE_BRANCH" 2>/dev/null && git merge "origin/$FEATURE_BRANCH"
--no-edit`, resolving conflicts with `/to-preprod`'s "Resolving conflicts" discipline rather
than aborting. Read `.harness/feature-context/$FEATURE_NAME.md` if the merge brought it in;
else create it now with `## Change` (title, description, why) and `## Size` (`<S|M|L>.
<one-line reason>`), and commit it.

The `coordination` branch carries one record per in-flight feature saying what it will touch
(contract: `.claude/HARNESS.md`). Declare at whatever granularity is honest: a prefix with a
`**` tail is fine, a wide honest claim beats a narrow wrong one, and declare the work, never
`.harness-feature` or `.harness/feature-context/**`. A fresh feature renders:

    R=$(mktemp -d) && mkdir -p "$R/others"
    node .claude/scripts/touched-set.mjs render \
      --slug="$FEATURE_NAME" --branch="$FEATURE_BRANCH" --key="$KEY" \
      --author="$(git config user.email)" --spec=none --size=<S|M|L> \
      --phase=captured --path=<a prefix> --path=<another> > "$R/mine.md"
    bash .claude/scripts/journey.sh declare "$R/mine.md" --no-push

That commits the record as `.harness/journey/$FEATURE_NAME.md`; checkpoint 1's push below
carries it, and `journey-sync.yml` mirrors it onto `coordination` and rings the cockpit. A
resumed session skips the render: its record exists, and "Work out which phase" below writes
the position once. Connected: see `CONNECTED.md`, "Nodes in the touched set".
**Then read the namespace** (here, and again in phase 5):

    C="bash .claude/scripts/coordination.sh"
    for slug in $($C features); do $C feature "$slug" > "$R/others/$slug.md"; done
    $C feature-branches > "$R/branches.txt"
    node .claude/scripts/touched-set.mjs overlap --mine=".harness/journey/$FEATURE_NAME.md" --dir="$R/others" --branches-file="$R/branches.txt"
    $C adr-collisions "$FEATURE_BRANCH"

Put what it prints in the closing block and, on an overlap, under `## Parallel work`; it is
advisory. **An `ADR NNNN:` line is the one thing here that is not**: renumber this branch's
record now, with the steps in `/to-preprod` step 2. **An overlap that landed on `preprod` is
merged in** (`git merge origin/preprod`, resolved per that step), never copied in by hand: a
one-parent "Merge" commit is not a merge. A stale record goes with `coordination.sh delete
features/<slug>.md`; sweep only what the report names, on exit 2 by `mcp__github__delete_file`
yourself (branch `coordination`, path `features/<slug>.md`, message `coordination: sweep
<slug>`). Every other failure warns once and continues: the touched set is never fail-closed.

**Build the brief** and paste its output into the context as `## Brief`:

    bash .claude/scripts/brief.sh --title="<the title>" --why="<the why>" --path=<each declared path>

Later phases, `/to-spec`, `/to-tickets` and the Standards reviewer read the brief
first and open the full docs only where it names them. Commit the context now and push (`git
push -u origin "$BRANCH"`): this naming push carries both (checkpoint 1).

### Work out which phase you are resuming into

Verify the context against the tracker's durable artefacts, in order, and enter the first
phase whose artefact is missing: the work item (missing: fresh feature); `## Challenge` with
a verdict (empty: phase 1; `parked`: say so, go on only once the user un-parks it); settled
decisions and scope in the context (missing: the grill's how; no build verdict: 1c or 1d for
L); `## Specification` and `## Tickets` filled (either missing: the plan phase); unticked
lines or open tickets (any: phase 4; none: phase 5). Write the position landed in, whatever
the record says. A `## Blocked` section means the last session stood down: read it first;
clear it (and the `blocked` label) only once the block is gone. Connected: see
`CONNECTED.md`, "A strict pause on resume". Say which and why, then gate.

## The S path: plan-and-go

One gate, then phase 4. Show the Why, a one-paragraph plan, the seam for the regression test
(where a test goes red first) and the files it expects to touch. Write the paragraph into
the work item's `## Specification` and one line into `## Tickets` (`- [ ] T1 <title>
(blocked-by: none)`), so the audit trail has the plan before any code exists. Put the gate:
`go`, `revise`, or `this is bigger` (re-size to M and take the M path). Its verdict is
`committed`: comment it on the work item, record it, write `committed`, push (checkpoint 2).
Under `--ship` the session answers it and the comment is the record (`SHIP.md`).

## The M path: one grill, one plan gate

**Phase 1.** Write `challenging`. Run one `/grilling` with `/domain-modeling`. **Round 1 is
the why alone**: what is wrong today, who feels it, what happens if nothing is built,
whether this change is the right answer; an idea issue whose **Decisions so far** settle it
gets the verdict put without re-asking. Post each round as one comment on the work item. At
the end of round 1, in the reply that opens round 2, give the **worth pursuing** verdict: on
`pursue`, rewrite `## Challenge`, apply the `pursue` label, record it, write
`challenged,shaping` in one call; `drop` or `park` ends the skill per "Gate verdicts". The
rounds after it shape the how, grilling only the frontier an idea issue left open; facts are
yours to find with sub-agents, decisions are the user's. Done when the frontier is empty,
nothing is silently assumed, new vocabulary is in `docs/GLOSSARY.md`, every one-way decision
has its record claimed through `/document adr <title>`, and you can state what this change
does NOT do. Write `shaped` and put the **why-and-how verdict** (`build`, `build` under
autopilot, `park`, `drop`, or back to the grill); on `build` comment it on the work item,
record it, write `deciding,committed`.

**The plan gate.** Write `planning`. Run `/to-spec` (into `## Specification`: one user story
per settled decision) then `/to-tickets` (a `## Tickets` checklist with `blocked-by` edges)
back to back; neither re-interviews. Put one gate showing both, the seam question and the
granularity quiz as options inside it (`revise seams`, `re-slice`) rather than stops, and
the overlap report as a Good to know item. Approving starts the build: write `planned`, push.

## The L path: the full flow

**Phase 1a+1b**: the M grill above, same round-1 fold, same done-when. **Phase 1c
(`assessing`)**: write `assessing`; refresh the declaration with every path the settled
decisions now reach, re-run the overlap report and put it in the closing block (and
`## Parallel work`); write `assessed` and, dormant, continue to 1d without a gate (connected:
see `CONNECTED.md`, "1c as a gate"). **Phase 1d (`deciding`)**: write `deciding`, then put
the **build it** gate with the settled picture: `build`, `build` under autopilot, `park`,
`drop`, or back to 1b; on `build`, comment it on the work item, record it, write `committed`.

**Phase 2: spec.** Write `planning`. Run `/to-spec`: a spec issue carrying the slug and
`Why: <work item URL>`, linked from `## Specification`. Record the number; gate (connected:
`CONNECTED.md`, "Phase 2"). **Phase 3: tickets.** Run `/to-tickets`: tracer-bullet slices as
sub-issues with blocking edges, by its batched script. Record them, write `planned`, push
(checkpoint 2). Gate: **plan accepted**, said plainly: approval starts the build.

## Phase 4: implement

Write `building`. Run `/implement` against the tickets, working the frontier: for S and M
the unticked checklist lines whose `blocked-by` are all ticked, each ticked as it lands with
its check result; for L the sub-issues, closed as each lands. A decision record the build
turns out to need is claimed through `/document adr <title>` the moment it settles.
`/implement` owns the loop (a commit per ticket), `/tdd` at agreed seams, and the full check
(`check:` then `tests:` from `.harness-version`).

When the frontier is empty and the full check is green, run `node scripts/check-docs.mjs
--diff origin/preprod`, then dispatch **in one turn**: `/code-review` (fixed point
`origin/preprod`; S gets one combined reviewer with the diff, the `## Brief` guardrails and
the TESTING.md and SECURITY.md excerpts pasted in, M and L the two axes with the diff pasted
into both) and, when `--diff` printed anything but `nothing`, the docs-updater
(`.claude/agents/docs-updater.md`) with that output as its whole scope under `## Scope (from
check-docs --diff)`. Act on the findings, or record in the context why one is deliberately
not addressed; record the docs outcome as `## Docs verdict` (`nothing to update` counts).
Connected: see `CONNECTED.md`, "Verdict handling". Write `built`, recording the check result
and the **code sha** it ran against (the last commit touching anything outside `.harness/`;
context and signal commits do not move it). Push (checkpoint 3). M and L gate here: the diff
summary, the check result, the findings, the docs verdict. S has no gate here: put the
review and docs verdicts in the closing block and go on to phase 5.

## Phase 5: push and hand over

`git push -u origin "$BRANCH"`. Widen the declaration to wherever the work reached (the
context commit below carries it), re-run phase 0's namespace read, and summarize: what was
built, the files changed, the spec and tickets, the findings, the docs verdict, any overlap
and any open ticket. The phase stays `built`. **Under `--ship` there is no question here**:
take `/release` (`SHIP.md`). Otherwise ask with `AskUserQuestion`: `/to-preprod`
(auto-merge; the default without `reviewers:`), `/review` (a PR waiting for people; the
default with `reviewers:`), `/release` (merge and ship in one go; offered always, suggested
never, its own confirmation still applies). Suggest the default, always ask. Record the exit
in the context and push first: the exit merges the branch out from under you. Then **run it
by reading that skill's `SKILL.md` and following its steps in order, to the end**:

| Answer | Follow |
|---|---|
| `/to-preprod` | `.claude/skills/to-preprod/SKILL.md` |
| `/review` | `.claude/skills/review/SKILL.md` |
| `/release` | `.claude/skills/release/SKILL.md` |

Reading the file and working its steps is the established route (a forge decision record).
For `/release`, read its `## Authority` first: the user's answer here is one form, `--ship`
another (`SHIP.md`); with neither and no `agent-authority: release`, the exit is
unavailable, and doing its steps by hand is the same forbidden act. **Do not stall here**: a
session nobody answers takes the furthest exit the grant allows ("Know which exit", phase
0). Stand down (`getting-started`, Step 3c) only for an exit you may not take, and never
report the feature complete with work unmerged on a `claude/` branch. Autopilot ends here:
it advances gates, never picks exits. Connected: see `CONNECTED.md`, "The preprod gate".

## Standing down

When the session will end without clearing a block (a red check, a conflict it cannot
resolve, a question only the author can answer), follow "Blocked" in `.claude/JOURNEY.md`:
`## Blocked` in the context, the `blocked` label, one Board ask only when a person unblocks
it, one report always. Do NOT rewrite the phase; push the context, emit the stand-down block
(`getting-started`, Step 3c), and never call the feature complete in a reply carrying it.

## Quick mode (escape hatch)

`--quick` means "force S": the rubric is not consulted, the S path runs, and the plan-and-go
gate still shows the plan. Propose it for trivial work (a typo, a config tweak, a dependency
bump) but never take it yourself: ask, and wait. It removes phases where `--ship` removes
stops; they compose in either order, and `SHIP.md` owns that flag. Capture, the key, the
work item and phase 5 still run: a change too small to specify is still a change, and its
key is what `/release` closes.
