---
name: to-spec
description: Turn the current conversation into a spec and publish it to the issue tracker. No interview, just synthesis of what was already discussed. Phase 2 of /feature, also usable on its own after a design conversation.
---

# To Spec

Take the current conversation context and codebase understanding and
produce a spec. Do NOT interview the user; `/grilling` already happened.
Synthesize what you know.

Publish per the tracker contract in `docs/agents/issue-tracker.md`.

## Process

1. Explore the repo to understand the current state of the codebase, if
   you have not already. Use the vocabulary from `docs/GLOSSARY.md`
   throughout the spec, and respect any ADRs under `docs/decisions/` in
   the area you are touching.

2. Sketch the seams at which the feature will be tested. Prefer existing
   seams to new ones, and the highest seam possible. If new seams are
   needed, propose them at the highest point you can. The fewer seams
   across the codebase, the better; the ideal number is one. (`/tdd` owns
   the seam vocabulary.)

   Check with the user that these seams match their expectations.

3. Write the spec using the template below and publish it as one issue on
   the tracker. Put the feature slug in the issue title, so a resumed
   session can find the spec (the convention is in
   `docs/agents/issue-tracker.md`).

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

Report the spec issue number back to the user; later phases and resumed
sessions depend on it.

---
Adapted from [mattpocock/skills](https://github.com/mattpocock/skills) (MIT).
