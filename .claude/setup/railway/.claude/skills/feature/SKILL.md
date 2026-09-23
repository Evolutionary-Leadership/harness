---
name: feature
description: Build a feature end to end through gated phases. Captures the change, challenges the why, grills the how, writes the spec, cuts the tickets, then implements, writing its journey position as it goes. Accepts a brainstorm idea issue as input.
disable-model-invocation: true
argument-hint: "<description of what to build, or #<idea-issue-number>> [--quick]"
---

<!--
Overlay rule: this skill ships in base with a railway overlay override;
the two copies may differ ONLY in the Railway-specific steps of phase 0
(provisioning note) and phase 5 (preview-URL reporting). Any other edit
must be mirrored verbatim in the other copy. See .claude/HARNESS.md.
-->

# Feature

Drive a feature from a one-line description to merged-ready code through
five phases, with a stop-and-ask gate between each one. Every phase is a
position on the journey the Product Cockpit draws, and this skill writes
that position into the touched-set record as it moves. `.claude/JOURNEY.md`
is the one home for what each position means, which artefact it leaves, and
when a transition is ready and done; where this file says "write the phase",
it means that file's recipe.

`$ARGUMENTS` contains the description of what to build, or a `#<number>`
reference to a brainstorm idea issue.

**The rule this skill exists to enforce: do NOT start building in phase
0.** Requirements get grilled, written down, and sliced into tickets
before a single line of feature code is written. The only exception is the
explicit escape hatch in "Quick mode" below.

## The spec loop, and the one key that switches it

Parts of phases 0, 1, 2 and 4 fork on one key. Read it before phase 0:

    SPEC_PRODUCT=$(sed -n 's/^spec_product: *//p' .harness-version | tail -1)

**Empty or absent: this repository has not connected a specification.** Take
every step marked **(dormant)** below and skip every step marked
**(connected)**. Nothing about the loop is mentioned to the user.

**Set: the loop is awake.** Phase 1b retrieves the nodes the change's own
words reach, phase 2 writes proposals rather than a spec issue, and phase 4's
review judges against Spec Universe. `.claude/SPEC-LOOP.md` is the whole
mechanism.

**Capture, the change key and the work item do not fork on this key.** Every
repository mints a key and opens a work item, connected or not: the work item
is where the journey's first artefacts live (the why, the challenge, the
verdict), and a change without a key is one the cockpit can see and never
place. What forks is only where the specification goes.

## Phase map

| Phase | What happens | Skill | Journey |
|---|---|---|---|
| 0 | Capture the change, mint its key and open its work item; name the feature, create the feature context, resume previous work | this skill | `captured` |
| 1a | Challenge the why: a short grill ending in pursue, drop or park | `/grilling` | `challenging` to `challenged` |
| 1b | Interview the user on the how until the design tree is settled | `/grilling` + `/domain-modeling` | `shaping` to `shaped` |
| 1c | Assess the impact: the touched set in full, the retrieved specification, every conflict decided | this skill | `assessing` to `assessed` |
| 1d | Decide: build, drop or park, put to the user | this skill | `deciding` to `committed` |
| 2 | Synthesize the conversation into a spec on the tracker; **(connected)** into proposals in Spec Universe, pointed at from the work item | `/to-spec` | `planning` |
| 3 | Slice the spec into blocking-ordered tickets | `/to-tickets` | `planned` |
| 4 | Build it, test-first at agreed seams, then review it | `/implement`, `/code-review` | `building` to `built` |
| 5 | Push, choose the exit, hand over | this skill | from `verifying` on, read from GitHub, never written |

You run all five in this one session. You do NOT run them back to back
unprompted: every arrow between phases is a gate (see "Gates").

## Gates

At the end of each of phases 1a to 4, STOP and ask the user to approve
moving on. Use `AskUserQuestion` with the options "continue to <next
phase>", "stay in <current phase>" and (where it makes sense) "revise
<current output>". Two of these are journey gates with their own verdicts,
put to the user in those words: the end of 1a (**worth pursuing**: pursue,
drop or park) and 1d (**build it**: build, drop or park). What each verdict
does to the work item, the branch and the record is in `.claude/JOURNEY.md`
under "Gate verdicts"; a park or a drop ends this skill there, after doing
what that table says.

**Who answers a gate can change; what a gate does never does.** Phase
autopilot and `--ship` both advance gates without a person, and both are one
section: "Not stopping at gates" below. Under `--ship` the two journey gates
above are answered by the session rather than put to the user, and their
verdicts are still recorded as artefacts.

Rules for a gate:

- Show what the phase produced first: the settled decisions, the spec
  link, the ticket list, or the diff summary and review findings.
- Wait for the answer. Never assume approval, never advance on silence.
- "Stay" means keep working in the current phase, then gate again.
- Going backwards is allowed and cheap. If phase 3 exposes a hole, return
  to phase 1b for that branch of the tree rather than guessing.
- At every gate, refresh the feature-context file and push (see "The
  feature context" below).
- **Report the gate at both ends.** A gate is the longest deliberate wait in
  the flow, and from outside it looks exactly like a session that stopped.
  This is one of the eight seams in `.claude/JOURNEY.md` ("Reporting
  activity"), which owns the voice and the rules. As the question goes out:

      REF="$KEY:gate-<n>"
      bash .claude/scripts/cockpit.sh report <position> "waiting at the phase <n> gate: <what is being approved>" \
        --key="$KEY" --ref="$REF"

  and as the answer lands, naming the verdict in its own words:

      bash .claude/scripts/cockpit.sh report <position> "gate answered: <verdict>" \
        --key="$KEY" --completes="$REF"

  `<n>` is this phase's own label (`1a`, `1b`, `1c`, `1d`, `2`, `3`, `4`, `5`)
  and not the position, because the phase 4 and phase 5 gates are both put at
  `built` and a ref has to tell them apart. **Under autopilot both halves
  still go out**, back to back: the verdict is yours instead of the user's,
  and a reader watching the stream should see the same trail either way.

### Not stopping at gates: phase autopilot and --ship

One concept, two entry points. The concept is that **the session does not
stop at gates**: everything a gate *does* still happens, and only the stopping
stops.

- **The phase 1d gate's fourth option**, *from here on out, go all the way to
  implement*, auto-advances the phase 2, 3 and 4 gates and stops at the phase
  5 exit gate.
- **`--ship` in `$ARGUMENTS`** declares the session **unattended from the
  start**: nobody is reading, so no gate is put to a person, and the exit is
  taken rather than offered. It composes with `--quick` and works without it.

**Why one stops at phase 5 and the other does not is derived, not decreed.** A
person answered the phase 1d gate, so somebody is evidently reading, and the
exit is a question worth putting to them. `--ship` is the same switch thrown
before any code exists, when nothing proves that, so there is nobody to put it
to. The difference is not how far the session is trusted; it is whether anyone
is there.

Under either, refresh the feature context at every phase boundary and push it.
Report what each phase produced (the spec link, the ticket list, the diff
summary and review findings) as you pass through, so a reader reading back
sees the same trail they would have approved. Where a phase skill asks the
user something of its own, `/to-tickets`' granularity quiz above all, answer
it with your own recommendation and say that you did; never drop the question
silently.

#### What `--ship` may reach

**Ceiling.** `--ship` takes the furthest exit `.harness-version` already
permits, and never grants itself one. Read the configuration at phase 0 and
resolve exactly one row:

| `.harness-version` | `--ship` takes |
|---|---|
| `reviewers:` configured | `/review` |
| no `reviewers:`, and `agent-authority:` does not grant `release` | `/to-preprod`, and says so |
| no `reviewers:`, and `agent-authority:` grants `release` | `/release` |

Read `agent-authority:` as the list it is. The middle row is the default and
covers three configurations that are one fact: the key is absent, the key is
empty, or the key grants something other than `release`. Every repository
matches exactly one row, and a repository that matches none would mean this
table has a hole rather than that the run has no exit.

`reviewers:` **lowers the ceiling and never raises it.** A repository that
names reviewers has withheld the permission to merge without a human on the
diff, so here the job becomes getting the change reviewable without stopping:
open the pull request, do not merge it.

**The flag is not authority, and `/release` says so itself.** That skill's
`## Authority` section accepts a grant in `.harness-version` or a user asking
in this turn, and it names a `--ship` flag as neither: a flag typed before any
code exists is not informed consent about a specific release. The grant is
what makes the bottom row reachable, it was made once, and it is revocable in
a commit.

**So `--ship` does not mean production; the grant does.** The one line that
moves a repository from the middle row to the bottom one is this, in
`.harness-version`:

    agent-authority: release

Add it and `--ship` runs the feature branch to `preprod` to `main` and tags a
release, carrying everything already queued on `preprod`. Leave it out and
`--ship` stops at `preprod`, which is a complete, filed, merged outcome and not
a stand-down. **Phase 0 says which of the two this run is**, in the line it
already writes about the exit, so nobody learns it at phase 5.

**Under the grant, the chained `/release` does not re-ask.** Its step 4
blast-radius question is skipped, on the same grounds `--quick` skips it and
for the reason its `## Authority` section now states: the grant is the consent
and there is nobody to ask a second time. Standing down there would make the
grant worthless for the case it was granted for. Its step 3 blast-radius
report is still produced, still reported, and still recorded in the feature
context, because a release nobody was asked about must still be one somebody
can read afterwards.

#### What `--ship` still stops for

**Floor.** `--ship` still stands down. It removes gates, never blocks.

**A gate asks "shall I continue?" A block asks "which way?"** `--ship` answers
the first permanently and in advance. It answers the second never, because you
cannot pre-answer a question nobody has asked yet. These still stop, and
standing down is the answer to each:

- A merge conflict with two incompatible intents in one hunk.
- A red check whose cause cannot be established. Being unable to fix it is not
  the same as being unable to explain it, and the second is the block.
- A review finding that is architecturally significant rather than local.
- Any design decision arising mid-build that was not settled beforehand.

**A grill break-out is the fourth case, reached earlier.** `/grilling` breaks
out of autonomy for a decision that is genuinely the user's, and under `--ship`
there is nobody to break out to. Stand down there exactly as mid-build, and do
not answer it because the run is supposed to be fast.

**A gate `--ship` would answer `park` or `drop` is a block, not a verdict.**
Dropping the change somebody asked for is a "which way?" question. Stand down
and let a person answer it.

**What `--ship` never skips**: the full check, and green as a precondition for
the exit; the regression test for a bug fix; Capture, the key and the work
item, which are the audit trail and what `/release` closes by key; and the
stand-down path in full, the four records and the reply block alike.

#### Gates under either entry point

Everything a gate *does* still happens. The two journey gates keep their
verdicts and their artefacts: the 1a **worth pursuing** verdict still rewrites
`## Challenge` and applies the `pursue` label, and the 1d **build it** verdict
is still commented on the work item. A resumed session reads the same tree
either way. Only the answerer changed.

**Autopilot brings the user the phase 1d gate; `--ship` answers it.** Under
autopilot that gate is never skipped, because it is the one place the whole
settled design is visible in one piece before it becomes tickets and code, and
a person is there to look at it. Under `--ship` nobody is, so the session
answers it and records the verdict as an artefact.

**Autopilot and grill autonomy are two switches, not one.** Autonomy (in
`/grilling`) answers questions *inside* phases 1a and 1b. Autopilot advances
phase *gates*. Granting autonomy mid-grill still brings the user the phase 1d
gate. **`--ship` throws both**, because unattended is a fact about the world
rather than a preference about pace, and both switches answer the same
question: who answers. Without grill autonomy, a `--ship` run carrying no
`--quick` would stall on the first round of phase 1a, which is the opposite of
the point.

**(connected) Two things neither entry point answers: the conflict card and
the strict pause** (see "The conflict protocol"). Both are the user's decision
about the specification itself, not about this session's pace. The session
still stops there and renders the card or the pause; under `--ship`, where
there is nobody to wait for, it stands down.

Going backwards stays allowed. If phase 3 exposes a hole, return to phase 1b
for that branch of the tree; neither entry point is a reason to build on a
gap.

**Neither switch survives the session.** Record in the feature context which
one was used, so a reader knows why the run carries no approvals. A resumed
`/continue` session never re-arms either: a switch flipped yesterday, or a
flag typed yesterday, must not drive a session started today.

## The feature context

The committed file `.harness/feature-context/<slug>.md` is this feature's
memory across sessions and colleagues. The format and lifecycle contract
live in `.claude/HARNESS.md`; the short version:

- Phase 0 creates it. It is a rewritten summary, never an append-only
  log: current phase, next step, decisions settled (with what was
  rejected and why), open frontier, scope boundary, tracker links, exit
  route once chosen, and whether autopilot or grill autonomy was granted,
  naming `--ship` where the flag is what granted them.
  It also carries the change key and its work item, the challenge verdict
  and the build verdict, a `## Blocked` section while the session is
  standing down (`.claude/JOURNEY.md`, "Blocked"), and **(connected)** the
  retrieved specification, any conflict decision or strict pause waiting, and
  the three sections `/code-review` writes.
- Refresh it whenever finished work changes what a fresh reader would
  need: a decision settled, a ticket landed, direction changed. Commit a
  refresh that touches only this file with the message prefix
  `chore(context):`; the harness workflows key on it to skip busywork.
- Commits are cheap; pushes ride along with pushes that are happening
  anyway, plus a mandatory push at every gate and at session end. Only
  the pushed copy survives the container, so an unpushed context is a
  lost context.
- `/to-preprod` consumes and deletes it at merge time. It never reaches
  `preprod`.
- **The touched set rides this same beat**, and is one habit with it, not a
  second one. Whenever you refresh this file, refresh the declaration on the
  `coordination` branch too, and report anything new the overlap shows. The
  journey position rides the same write: at a phase boundary add
  `--phase=<position>` to the refresh below, and the record says where the
  feature is (`.claude/JOURNEY.md` lists the positions and the two writes
  each transition gets):

      R=$(mktemp -d)
      bash .claude/scripts/coordination.sh feature "$FEATURE_NAME" > "$R/mine.md"
      node .claude/scripts/touched-set.mjs refresh --from="$R/mine.md" \
        --path=<anything the plan now reaches>

  Write the result back with `mcp__github__create_or_update_file`, with the
  `sha`. `refresh` unions the paths and moves `updated_at`, so a declaration
  only ever widens while the branch lives, and never narrows behind a reader
  who has already looked. `/to-preprod` deletes it at the merge.

## The closing block through the phases

Every reply carries one closing block, defined in `getting-started`. Only
its content changes from phase to phase:

| Phase | What the block carries |
|---|---|
| 0 | The feature name and branch, the change key and its work item, and whether this is a resume and into which phase. `Act next` is the phase you are entering, or the Capture questions |
| 1a, 1b | The grill's questions as the `Act next` items, numbered per `/grilling`. Facts a sub-agent found belong in `Good to know`; so does the challenge verdict once it is given |
| 1c | The overlap report and any conflict card in `Good to know`; the gate decision in `Act next` |
| 1d | The settled picture in `Good to know`; the build, drop or park verdict in `Act next` |
| 2 | The spec issue number, or **(connected)** the change view link and the proposal count, in `Good to know`; the gate decision in `Act next` |
| 3 | The ticket numbers and their blocking edges in `Good to know`; the gate decision in `Act next`, and say plainly that approving starts the build |
| 4 | The ticket that just landed and the check result in `Good to know`; any finding you deliberately did not act on in `Act later`; the next frontier ticket in `Act next` |
| 5 | The diff summary, the code-review findings and any ticket left open in `Good to know`; the exit choice in `Act next` |

At every gate the block carries what the phase produced and the decision
now owed, so the `AskUserQuestion` that follows is never the first place the
user learns what happened.

**Phase 5's exit choice is a question stage**, so it takes the next letter
prefix (see `/grilling`). When you then run the chosen exit, the reply still
carries exactly one block: this skill owns it, and `/to-preprod`, `/review`
or `/release` contributes items into it rather than emitting its own.

## Phase 0: name and resume

### Check preconditions

```
BRANCH=$(git branch --show-current)
```

If the branch does NOT start with `claude/`, tell the user this skill only
works on `claude/` branches and stop.

### Know which exit this session can reach, before it builds anything

Read the authority this repository grants, now, at phase 0:

    AUTHORITY=$(sed -n 's/^agent-authority: *//p' .harness-version | tail -1)

`/to-preprod` and `/review` need no grant and are always reachable.
`/release` is reachable only if `release` appears in that list, or the user
asks for it at the phase 5 gate (forge decision record 0037).

**Say so in phase 0's closing block, in one line**, naming the exits this
session will be able to take. A caller who learns at phase 5 that the session
cannot file its own work has been told five phases too late, and that is the
failure this line exists to prevent. Record the same line in the feature
context under `Exit route`, as "reachable exits" until one is chosen.

**`--ship` resolves that list to one exit, here.** The ceiling table in "Not
stopping at gates" above takes `.harness-version` and returns exactly one row.
Name the exit this run will take and the row that chose it, in the same line,
and record it in the feature context: under `--ship` nobody will be asked at
phase 5, so phase 0 is the only place a person sees the decision before it
happens.

**Where the middle row chose it, say what that costs and what would change
it**, in that same line and in those terms: this run will stop at `preprod`
and will not reach production, and the one line that would change it is
`agent-authority: release` in `.harness-version`. An owner who wanted
production and gets `preprod` should learn it now, while adding a line and
re-running is cheap, rather than at phase 5 with the work already built. Same
principle as forge decision record 0037, applied to the flag instead of to the
gate.

**Then probe the alert path, once, and only under `--ship`.** An unattended
run's stand-down is only as good as its notification. The durable record is
`## Blocked` plus the `blocked` label, but the only thing that reaches a
person is the Board ask, and `ping`, `report` and `post` are three different
routes: a ring that landed says nothing about whether an ask would. Probe the
one that matters, read-only, and only when both `BOARD_URL` and `BOARD_TOKEN`
are set:

    bash .claude/scripts/cockpit.sh read >/dev/null

`read` is a GET against the same path `post` writes to, with the same
credential and the same three exits, so it is the honest test and it writes
nothing.

| What happened | Do |
|---|---|
| It exited 0 | Nothing. A check that passed is not news |
| Neither variable is set | Nothing, and do not run the probe. A repository with no cockpit is a normal repository, not a degraded one, and a line every run teaches a reader to skim past the one run it matters |
| One variable is set, or the probe exited 4 or 5 | One line: a stand-down on this run will leave the record but no alert. **Write the same line into the feature context**, because nobody reads an unattended session's output while it runs, and the person who finds the run stalled tomorrow reads that file |

**Warn; never refuse.** A `--ship` run with no Board is worse off than one
with a Board and still better off than one that never started. Refusing here
would make this one flag fail closed on the subsystem the harness makes
fail-soft everywhere else, and it would contradict the floor rule above.

### Read the idea issue, if one was passed

If `$ARGUMENTS` is a `#<number>`, fetch that issue per
`docs/agents/issue-tracker.md`. It is a brainstorm idea issue with five
sections: read **Why** first, and carry it into the work item's own `## Why`
rather than writing a new one; treat **Decisions so far** as settled (do not
re-ask them),
**Not yet specified** as the phase 1b frontier, and **Destination** and
**Out of scope** as the feature description. Comment on the issue that a
feature session picked it up, and link the issue in the feature context.

### Capture the change, and mint its key

This section runs in every repository, connected or not: the work item it
opens is where the journey's first artefacts live, and the key is what joins
the branch to the change on the cockpit. The one precondition is a
`change-prefix:` line in `.harness-version`. **Without one, stop here and say
so**: "This repository has no `change-prefix:`. Add the prefix the System
Registry issued for it to `.harness-version` and run `/feature` again." A
made-up prefix would mint keys that collide with the real ones later, so this
is fail-closed like the mint below, and nothing else in this skill runs
before it.

A change exists from the moment someone can say what it is and why it is
wanted, and everything after (the key, the work item, the branch, the
proposals) hangs off that. So the first act of a fresh feature is to ask for
three things, and to wait for them:

1. A **title**: one line, the change as a colleague would name it.
2. A **description**: one paragraph, what will be different afterwards.
3. The **why**: what is wrong or missing today that makes this worth doing.

If `$ARGUMENTS` is a `#<number>` idea issue, derive the three from its
**Destination** section and confirm them in one line rather than asking
again. If `$ARGUMENTS` already carries all three in prose, restate them in
one line and confirm. Only a bare one-liner gets the three questions in full.
A resumed session (a work item already exists) skips Capture: the change
already has a key. So does a continuation after a merge ("Continue a change
after its merge" below).

**The key is `<PREFIX>-<n>`**: the prefix from `change-prefix:` in
`.harness-version` (this repository's cached copy of its registry prefix,
safe to copy only because a prefix is immutable), and `n` the next number
from the counter `counters/change-key` on the `coordination` branch.

#### Verify the prefix against the registry, before the mint

The prefix was verified once, when the line was written. This is the one
place it is checked again, because this is the last moment before a key is
minted under it, and a key minted under a wrong prefix collides with the
registry's forever.

    PREFIX=$(sed -n 's/^change-prefix: *//p' .harness-version | tail -1)
    SYSTEM_KEY=$(sed -n 's/^system-key: *//p' .harness-version | tail -1)

**With `REGISTRY_URL` or `REGISTRY_TOKEN` unset, check nothing and say
nothing.** Trust the line and mint, exactly as before this check existed. A
repository with no registry is a normal repository, not a degraded one, and
a session that announced a skipped check every time would teach the user to
skip the one time it fires.

With both set:

    bash .claude/scripts/registry.sh prefix "$PREFIX"

| Exit | Meaning | Do |
|---|---|---|
| 0 | The prefix resolves | Compare the system, below |
| 1 | **No system has this prefix** | **Stop. Do not mint.** |
| 2 | The prefix is a shape no key could be built from | **Stop. Do not mint.** |
| 3, 4, 5 | Unset or blank variable, refused token, unreachable | One line naming which, then mint |

**Only exits 1 and 2, and a system mismatch, refuse to start.** They are the
only outcomes that say something true about the prefix. Three, four and five
say only that this session could not look, and a registry outage must never
stop a Capture: the prefix is a cached immutable fact, and an outage does not
make it less true. Say which of the three happened, in one line, and carry on.

On exit 0, read the system out of the JSON on stdout and compare it with
`SYSTEM_KEY`:

- **`SYSTEM_KEY` is empty**: mint. Put one line in the closing block naming
  the system the prefix resolved to, and offer the line that would make this
  check exact from now on: `system-key: <the permanent key>` in
  `.harness-version`. **Offer it; never write it.** The user is the one who
  knows this is their system, and a session that recorded whatever came back
  would be asserting the very thing the check exists to test.
- **`SYSTEM_KEY` matches the system's permanent key**: mint. Say nothing; a
  check that passed is not news.
- **`SYSTEM_KEY` names a different system**: **stop, and do not mint.** Say
  which system is recorded, which one the prefix resolves to now, and that
  one of the two lines in `.harness-version` is wrong. Do not guess which.

**Refusing is the point.** This is the one way `/feature` can decline to
start on something other than a missing line, and it is deliberate: a
session that waits costs an hour, and a key minted under another system's
prefix is in the registry's namespace forever, under a change that is not
theirs. Say what is wrong, say the two lines to check, and stop.

**Keys are unpadded, only.** `MYPR-1`, never `MYPR-0001`. Refuse a padded key
wherever one is offered (an argument, an idea issue, a branch name), naming
the rule: "Change keys are unpadded, like the `fr-N` slugs they follow." It
is the same rule `scripts/check-spec.mjs` applies to anchors.

Minting is a sha-guarded compare-and-swap through the GitHub contents API
(`mcp__github__get_file_contents` then `mcp__github__create_or_update_file`
on branch `coordination`; a shell script cannot call MCP):

1. Read `counters/change-key` on `coordination`. It holds one bare integer,
   the last number issued, and its blob sha.
2. If the path does not exist, **create** it with content `1` and no sha:
   the create fails if someone else created it first, which is the guard.
   The key is then `<PREFIX>-1`.
3. Otherwise write `<n+1>` **with the sha you read**: a stale sha fails the
   write, which is the guard. The key is `<PREFIX>-<n+1>`.
4. On a failed write, re-read and retry, at most three times. Report the
   collision.
5. **Fail closed.** If the branch cannot be read or written (no network, no
   branch, no tool, three collisions), stop here and say so. A change with a
   guessed key would weld two changes together in Spec Universe, which is
   worse than a session that waits. This is the one coordination write that
   is not advisory.

Record the key in the feature context the moment it is minted.

### Create the work item

Create the tracker issue immediately, per `docs/agents/issue-tracker.md`,
titled exactly `<KEY>: <title>`, with the why as its opening section:

```
## Why

<the why, verbatim>

## Challenge

Filled in by phase 1a: the why as it stands after the challenge, what was
rejected, and the verdict.

## Change key

`<KEY>`. **(connected)** Every proposal this change drafts carries
`changeId = <KEY>` and `changeUrl` = this issue.

## Specification

Filled in by /to-spec: the spec issue, or **(connected)** the Spec Universe
change view and a short summary.

## Tickets

Sub-issues of this issue.
```

This is a **thin work item**: the specification lives in the spec issue or
**(connected)** in Spec Universe under the key, and this issue holds the
title, the why, the challenge, the key, the pointer, the tickets as
sub-issues, and the labels the journey's gates apply (`pursue`, `parked`,
`blocked`). Phase 1a writes `## Challenge` and `/to-spec` writes
`## Specification`; nothing else rewrites it. It is never deleted: the
tickets are its sub-issues, the frontier query hangs off it, and closing it
as not planned is how a change is dropped.

The work item is the `captured` artefact. The touched-set record declared
below carries `phase: captured` for that reason, from its first write.

Comment on an idea issue, if one was passed, that a feature session picked it
up under `<KEY>`, and link both in the feature context.

#### Ring the cockpit

The change now exists where a reader can see it, so tell the cockpit to look,
once, in one line:

    bash .claude/scripts/cockpit.sh ping --key="$KEY"

The ping says WHERE to look and never what will be found: the key scopes the
refetch to this change, and the fact stays on the tracker and in the record.
It is the doorbell on a cockpit that polls anyway, so it can never be the
reason a Capture stops. `ping` exits 0 whatever happens, prints nothing at all
when no cockpit is configured, and one line when one is configured and the
ring did not land. Read that line, say it in the closing block if there is
one, and carry on. Do not retry it, and do not ask the user about it.

### Name the feature

Derive a short kebab-case slug from the description (for example "fix the
login seed bug" becomes `fix-login-seed`). Prefix it with the lowercase key
(`mypr-1-fix-login-seed`), so the feature branch, every later
`claude/<name>` branch and every environment start with the key, and a reader
can go from a branch name to the change view without a lookup. Then set it:

```
bash .claude/scripts/set-feature-name.sh <slug>
```

This writes `.harness-feature`, commits it, and pushes, which triggers the
GitHub Action to create `feature/<slug>` and provision Railway under that
name. It is idempotent: if the name is already set to the same slug, it is
a no-op. Do this in phase 0 even though no code exists yet, so Railway
provisioning runs in the background while you grill.

Resolve the canonical feature branch name for the rest of this skill:

```
FEATURE_NAME=$(bash .claude/scripts/resolve-feature-name.sh "$BRANCH")
FEATURE_BRANCH="feature/$FEATURE_NAME"
```

### Continue a change after its merge

A change can land in parts. Once a part has merged, `/to-preprod` has already
retired its slug: the feature branch, the touched-set record and the feature
context are gone, so a resume finds nothing, and `/continue` does not list it.
More work under the same key is a **continuation**. If the remaining work has
a different why, it is a new change instead: run a fresh `/feature`. A
continuation differs from a fresh feature in four ways:

1. **Keep the key and the work item.** Skip Capture and the mint: the key
   names the change, not the branch, and the work item stays its home.
   Comment on it that the change continues, naming the new slug and the part
   that merged (its pull request).
2. **Start from `origin/preprod`.** The merged part lives there. `main` lags
   it until a release, whatever the environment calls its default branch, and
   a session cut from `main` would build on top of a tree without the first
   part:

       git fetch origin preprod
       git merge --no-edit origin/preprod

   On a fresh session branch this is a fast-forward. Merge rather than reset,
   so a session that already has commits keeps them.
3. **Name a new slug under the same key**, and run `set-feature-name.sh`
   again: `<key>-<what this part does>`, as in `mypr-6-speakers` after
   `mypr-6-bot-look`. Never reuse the merged slug: a push under it re-creates
   a branch, and on Railway an environment, that the merge already retired.
4. **Render a fresh record and context.** Create
   `.harness/feature-context/<new-slug>.md` naming the key, the work item and
   the merged part, and declare the touched set as below, with `--phase` set
   to where this part starts: `building` under `--quick`, otherwise the first
   phase the remaining work needs. The why was challenged once already, so a
   continuation starts at phase 1b at the earliest.

The key's position then moves back, from `reviewed` or `released` on GitHub
to the new record's position. That is a continuation and not a regression;
`.claude/JOURNEY.md` ("A change that continues after its merge") says how the
cockpit reads it.

### Pick up previous work (resume)

If a feature branch already exists on the remote (a resumed session),
merge it into the local branch to pick up previous work:

```
git fetch origin "$FEATURE_BRANCH" 2>/dev/null && git merge "origin/$FEATURE_BRANCH" --no-edit
```

If the merge reports conflicts, resolve them with the merge-conflict
discipline in `/to-preprod` (its "Resolving conflicts" section) instead of
aborting.

Then show the Railway preview URL if one is already published:

```
git show "origin/$FEATURE_BRANCH:.railway-url" 2>/dev/null || echo "URL not yet available"
```

### Create or load the feature context

Read `.harness/feature-context/$FEATURE_NAME.md` if it exists (the merge
above just brought it in). If it does not, create it now with what you
know so far and commit it.

### Declare the touched set, and read the namespace

The `coordination` branch carries one record per in-flight feature saying
what that branch is going to touch, so a parallel feature sees the collision
before the merge rather than at it. The contract (the fields, the two halves,
the lifecycle) is in `.claude/HARNESS.md`; these are the steps.

**Declare what you expect to touch**, at whatever granularity you can state
honestly. A prefix with a `**` tail is a fine entry, and a wide honest
declaration beats a narrow wrong one: this is a claim about work not yet
done, never a mirror of a diff. **(connected)** Add the nodes the change
means to touch, or the single node `none` where it touches none.

    R=$(mktemp -d) && mkdir -p "$R/others"
    SPEC=$(sed -n 's/^spec_product: *//p' .harness-version | tail -1)
    node .claude/scripts/touched-set.mjs render \
      --slug="$FEATURE_NAME" --branch="$FEATURE_BRANCH" --key="$KEY" \
      --author="$(git config user.email)" --spec="${SPEC:-none}" \
      --phase=captured \
      --path=<a prefix> --path=<another> > "$R/mine.md"

`--phase` is the journey position (`.claude/JOURNEY.md`), and `captured` is
right only for a FRESH feature. **A resumed session skips the render**: its
record already exists on `coordination`, and "Work out which phase you are
resuming into" below refreshes it once, with the position the session lands
in, so a resume never writes `captured` over a later position or resets
`declared_at`. Read the existing record for `$R/mine.md` instead:

    bash .claude/scripts/coordination.sh feature "$FEATURE_NAME" > "$R/mine.md"

Connected repositories add one `--node=<slug>` per node.
`render` refuses to print a record it cannot read back, and says why. Keep
the record under `mktemp -d` rather than a fixed path: two sessions share one
`/tmp`, and the namespace copy below must not contain your own record twice.

**Declare the work, not the harness's own bookkeeping.** `.harness-feature`
and `.harness/feature-context/**` are touched by every feature there has ever
been, so declaring them would put a collision in every report and teach the
next reader to skim past it. Everything else the branch will reach belongs in
the list.

Then write `$R/mine.md` to `features/$FEATURE_NAME.md` on the `coordination`
branch with `mcp__github__create_or_update_file`. Pass the `sha`, read with
`mcp__github__get_file_contents` on the same path and branch, when the path
already exists, which a resumed session's does: this is an update by the
file's one writer, and the deliberate opposite of the ADR claim in
`/document`, where omitting the sha IS the reservation.

Then **ring the cockpit and report the boundary**, for the same reason and
with the same fail-softness as at Capture:

    bash .claude/scripts/cockpit.sh ping --key="$KEY"
    bash .claude/scripts/cockpit.sh report captured "captured: <the title>" --key="$KEY"

Both are written out here because phase 0's write is a `render`, not the
refresh recipe, so it is the one record write that does not inherit the ring
and the report from `.claude/JOURNEY.md`. Every later one does. The report is
also the session's first, so a cockpit that refuses every report from this
repository says so here, once, before any work starts (`COCKPIT REPORTS OFF`,
`.claude/JOURNEY.md`), rather than at the first gate.

**Read the namespace and report:**

    C="bash .claude/scripts/coordination.sh"
    for slug in $($C features); do $C feature "$slug" > "$R/others/$slug.md"; done
    $C feature-branches > "$R/branches.txt"
    node .claude/scripts/touched-set.mjs overlap --mine="$R/mine.md" \
      --dir="$R/others" --branches-file="$R/branches.txt"
    bash .claude/scripts/coordination.sh adr-collisions "$FEATURE_BRANCH"

Put what it prints in the closing block, and copy it into the feature
context under `## Parallel work` when it found an overlap: name the other
branch, say what overlaps, and carry on. It is advisory and it stops
nothing, so an overlap is a thing to know, never a thing to wait on.

**An `ADR NNNN:` line is the one thing here that is not advisory.** It names
a decision record this branch adds under a number that is already taken, on
`preprod`, on another feature branch or by another feature's claim. Two
records cannot share a number and the gate refuses the pair, so renumber this
branch's record now, while its number is cited in the fewest places, with the
steps in `/to-preprod` step 2. Phases 1c and 5 re-run this recipe, and so run
this check again.

**Sweep what has no writer left.** A record the report calls stale belongs to
a branch that is gone from the remote and has not been touched in a day, so
nobody is coming back to update it: remove it with `mcp__github__delete_file`
on the `coordination` branch. Sweep only what the report names. Two guards
sit behind that word and neither is yours to second-guess: an empty branch
list means the remote could not be read, so nothing is stale; and a record
younger than a day is never stale, because your own was written before this
feature's branch existed.

**Every step here warns in one line and continues.** No coordination branch,
no network, no MCP tool, a malformed record: say so and go on with the
feature. Nothing about the touched set is fail-closed, and the contrast with
the change-key mint above is deliberate: a guessed key welds two changes
together forever, while a missing declaration costs one advisory warning.

### Work out which phase you are resuming into

A resumed session must not re-grill work that is already specced. The
feature context says where things stood; verify it against the durable
artifacts on the tracker (see `docs/agents/issue-tracker.md`), in this
order, and enter the first phase whose artifact is missing:

1. **The work item** titled `<KEY>: ...`, found by the key (the leading part
   of `.harness-feature`). Missing means Capture has not happened, so this is
   a fresh feature.
2. **`## Challenge` on it, with a verdict.** Empty means phase 1a. A `parked`
   label means the change is parked: say so, and continue only if the user
   un-parks it (remove the label, then carry on from the phase the rest of
   this list names).
3. **The feature context's settled decisions and scope boundary.** Missing
   means phase 1b; present with no build verdict recorded means 1c or 1d,
   whichever the context names.
4. **The specification**: a spec issue whose title carries the feature slug,
   or **(connected)** a `## Specification` section carrying a change view
   link. Missing means phase 2.
5. **Ticket issues** referencing it. Missing means phase 3.
6. **Open tickets** among them. Any open means phase 4; all closed means
   phase 5.

Then **write the phase** for the position you landed in, whatever the record
says: the record is the one field a crashed session leaves wrong, and a
resume is the cheapest moment to correct it. A `## Blocked` section in the
context means the last session stood down; read it before anything else, and
clear it (the section, and the `blocked` label on the work item) only once
the block is actually gone.

**(connected)** Then check the feature context for a **strict pause waiting**
(see "The conflict protocol"): if one is recorded, re-read that proposal
before anything else and act on its state as `CONFLICT-PROTOCOL.md` says.

Say which phase you landed in and why, then gate: confirm with the user
before continuing there. The tracker is the source of truth for phase
state; the feature context is the source of truth for the reasoning
(decisions, rejections, open questions) that the tracker does not carry.

## The conflict protocol **(connected)**

A feature can collide with the specification as it stands: a node whose text
says the opposite of what the feature intends, a rule another system is bound
by, a criterion the change would make false. That collision can surface at any
phase, and whenever it does, **STOP and read
[CONFLICT-PROTOCOL.md](./CONFLICT-PROTOCOL.md)**, which owns the conflict
card, the A/B/C fork (amend, retire, conform), the three places the decision
is recorded, and the strict pause. A collision is settled by that fork, in the
open, before the phase continues.

**The card and the pause are the user's decisions**, exempt from phase
autopilot and from grill autonomy, and never self-answered.

## Phase 1: challenge, shape, assess, decide

Phase 1 is four journey transitions with four artefacts, so a reader can see
which question has been answered without reading the transcript. Each starts
by writing its transition's key and ends by writing its state's key
(`.claude/JOURNEY.md`, "two writes per transition").

### Phase 1a: challenge the why (`challenging`)

Write `phase: challenging`. Then run a **short** `/grilling` on the WHY
alone: what is wrong or missing today, who feels it, what happens if nothing
is built, and whether this change is the right answer to that. Not the how,
and nothing about the design tree. Two or three questions is the usual size.
This transition exists so a change gets asked "why do you want this?" once,
in the open, before anyone invests in "what exactly".

If phase 0 loaded an idea issue whose **Decisions so far** already settle
the why, restate it in one line and put the verdict to the user without
re-asking.

Post each round (the questions and the answers) as one comment on the work
item as it lands: the rounds are history the tracker keeps, and they are
what a reader sees while this transition is in progress.

Then gate: the **worth pursuing** gate, verdicts `pursue`, `drop` or `park`,
put to the user with `AskUserQuestion`, or answered by the session under
`--ship` ("Not stopping at gates" above). On `pursue`, rewrite `## Challenge`
on the work item (the why as it stands now, what the challenge rejected, the
verdict), apply the `pursue` label, record the verdict in the feature
context, and write `phase: challenged`. On `park` or `drop`, do what
`.claude/JOURNEY.md` says under "Gate verdicts" and stop.

### Phase 1b: shape the how (`shaping`)

Write `phase: shaping`.

**Retrieve the specification first, and never snapshot it. (connected)** Load
the three to six nodes the change's own words reach, not the whole product: a
whole-product snapshot runs over the tool result cap, so it buys a truncated
document that still lacks the node the feature is about. The snapshot command
stays on the client for the one thing it is good at, a person asking for a
whole-product view.

The terms are the Capture **title and why, verbatim**. A session that picks
its own nouns makes a judgement twice and makes it differently on the resume;
a session that finds the vocabulary does not match adds terms with
`--include=<slug>` and records that it did.

```
R=$(mktemp -d)
P="$SPEC_PRODUCT"
printf '%s\n%s\n' "<the title>" "<the why>" > "$R/terms.txt"
SU="bash .claude/scripts/spec-universe.sh"

# The node list is REDIRECTED, never read into context: that is the whole
# saving. Only the selected nodes are ever paid for.
if $SU nodes "$P" > "$R/all.json"; then
  node scripts/retrieval.mjs select --product="$P" --nodes="$R/all.json" \
    --terms-file="$R/terms.txt" --dir="$R" > "$R/slugs.txt" || exit 1
  # A `for` over the file, never a pipeline into `while read`: an inner
  # command that reads stdin would eat the rest of the slug list with no
  # error, and truncate the set silently.
  for slug in $(cat "$R/slugs.txt"); do
    $SU node "$P.$slug" > "$R/$slug.node.json"
    $SU dependencies "$P.$slug" out > "$R/$slug.deps.json"
  done
else
  node scripts/retrieval.mjs select --product="$P" --dir="$R" \
    --terms-file="$R/terms.txt" --fault=$?
fi
node scripts/retrieval.mjs render --dir="$R"
```

`render` prints the block on stdout and **one summary line on stderr**: the
node count, the byte count and the terms. Report that line, so the cost of the
load is visible at the load. Paste the block into the feature context as its
`## Retrieved specification` section.

Dependencies are listed by name, never fetched: a governing requirement whose
text turns out to matter is read on demand with `$SU node "$P.<slug>"`. That
is the judge's rule at interview scale, and it is why the set stays at 5 to
10 KB.

**The block is interview context and never the text a write is built from.**
It carries `readAt` and each node's version so a reader can see how old it is;
`/to-spec` re-reads live the node it is about to propose against, because a
proposal built on the recorded copy would replace a field with a value someone
else has since changed.

The three client faults reach the block as themselves. Exit `3` and `4` are
configuration faults, named as such; exit `5` means "spec unreachable, cannot
verify", and the grill then covers only what touches no existing node. A check
still fails closed; an interview degrades in the open, which is what the fault
block is. Nothing is committed but that block, and it dies with the feature
context at the merge: no copy of the specification outlives the change it
served.

With the retrieved set in context, an answer that collides with a node is
recognisable in the round it is given, which is the cheapest moment for the
conflict card. A collision with a node retrieval did NOT reach is still a
collision: `/to-spec`'s conflict sweep is what catches it, and it reads live.

Run a `/grilling` session on the feature description, using
`/domain-modeling` to keep the vocabulary sharp and to catch decisions
that deserve an ADR.

This is an interview, not a research task. Facts are yours to find
(dispatch sub-agents at the codebase); decisions are the user's to make.
If phase 0 loaded an idea issue, grill only the **Not yet specified**
frontier; the settled decisions are settled.

Phase 1b is done when the grill is **satisfied**, which means all of:

- The frontier is empty: no question left whose prerequisites are
  settled.
- Every assumption you would otherwise carry silently into the spec has
  been put to the user and answered.
- New domain vocabulary is in `docs/GLOSSARY.md` and any one-way decision
  has an ADR under `docs/decisions/`, per `/domain-modeling`, written through
  `/document adr <title>` so its number is claimed before the file exists.
- You can state the scope boundary: what this feature does NOT do.
- **(connected)** Every conflict the grill surfaced has a recorded A/B/C
  decision. A conflict can surface in any phase; 1c is where the settled
  decisions are checked as a set.

If you cannot say all of those, you are not done. Keep asking.

Then write `phase: shaped` and gate: continue to phase 1c, stay in 1b, or
revise a settled decision.

### Phase 1c: assess the impact (`assessing`)

Write `phase: assessing`. The question is "where is the impact?", and the
answer is three artefacts:

1. **The touched set, in full.** Refresh the declaration with every path the
   settled decisions now reach and, **(connected)**, one `--node` per
   implicated node (or the single node `none`). Re-run the overlap report
   from phase 0 and put what it says in the closing block and, where it
   found an overlap, under `## Parallel work` in the feature context.
2. **The settled decisions against the specification. (connected)** For each
   decision, the nodes it touches in the retrieved block: a decision that
   contradicts a node's text is a collision, and the conflict card is
   rendered now (see "The conflict protocol"). A collision with a node
   retrieval did not reach is still caught by `/to-spec`'s sweep, which reads
   live.
3. **Every conflict with a recorded A/B/C decision. (connected)**

Then write `phase: assessed` and gate: continue to phase 1d, or stay.

### Phase 1d: decide (`deciding`)

Write `phase: deciding`, then put the **build it** gate to the user with the
settled picture in front of them, using `AskUserQuestion`. Under `--ship` there
is nobody to put it to, so answer it and record the verdict ("Not stopping at
gates" above). The options: `build` (continue
to phase 2), `build` under **phase autopilot** (go all the way to implement,
see above), `park`, or `drop`. "Stay in phase 1" and "revise a settled
decision" remain available and send the flow back to 1b.

On `build`: comment the verdict on the work item, record it in the feature
context, and write `phase: committed`. On `park` or `drop`: do what
`.claude/JOURNEY.md` says under "Gate verdicts" and stop.

**Phase 1 is done** when `committed` has been written. Under autopilot the
next three gates are advanced; this one is never skipped, because it is the
one place the whole settled design is visible in one piece before it becomes
tickets and code, and a person is there to look. Under `--ship` it is answered
rather than skipped: the verdict is still given and still recorded.

## Phase 2: spec

Write `phase: planning`: the spec and the tickets are one transition on the
journey, and this is where it starts.

Run `/to-spec`. It synthesizes this conversation, so do NOT re-interview
the user. It publishes to the tracker and puts the feature slug in the
issue title so a resumed session can find it.

**(connected)** It instead runs the conflict sweep, writes the specification
as Spec Universe proposals under the change key, and UPDATES the work item
with the change view link and a short summary. A conflict it finds comes back
here as a conflict card.

Record the spec issue number, or the change view link and the proposal ids,
in the feature context.

Then gate.

## Phase 3: tickets

Run `/to-tickets` against the spec from phase 2. Tracer-bullet vertical
slices, each declaring its blocking edges, each published as its own
issue referencing the spec issue as parent.

`/to-tickets` quizzes the user on granularity itself. That quiz is part of
this phase, not a substitute for the gate that follows it.

Record the ticket issue numbers in the feature context, and write
`phase: planned`: the tickets with their blocking edges are the `planned`
artefact, and they now exist.

Then gate. This is the last gate before code gets written, so make it
explicit that approving means building starts: it is the journey's **plan
accepted** gate.

## Phase 4: implement

Write `phase: building`.

Run `/implement` against the tickets, working the frontier: any ticket
whose blockers are all closed. Commit per ticket and close each as it
lands.

An ADR the build turns out to need is written through `/document adr
<title>` the moment its decision settles, as in phase 1b, and never from a
hand-copied `TEMPLATE.md`: the claim is what stops a parallel feature taking
the same number. Quick mode skips phase 1b, so this is where its ADRs are
claimed.

`/implement` owns the build loop, `/tdd` at agreed seams, and the final
full check. Do not improvise a different loop here.

When the frontier is empty and the full check is green, run
`/code-review` (fixed point: `origin/preprod`). Act on what it finds, or
record in the feature context why a finding is deliberately not
addressed.

**(connected)** Its Spec axis judges every implicated node against Spec
Universe and writes the three verdict sections into the feature context. A
`drifted` verdict against current text that no decision explains is a
conflict: render the card.

Then write `phase: built`, and record in the feature context the full
check's result and the **code sha** it ran against: the last commit that
touched anything outside `.harness/`. Commits after it that touch only the
feature context or a signal file do not move that sha, and the record says
so, because phase 5 adds exactly such commits before the push and a reader
comparing the recorded sha to the pushed head must know why they differ.
That record is half of what `verified` means on the journey
(`.claude/JOURNEY.md`); the check run on the pushed head is the other half,
and a repository whose CI runs fewer checks than its `check:` line cannot
claim more than this record says.

Then gate: show the diff summary, the check result, and the
`/code-review` findings summary before asking to move to phase 5. Carry
that findings summary forward; phase 5 puts it in the PR body.

## Phase 5: push and hand over

Ensure everything is committed and pushed:

```
git push -u origin "$BRANCH"
```

A PostToolUse hook will try to display the Railway preview URL, but hook
output is often not visible in context. You MUST fetch it manually:

```
bash .claude/scripts/get-railway-url.sh
```

The helper resolves `feature/<name>` from the current `claude/` branch
(slug from `.harness-feature`, else codename), polls until `.railway-url`
is published, and prints the URL. If provisioning is still running when it
returns empty, just re-run it; the publishing step is idempotent and
self-healing, so a later run on the same branch will commit the missing
URL.

This is the primary way the user sees their preview URL. The post-push
hook is unreliable. Always run the helper and include the URL in your
summary.

Having the URL is not the same as the deploy being live: Railway still
has to build and deploy the pushed code, which takes a minute or two
(several on a first push, which provisions the whole environment). So
verify it, and tell the user WHY the session is staying open before the
wait starts, in roughly these words: "Your push is in and Railway is
building the preview. I'm staying in this session and checking
continuously; I'll tell you here the moment your changes are live."
Then run:

```
bash .claude/scripts/verify-deploy.sh
```

It compares the `x-harness-sha` response header (the deployed commit,
baked in by the app) against the tip of `feature/<name>`, which is what
actually deploys (the Action merges your push into it), and polls for
up to 8 minutes. Report its verdict:

- `deploy-verified:`: tell the user their changes are confirmed live at
  the URL, naming the short sha, so they can open it and see the work
  of this session running.
- `deploy-equivalent:`: the preview is current and nothing is still
  rolling, because this session changed no path Railway watches
  (`docs/architecture/railway-environments.md`). Give the URL and say
  "current, and no deploy was due", not "verified" on its own.
- `deploy-pending:`: be honest: the environment answered (or not) but
  is not yet serving this push; give the URL, say the deploy is likely
  still rolling, and that re-running
  `bash .claude/scripts/verify-deploy.sh` any time will re-check. If
  `serving:` names an older sha, say the previous version is still up.

Refresh the touched set one last time: widen the declaration wherever the
work reached outside what phase 0 claimed, and leave it alone where it was
right. It stays a declaration of the branch's scope, never a copy of the
diff. Then re-run the overlap report from phase 0, because both sides of
every overlap have moved since, and put what it says in the summary. The
phase stays `built`: from here the journey is read from GitHub (the check on
the pushed head, the pull request, the merge, the release), and
`/to-preprod` deletes the record at the merge.

Summarize: what was built, which files changed, the spec and ticket issue
numbers, the `/code-review` findings summary, any in-flight feature that
overlaps this one, any ticket left open, and the Railway preview URL with
its verification verdict.

**Under `--ship` there is no question here.** The ceiling table resolved this
run's exit back at phase 0; take that exit now, and say which row chose it.
Everything else in this phase still applies: the summary above, the record
below, the push of the feature context before the exit merges the branch out
from under you, and the `## Authority` read before `/release`. Only the asking
is skipped.

**On the bottom row, `/release`'s own confirmation is covered too**, on the
terms the ceiling section above sets out; do not re-derive them here. Read the
grant out of `.harness-version` yourself before following the file: an absent
grant means the ceiling table never chose that row, and taking it by hand
would be the same forbidden act as invoking it.

Otherwise, ask the user which exit they want, using `AskUserQuestion`:

- **`/to-preprod`**: auto-merge to preprod. The default suggestion when
  `.harness-version` has no `reviewers:` field. **(connected)** Its preprod
  gate reports every `drifted` verdict this branch INTRODUCED that no accepted
  proposal covers, and under `gate-mode: enforce` refuses the merge on one, so
  a conflict left undecided stops here rather than on `preprod`. Under
  `evaluate`, the default, the same rows are printed in the same words and the
  merge proceeds; the run is recorded either way.
- **`/review`**: open a PR that waits for human review. The default
  suggestion when `.harness-version` configures `reviewers:`.
- **`/release`**: merge to preprod and ship to production in one go. Offered
  always, suggested never; the user picks this one deliberately or not at
  all. Its own confirmation still applies, so they will see the release's
  blast radius (everything queued on `preprod`, not just this feature) before
  anything reaches `main`.

Suggest the default for this repo, but always ask; never assume.

Then **run the chosen exit**. Record it in the feature context and push
that first, because the exit merges the branch out from under you.

**Running it means reading that skill's `SKILL.md` and following its steps
in order, to the end**, trigger push included:

| Answer | Follow |
|---|---|
| `/to-preprod` | `.claude/skills/to-preprod/SKILL.md` |
| `/review` | `.claude/skills/review/SKILL.md` |
| `/release` | `.claude/skills/release/SKILL.md` |

Follow the file rather than invoking the skill: reading a `SKILL.md` and
working its steps is the established route (forge decision record 0017), and it
is what the
overlay checker resolves this table against. `/to-preprod` and `/review` carry
no `disable-model-invocation` any more and would also fire through the Skill
tool; either way is fine for those two.

**The authorization is the user's answer at this gate**, and for `/release` it
is one of the two things its own `## Authority` section accepts. Read that
section before following the file: if this repository has granted no
`agent-authority: release` AND no user picked `/release` here, the exit is not
available and performing its steps by hand would be the same forbidden act
(forge decision record 0037).

**Under `--ship` the authorization is the grant alone**, because there was no
answer at this gate and the flag is not one. That is why the ceiling table
reaches `/release` only where `.harness-version` grants it, and why a run
without the grant takes `/to-preprod` and says so rather than standing down:
it has work worth filing and an exit it may take.

**Do not stall at this gate**, flag or no flag. A session that asked and got no
answer because nobody is reading resolves the ceiling table above and takes
that exit, exactly as a `--ship` run would; the flag is how an operator says so
in advance, not the only way it can become true. Stand down
(`getting-started`, Step 3c) only for an exit you genuinely may not take, and
never report the feature complete while its work sits unmerged on a `claude/`
branch.

Autopilot, if it was granted at the phase 1 gate, ends at this question. It
advances gates; it never picks an exit. `--ship` is the entry point that does,
and "Not stopping at gates" above is where both are defined.

## Standing down

A phase can hit something it cannot get past: a red check, a conflict card
or strict pause waiting on the user, a merge conflict this session cannot
resolve, a question only the author can answer. When that happens and the
session is going to end without clearing it, follow "Blocked" in
`.claude/JOURNEY.md`: `## Blocked` in the feature context, the `blocked`
label on the work item, and one Board ask through `.claude/scripts/cockpit.sh`
only when a person is what unblocks it. Do NOT rewrite the phase: the record
keeps naming the transition that was in progress, and its staleness is what
tells the cockpit the work stopped. Push the context before ending.

**Then say it in the reply, in the one shape.** The four steps above are the
*record*; the stand-down block (`getting-started`, Step 3c) is how the same
fact reaches the person or coordinator reading this session. Emit it, and do
not describe the feature as complete in a reply that carries it. A feature
whose work sits unmerged on a `claude/` branch is not complete, however much
of it was built.

## Quick mode (escape hatch)

Skip phases 1 to 3 and go straight to phase 4 ONLY when the user opts out
explicitly: `$ARGUMENTS` contains `--quick`, or the user says in words to
skip the grill / spec / tickets.

You may **propose** quick mode for genuinely trivial work (a typo, a
one-line config tweak, a dependency bump) but you may never take it on
your own. Ask, then wait for the answer. Anything that changes behavior,
schema, or a public interface is not trivial, whatever its diff size.

**Quick mode and `--ship` are orthogonal**, and compose in either order.
`--quick` removes phases; `--ship` removes stops. See "Not stopping at gates"
above for what the flag does, including on a run that carries no `--quick`.

In quick mode, still do phases 0 and 5, including the feature context,
Capture, the key and the work item. A change too small to specify is still a
change, and its key is what `/release` closes. The record goes from
`captured` straight to `building`: write both, and let the gap show. A change
that skipped four states should look like it did.
