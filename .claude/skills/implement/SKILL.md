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

1. Re-read the ticket and its acceptance criteria, and **report the start**.
   Bind the ref once, so the two halves of the pair cannot disagree:

       REF="$KEY:ticket-<n>"
       bash .claude/scripts/cockpit.sh report building "ticket #<n> started: <title>" \
         --key="$KEY" --ref="$REF"

2. Use `/tdd` where possible, at the seams the spec agreed on.
3. Typecheck and run the relevant test file(s) as you go.
4. Commit to the current branch with a message naming the ticket.
5. Close the ticket when its acceptance criteria are met, per the tracker
   contract, so the frontier query stays honest, and **report the close**:

       bash .claude/scripts/cockpit.sh report building "ticket #<n> closed" \
         --key="$KEY" --completes="$REF"

6. Refresh the feature-context file if the landed ticket changed what a
   fresh reader would need to know (the contract is in
   `.claude/HARNESS.md`).

Never start a ticket whose blockers are still open.

**A decision the build turns out to need an ADR for** goes through
`/document adr <title>` the moment it settles. That skill claims the number on
the `coordination` branch before the file exists, which is the one thing that
stops a parallel feature cut from the same `preprod` taking the same number:
the filenames differ, git merges both without a word, and the gate refuses the
pair only after each is cited everywhere. Never copy
`docs/decisions/TEMPLATE.md` by hand, and never take the next number `ls`
shows.

The pair in steps 1 and 5 is one of the eight seams in `.claude/JOURNEY.md`
("Reporting activity"), which owns the voice and the rules. `building` is the
longest position on the journey, so without it a reader watching the cockpit
sees nothing at all for the length of a build. Report from the ticket loop and
nowhere below it: a report per commit or per test run is the difference
between a heartbeat and a log, and nobody reads a log. Run on its own, outside
`/feature`, this skill has no `$KEY`; pass no `--key` and the report is scoped
to the repository, which is honest where a made-up key would not be. A report
can never stop the loop: it exits 0 whatever happens, and says nothing at all
when no cockpit is configured.

## Finishing

Run the full check once at the end: the `check:` command from
`.harness-version` if one is configured, otherwise the project's own test
and lint commands. A green in-flight CI run is not a substitute for
running it yourself.

The check is the seam's second use, and it pairs against the sha it ran on, so
a re-run after a fix is a new operation rather than a suppressed duplicate:

    REF="$KEY:check@$(git rev-parse --short HEAD)"
    bash .claude/scripts/cockpit.sh report building "running the full check" \
      --key="$KEY" --ref="$REF"
    # the check
    bash .claude/scripts/cockpit.sh report building "the full check passed" \
      --key="$KEY" --completes="$REF"

A red check completes the pair too, saying so ("the full check failed: 3
tests"). Leaving it open would claim the check is still running, and the whole
point of a pair is that an unfinished one means a session that died.

Then use `/code-review` to review the work, and act on what it finds. That is
the seam's third use, and it is reported from inside `/code-review` rather
than from here, because `/feature` phase 4 runs the review directly and would
never reach a recipe kept in this file.

Leave the branch committed. Pushing and merging are not this skill's job:
inside `/feature` the phase gate owns the push, and `/to-preprod` or
`/review` owns the merge.

---
Adapted from [mattpocock/skills](https://github.com/mattpocock/skills) (MIT).
