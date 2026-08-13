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

## Phase map

| Phase | What happens | Skill |
|---|---|---|
| 0 | Name the feature, create the feature context, resume previous work | this skill |
| 1 | Interview the user until the design tree is settled | `/grilling` + `/domain-modeling` |
| 2 | Synthesize the conversation into a spec on the tracker | `/to-spec` |
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

## The feature context

The committed file `.harness/feature-context/<slug>.md` is this feature's
memory across sessions and colleagues. The format and lifecycle contract
live in `.claude/HARNESS.md`; the short version:

- Phase 0 creates it. It is a rewritten summary, never an append-only
  log: current phase, next step, decisions settled (with what was
  rejected and why), open frontier, scope boundary, tracker links, exit
  route once chosen.
- Refresh it whenever finished work changes what a fresh reader would
  need: a decision settled, a ticket landed, direction changed. Commit a
  refresh that touches only this file with the message prefix
  `chore(context):`; the harness workflows key on it to skip busywork.
- Commits are cheap; pushes ride along with pushes that are happening
  anyway, plus a mandatory push at every gate and at session end. Only
  the pushed copy survives the container, so an unpushed context is a
  lost context.
- `/mergedev` consumes and deletes it at merge time. It never reaches
  `dev`.

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

### Name the feature

Derive a short kebab-case slug from the description (for example "fix the
login seed bug" becomes `fix-login-seed`) and set it:

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
discipline in `/mergedev` (its "Resolving conflicts" section) instead of
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
   phase 1.
2. **Ticket issues** referencing that spec. Missing means phase 3.
3. **Open tickets** among them. Any open means phase 4; all closed means
   phase 5.

Say which phase you landed in and why, then gate: confirm with the user
before continuing there. The tracker is the source of truth for phase
state; the feature context is the source of truth for the reasoning
(decisions, rejections, open questions) that the tracker does not carry.

## Phase 1: grill the requirements

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

If you cannot say all four, you are not done. Keep asking.

Then gate.

## Phase 2: spec

Run `/to-spec`. It synthesizes this conversation, so do NOT re-interview
the user. It publishes to the tracker and puts the feature slug in the
issue title so a resumed session can find it.

Record the spec issue number in the feature context.

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
`/code-review` (fixed point: `origin/dev`). Act on what it finds, or
record in the feature context why a finding is deliberately not
addressed.

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

- **`/mergedev`**: auto-merge to dev. The default suggestion when
  `.harness-version` has no `reviewers:` field.
- **`/review`**: open a PR that waits for human review. The default
  suggestion when `.harness-version` configures `reviewers:`.

Suggest the default for this repo, but always ask; never assume. Record
the chosen exit in the feature context, push it, and run the chosen
skill.

## Quick mode (escape hatch)

Skip phases 1 to 3 and go straight to phase 4 ONLY when the user opts out
explicitly: `$ARGUMENTS` contains `--quick`, or the user says in words to
skip the grill / spec / tickets.

You may **propose** quick mode for genuinely trivial work (a typo, a
one-line config tweak, a dependency bump) but you may never take it on
your own. Ask, then wait for the answer. Anything that changes behavior,
schema, or a public interface is not trivial, whatever its diff size.

In quick mode, still do phases 0 and 5, including the feature context.
