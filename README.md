# coordination

This branch carries no code. It is never merged into `main` or `dev`,
and it shares no history with them.

## The one rule

**This branch carries only what exists nowhere else.**

A claimed but unwritten ADR number exists nowhere else. The touched-set
of a branch that has not merged exists nowhere else. The moment
something lands there is a pull request, a commit and a tag, and GitHub
owns it from then on: this branch must not keep a second copy.

That rule answers every "could this live here too" question. If the
fact is derivable from GitHub, it does not belong here.

## Layout

| Directory | Holds |
|---|---|
| `claims/adr/` | One file per reserved ADR number |
| `features/` | One file per in-flight feature (not yet populated) |

## Reading and writing it

Everything here is advisory. No workflow reads this branch to block
anything, and no session should ever stall because it is missing or
unreachable.

Read it without checking it out:

    git fetch origin coordination
    git show origin/coordination:claims/adr/0023.md

Write it through the GitHub contents API, where a path that already
exists fails the call. That failure is the compare-and-swap that makes
a reservation safe.
