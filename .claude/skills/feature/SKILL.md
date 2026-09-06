---
name: feature
description: Build a feature end to end through gated phases. Names the branch, grills the requirements, writes the spec, cuts the tickets, then implements. Accepts a brainstorm idea issue as input.
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
five phases, with a stop-and-ask gate between each one.

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
**(connected)**. The flow is exactly what it has always been, and nothing
about the loop is mentioned to the user.

**Set: the loop is awake.** Phase 0 also captures the change and mints its
key, phase 1 retrieves the nodes the change's own words reach, phase 2 writes
proposals rather than a spec issue, and phase 4's review judges against Spec
Universe. `.claude/SPEC-LOOP.md` is the whole mechanism.

## Phase map

| Phase | What happens | Skill |
|---|---|---|
| 0 | Name the feature, create the feature context, resume previous work; **(connected)** capture the change, mint its key and open its work item first | this skill |
| 1 | Interview the user until the design tree is settled | `/grilling` + `/domain-modeling` |
| 2 | Synthesize the conversation into a spec on the tracker; **(connected)** into proposals in Spec Universe, pointed at from the work item | `/to-spec` |
| 3 | Slice the spec into blocking-ordered tickets | `/to-tickets` |
| 4 | Build it, test-first at agreed seams, then review it | `/implement`, `/code-review` |
| 5 | Push, choose the exit, hand over | this skill |

You run all five in this one session. You do NOT run them back to back
unprompted: every arrow between phases is a gate (see "Gates").

## Gates

At the end of each of phases 1 to 4, STOP and ask the user to approve
moving on. Use `AskUserQuestion` with the options "continue to <next
phase>", "stay in <current phase>" and (where it makes sense) "revise
<current output>".

Rules for a gate:

- Show what the phase produced first: the settled decisions, the spec
  link, the ticket list, or the diff summary and review findings.
- Wait for the answer. Never assume approval, never advance on silence.
- "Stay" means keep working in the current phase, then gate again.
- Going backwards is allowed and cheap. If phase 3 exposes a hole, return
  to phase 1 for that branch of the tree rather than guessing.
- At every gate, refresh the feature-context file and push (see "The
  feature context" below).

### Phase autopilot

The phase 1 gate carries a fourth option: **from here on out, go all the
way to implement**. Taking it auto-advances the phase 2, 3 and 4 gates and
stops at the phase 5 exit gate.

Under autopilot, everything a gate *does* still happens; only the stopping
stops. Refresh the feature context at every phase boundary and push it.
Report what each phase produced (the spec link, the ticket list, the diff
summary and review findings) as you pass through, so the user reading back
sees the same trail they would have approved. Where a phase skill asks the
user something of its own, `/to-tickets`' granularity quiz above all,
answer it with your own recommendation and say that you did; never drop the
question silently.

**Autopilot ends at phase 5, always.** It advances gates; it never runs an
exit. The user still chooses `/to-preprod`, `/review` or `/release` with the
diff, the check result and the `/code-review` findings in front of them,
because that gate is the last thing standing between this session and
`preprod`.

**(connected) Two things autopilot never answers: the conflict card and the
strict pause** (see "The conflict protocol"). Both are the user's decision
about the specification itself, not about this session's pace. Under
autopilot the session still stops there, renders the card or the pause, and
waits.

**Autopilot and grill autonomy are two switches, not one.** Autonomy (in
`/grilling`) answers questions *inside* phase 1. Autopilot advances phase
*gates*. Granting autonomy mid-grill still brings the user the phase 1
gate, because that gate is the one place the whole settled design is
visible in one piece before it becomes tickets and code. **(connected)** Grill
autonomy carries the same two carve-outs: a conflict card or a strict pause
reached during the grill is put to the user, never self-answered.

Going backwards stays allowed under autopilot. If phase 3 exposes a hole,
return to phase 1 for that branch of the tree; autopilot is a reason to
keep moving, never a reason to build on a gap.

**Autopilot does not survive the session.** Record in the feature context
that it was used, so a reader knows why phases 2 to 4 carry no approvals. A
resumed `/continue` session does not re-arm it: a switch the user flipped
yesterday must not drive a session they start today.

## The feature context

The committed file `.harness/feature-context/<slug>.md` is this feature's
memory across sessions and colleagues. The format and lifecycle contract
live in `.claude/HARNESS.md`; the short version:

- Phase 0 creates it. It is a rewritten summary, never an append-only
  log: current phase, next step, decisions settled (with what was
  rejected and why), open frontier, scope boundary, tracker links, exit
  route once chosen, and whether autopilot or grill autonomy was granted.
  **(connected)** It also carries the change key and its work item, the
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

## The closing block through the phases

Every reply carries one closing block, defined in `getting-started`. Only
its content changes from phase to phase:

| Phase | What the block carries |
|---|---|
| 0 | The feature name and branch, and whether this is a resume and into which phase; **(connected)** the change key and its work item too. `Act next` is the phase you are entering, or the Capture questions |
| 1 | The grill's questions as the `Act next` items, numbered per `/grilling`. Facts a sub-agent found belong in `Good to know` |
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

### Read the idea issue, if one was passed

If `$ARGUMENTS` is a `#<number>`, fetch that issue per
`docs/agents/issue-tracker.md`. It is a brainstorm idea issue with four
sections: treat **Decisions so far** as settled (do not re-ask them),
**Not yet specified** as the phase 1 frontier, and **Destination** and
**Out of scope** as the feature description. Comment on the issue that a
feature session picked it up, and link the issue in the feature context.

### Capture the change, and mint its key **(connected)**

Skip this whole section when `SPEC_PRODUCT` is empty; the dormant flow names
the feature straight from the description.

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
already has a key.

**The key is `<PREFIX>-<n>`**: the prefix from `change-prefix:` in
`.harness-version` (this repository's cached copy of its registry prefix,
safe to copy only because a prefix is immutable), and `n` the next number
from the counter `counters/change-key` on the `coordination` branch.

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

### Create the work item **(connected)**

Create the tracker issue immediately, per `docs/agents/issue-tracker.md`,
titled exactly `<KEY>: <title>`, with the why as its opening section:

```
## Why

<the why, verbatim>

## Change key

`<KEY>`. Every proposal this change drafts carries `changeId = <KEY>` and
`changeUrl` = this issue.

## Specification

Filled in by /to-spec: the Spec Universe change view and a short summary.

## Tickets

Sub-issues of this issue.
```

This is a **thin work item**: the specification itself lives in Spec Universe
under the key, and this issue holds the title, the why, the key, the pointer,
and the tickets as sub-issues. `/to-spec` UPDATES it; nothing else ever
rewrites it. It is never deleted: the tickets are its sub-issues and the
frontier query hangs off it.

Comment on an idea issue, if one was passed, that a feature session picked it
up under `<KEY>`, and link both in the feature context.

### Name the feature

Derive a short kebab-case slug from the description (for example "fix the
login seed bug" becomes `fix-login-seed`). **(connected)** Prefix it with the
lowercase key (`mypr-1-fix-login-seed`), so the feature branch, every later
`claude/<name>` branch and every environment start with the key, and a reader
can go from a branch name to the change view without a lookup. Then set it:

```
bash .claude/scripts/set-feature-name.sh <slug>
```

This writes `.harness-feature`, commits it, and pushes, which triggers the
GitHub Action to create `feature/<slug>`. It is idempotent: if the name is
already set to the same slug, it is a no-op.

Resolve the canonical feature branch name for the rest of this skill:

```
FEATURE_NAME=$(bash .claude/scripts/resolve-feature-name.sh "$BRANCH")
FEATURE_BRANCH="feature/$FEATURE_NAME"
```

### Pick up previous work (resume)

If a feature branch already exists on the remote (a resumed session),
merge it into the local branch to pick up previous work:

```
git fetch origin "$FEATURE_BRANCH" 2>/dev/null && git merge "origin/$FEATURE_BRANCH" --no-edit
```

If the merge reports conflicts, resolve them with the merge-conflict
discipline in `/to-preprod` (its "Resolving conflicts" section) instead of
aborting.

### Create or load the feature context

Read `.harness/feature-context/$FEATURE_NAME.md` if it exists (the merge
above just brought it in). If it does not, create it now with what you
know so far and commit it.

### Work out which phase you are resuming into

A resumed session must not re-grill work that is already specced. The
feature context says where things stood; verify it against the durable
artifacts on the tracker (see `docs/agents/issue-tracker.md`), in this
order, and enter the first phase whose artifact is missing:

1. **Spec issue** whose title carries the feature slug. Missing means
   phase 1. **(connected)** The artifact is instead the **work item** titled
   `<KEY>: ...`, found by the key (the leading part of `.harness-feature`);
   missing means Capture has not happened, so this is a fresh feature, and a
   work item whose `## Specification` section carries no change view link
   means phase 1.
2. **Ticket issues** referencing that spec. Missing means phase 3.
3. **Open tickets** among them. Any open means phase 4; all closed means
   phase 5.

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

## Phase 1: grill the requirements

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

Phase 1 is done when the grill is **satisfied**, which means all of:

- The frontier is empty: no question left whose prerequisites are
  settled.
- Every assumption you would otherwise carry silently into the spec has
  been put to the user and answered.
- New domain vocabulary is in `docs/GLOSSARY.md` and any one-way decision
  has an ADR under `docs/decisions/`, per `/domain-modeling`.
- You can state the scope boundary: what this feature does NOT do.
- **(connected)** Every conflict the grill surfaced has a recorded A/B/C
  decision.

If you cannot say all of those, you are not done. Keep asking.

Then gate. This gate offers four options, not three: continue to phase 2,
**go all the way to implement** (phase autopilot, above), stay in phase 1,
or revise a settled decision.

## Phase 2: spec

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

Record the ticket issue numbers in the feature context.

Then gate. This is the last gate before code gets written, so make it
explicit that approving means building starts.

## Phase 4: implement

Run `/implement` against the tickets, working the frontier: any ticket
whose blockers are all closed. Commit per ticket and close each as it
lands.

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

Then gate: show the diff summary, the check result, and the
`/code-review` findings summary before asking to move to phase 5. Carry
that findings summary forward; phase 5 puts it in the PR body.

## Phase 5: push and hand over

Ensure everything is committed and pushed:

```
git push -u origin "$BRANCH"
```

Summarize: what was built, which files changed, the spec and ticket issue
numbers, the `/code-review` findings summary, and any ticket left open.

Then ask the user which exit they want, using `AskUserQuestion`:

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

These are user-invoked skills, so the Skill tool will not fire them and
you must not try. A `SKILL.md` is a file; read it and do what it says.
This is deliberate:
`disable-model-invocation` exists to stop an unprompted auto-fire, and the
user's answer at this gate is the authorization it was waiting for. No
skill's frontmatter changes, and nothing here fires without that answer.

Autopilot, if it was granted at the phase 1 gate, ends at this question.
It advances gates; it never picks an exit.

## Quick mode (escape hatch)

Skip phases 1 to 3 and go straight to phase 4 ONLY when the user opts out
explicitly: `$ARGUMENTS` contains `--quick`, or the user says in words to
skip the grill / spec / tickets.

You may **propose** quick mode for genuinely trivial work (a typo, a
one-line config tweak, a dependency bump) but you may never take it on
your own. Ask, then wait for the answer. Anything that changes behavior,
schema, or a public interface is not trivial, whatever its diff size.

In quick mode, still do phases 0 and 5, including the feature context, and
**(connected)** including Capture, the key and the work item. A change too
small to specify is still a change, and its key is what `/release` closes.
