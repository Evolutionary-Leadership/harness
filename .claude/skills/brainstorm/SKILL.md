---
name: brainstorm
description: Think an idea through with a relentless interview, without building anything. Writes to the issue tracker only, never to the repo.
disable-model-invocation: true
argument-hint: "<topic to think through>"
---

# Brainstorm

The middle rung of the ladder: `/chat` talks, `/brainstorm` thinks,
`/feature` builds. Use it to stress-test an idea about this repo before
anyone commits to building it.

`$ARGUMENTS` contains the topic.

**This skill never writes to the repo.** No branch, no commit, no push, no
ADR files, no glossary edits. Its only write surface is the issue tracker,
per the contract in `docs/agents/issue-tracker.md`, and only if the user
chooses to keep the thinking at the end. It is safe to run from any branch.

## Run the interview

Run a `/grilling` session on the topic, using `/domain-modeling` to keep
the vocabulary sharp. Both apply in full, with one override each:

- Facts are yours to find (dispatch sub-agents at the codebase); decisions
  are the user's.
- `/domain-modeling` normally writes the glossary and offers ADRs. Not
  here: vocabulary that crystallises and decisions that settle are
  recorded in the idea issue at the end instead. A one-way decision made
  while brainstorming ships its ADR later, with the feature that
  implements it.

Keep interviewing until the frontier is empty or the user calls it: every
branch of the design tree visited, nothing silently assumed.

## Land the thinking

When the interview winds down, state the settled picture back in a short
list, then ask the user where this lands, with exactly three options:

1. **Nowhere.** It was thinking out loud. Nothing is written anywhere.
2. **An idea issue.** Publish the state of the thinking to the tracker so
   a future session (or colleague) can pick it up.
3. **Straight into `/feature`.** Start building now: run `/feature` with
   this conversation as its input. Phase 1 will grill only what is still
   open, not restart the interview.

Never assume; ask and wait.

## The idea issue

For option 2, create one issue per the tracker contract in
`docs/agents/issue-tracker.md`, with the `idea` label and exactly these
four sections:

```
## Destination

Where this thinking wants to end up: the outcome, one paragraph.

## Decisions so far

What got settled in the interview, one bullet per decision, with the
reasoning that settled it. Mark any one-way decision as such; its ADR
ships with the feature that implements it.

## Not yet specified

The open frontier: every question the interview did not settle, so the
next session grills only these.

## Out of scope

What this idea deliberately does not cover.
```

A later `/feature #<issue-number>` accepts the idea issue as input, reads
all four sections, and enters its own flow with the settled decisions
honored and only the "Not yet specified" frontier left to grill.

For option 3, do the same synthesis but hand it to `/feature` directly in
this session; the idea issue is optional when the feature starts
immediately, and `/feature` phase 2 will produce the durable spec issue
anyway.
