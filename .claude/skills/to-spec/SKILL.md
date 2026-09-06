---
name: to-spec
description: Turn the current conversation into a specification and publish it. No interview, just synthesis of what was already discussed. Phase 2 of /feature, also usable on its own after a design conversation.
---

# To Spec

Take the current conversation context and codebase understanding and
produce the specification of the change. Do NOT interview the user;
`/grilling` already happened. Synthesize what you know.

## The spec loop, and the one key that switches it

Where a specification lives depends on one key in `.harness-version`. Read it
before anything else:

    SPEC_PRODUCT=$(sed -n 's/^spec_product: *//p' .harness-version | tail -1)

**Empty or absent: this repository has not connected a specification.** Take
every step marked **(dormant)**, skip every step marked **(connected)**, and
publish per the tracker contract in `docs/agents/issue-tracker.md`. Nothing
about the loop is mentioned to the user.

**Set: the loop is awake.** The specification lives in Spec Universe, as
proposals under the change key, against the nodes of the product: that is the
one home of what the system does, and the anchors in the code cite it
(`.claude/SPEC-LOOP.md`). The tracker issue is then a **thin
work item**: title, why, key, a pointer to the change view, and the tickets.
It never holds the spec text, because a second copy of a specification is the
copy nobody updates.

Every Spec Universe read and write goes through the shared client:

    SU="bash .claude/scripts/spec-universe.sh"

It fails closed, and the three faults it distinguishes (exit 3 a missing
credential, 4 a refused token, 5 unreachable, printing exactly
`spec unreachable, cannot verify`) are documented once in
`.claude/SPEC-LOOP.md`. On any non-zero exit, stop and report
what the client printed. A sweep that could not read the specification has
not swept, so write nothing and say so.

## Process

1. Explore the repo to understand the current state of the codebase, if
   you have not already. Use the vocabulary from `docs/GLOSSARY.md`
   throughout, and respect any ADRs under `docs/decisions/` in the area you
   are touching.

   **(connected)** For the specification, read the `## Retrieved
   specification` section of the feature context, which `/feature` phase 1
   wrote. Do NOT snapshot the product: a whole-product snapshot runs over the
   tool result cap, so it buys a truncated document that still lacks the node
   the change is about. Standalone, with no feature context, run the
   retrieval recipe in `/feature` phase 1 against the change's title and why.

   **What the retrieved set is for, and what it is not.** It is interview
   context: enough to recognise a collision in the round it is given. It is
   not the text a write is built from, and it is not the conflict sweep.
   Step 3 reads live, and step 4 re-reads the node it is about to propose
   against, live, every time.

2. Sketch the seams at which the feature will be tested. Prefer existing
   seams to new ones, and the highest seam possible. If new seams are
   needed, propose them at the highest point you can. The fewer seams
   across the codebase, the better; the ideal number is one. (`/tdd` owns
   the seam vocabulary.)

   Check with the user that these seams match their expectations.

3. **(dormant)** Write the spec using the template below and publish it as
   one issue on the tracker. Put the feature slug in the issue title, so a
   resumed session can find the spec (the convention is in
   `docs/agents/issue-tracker.md`). Then report the spec issue number back to
   the user; later phases and resumed sessions depend on it, and steps 3 to 5
   below are the connected shape of this same step, so stop here.

<spec-template>

## Problem Statement

The problem the user is facing, from the user's perspective.

## Solution

The solution to the problem, from the user's perspective.

## User Stories

A LONG, numbered list of user stories, each in the format:

1. As an <actor>, I want <a feature>, so that <benefit>

This list should be extremely extensive and cover all aspects of the
feature.

## Implementation Decisions

The implementation decisions that were made. This can include:

- The modules that will be built or modified
- The interfaces of those modules that will change
- Technical clarifications from the developer
- Architectural decisions
- Schema changes
- API contracts
- Specific interactions

Do NOT include specific file paths or code snippets; they go stale fast.

## Testing Decisions

The testing decisions that were made. Include:

- A description of what makes a good test (only external behavior, never
  implementation details; see `/tdd`)
- Which modules will be tested, at which agreed seams
- Prior art for the tests (similar tests already in the codebase)

## Out of Scope

The things this spec deliberately does not cover.

## Further Notes

Any further notes about the feature.

</spec-template>

### 3. Conflict sweep **(connected)**. Required, never skipped

List every existing node the new intent **touches** (its behaviour changes, a
criterion becomes true or false, a citing node gains or loses a rule) or
**contradicts** (the node's text says the opposite of what the feature
intends). Order the list strictest first (`effectiveStrictness`: legal,
contractual, committed, free), then most critical first, because the
expensive decisions are the ones to meet early. For each node say in one line
which of the two it is and which sentence is involved.

- A **touched** node is amended by a proposal in step 4, no decision needed:
  that is what a proposal is for.
- A **contradicted** node is a conflict. STOP and read
  `.claude/skills/feature/CONFLICT-PROTOCOL.md`, which owns the conflict
  card, the A/B/C fork, the strict pause and where the decision is recorded.
  It is a user decision, exempt from phase autopilot and grill autonomy. Do
  not draft anything for that node until the fork is answered.
- An empty sweep is a legitimate result and is recorded as one ("this change
  alters nothing about what the system is"), with the node list that was
  read.

Read `boundSystems` and `citingNodes` on every requirement in the list
(`$SU node <id>`): together they are the blast radius, and every bound system
is told about a draft the moment it is written.

### 4. Write the proposals **(connected)**

One proposal per node per change, targeting only the fields the change alters
(behaviour, rulesAndEdgeCases, acceptanceCriteria, status, outsideBoundary),
because two proposals on one field collide and two on different fields are
compatible. A new capability, interface or requirement is a new-node proposal
(a requirement's slug is the next unpadded `fr-N` of the product). Each
proposal carries:

- `changeId` = the change key, which is what `/to-preprod` gates on and
  `/release` promotes.
- `changeUrl` = the work item's URL.
- a rationale that says what was decided and why, and names the conflict
  decision where there was one.

Send each through `$SU propose`, whose body is
`{node, changeId, changeUrl, rationale, fields}`: the node by composed slug,
and `fields` a record of camelCase field name to new value
(`acceptanceCriteria` as a list of `{id, text}`). The names are the client's
business and it refuses the wrong ones, because the endpoint accepts an
unrecognised key and drops it (`.claude/SPEC-LOOP.md`).

**A field is replaced whole, so amending one acceptance criterion means
sending the whole list.** Build the new value by editing the value the node
returns rather than by retyping it, or an amendment silently loses a
criterion nobody meant to touch.

**Re-read that node live, here, with `$SU node <id>`.** The retrieved set in
the feature context carries a `readAt` and a version and is otherwise just as
old as it looks: building a whole-field replacement on it would overwrite a
value someone else has changed since. Retrieval is an interview aid; a write
reads the node it is writing.

Then check `$SU change-proposals <KEY>` and paste the proposal ids into the
feature context. Reading the change view back is the check that matters: a
proposal that reports success with no change key is a proposal no release can
promote. Acceptance criteria are the unit the judge and the claims work in,
so write them checkable: one observable behaviour each, in the `ac-N` form
the product already uses.

Implementation decisions and testing decisions are not specification: they go
into the feature context (decisions, with what was rejected) and into the
tickets. User stories are the proposals' behaviour lines, not a list of their
own.

### 5. Update the work item **(connected)**

The change already has one. Rewrite only its `## Specification` section:

    ## Specification

    Change view: {SPEC_UNIVERSE_URL}/changes/<KEY>

    **Conflict sweep (<date>):** <the list from step 3, one line each, with
    the A/B/C decision taken for every contradiction, or the empty-sweep
    sentence>.

    <A short summary: five to ten lines of what the change does, in the
    glossary's words. Never the full spec text.>

The title stays `<KEY>: <title>`; the why stays as it was captured; the
tickets section is `/to-tickets`' to fill.

Standalone, outside `/feature`, with no work item yet: run `/feature`'s
Capture and minting first (its "Phase 0" section), because a proposal without
a change key cannot be promoted and a change without a work item has nowhere
for its tickets to hang.

Report the change view link and the proposal ids back to the user; later
phases and resumed sessions depend on them.

---
Adapted from [mattpocock/skills](https://github.com/mattpocock/skills) (MIT).
