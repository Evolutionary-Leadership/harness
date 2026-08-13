---
name: implement
description: Implement a piece of work from a spec or set of tickets, working the frontier ticket by ticket. Phase 4 of /feature, also usable on its own against an existing spec or ticket.
---

# Implement

Implement the work described by the spec or tickets.

## Input

Work from the tickets on the tracker (per
`docs/agents/issue-tracker.md`) when they exist; otherwise from the spec
issue; otherwise from what the user describes. If you were given only a
feature description and no spec, say so and offer `/feature` instead of
inventing requirements.

## Loop

Work the **frontier**: any ticket whose blockers are all closed. For each
one:

1. Re-read the ticket and its acceptance criteria.
2. Use `/tdd` where possible, at the seams the spec agreed on.
3. Typecheck and run the relevant test file(s) as you go.
4. Commit to the current branch with a message naming the ticket.
5. Close the ticket when its acceptance criteria are met, per the tracker
   contract, so the frontier query stays honest.
6. Refresh the feature-context file if the landed ticket changed what a
   fresh reader would need to know (the contract is in
   `.claude/HARNESS.md`).

Never start a ticket whose blockers are still open.

## Finishing

Run the full check once at the end: the `check:` command from
`.harness-version` if one is configured, otherwise the project's own test
and lint commands. A green in-flight CI run is not a substitute for
running it yourself.

Then use `/code-review` to review the work, and act on what it finds.

Leave the branch committed. Pushing and merging are not this skill's job:
inside `/feature` the phase gate owns the push, and `/mergedev` or
`/review` owns the merge.

---
Adapted from [mattpocock/skills](https://github.com/mattpocock/skills) (MIT).
