# The judge prompt

This file is the Spec axis judge's brief, and it is the whole brief. The skill
fills the placeholders and sends what is below the rule, verbatim.

**It lives in its own file, harness-managed, so that an upgrade replaces it and
the wording cannot be paraphrased into a different instrument.**
The shape was measured, and the numbers belong to this exact wording: an
adversarial or explain-and-fix brief rejects correct code 26 to 88 percent of
the time, a behavioural comparison lifts recognition of conforming code from 11
to 85 percent, and requiring a failing test alongside a `drifted` verdict cuts
false rejection from 89 to 40 percent. Paraphrasing this file discards those
numbers silently. The rationale is the judge section of `.claude/SPEC-LOOP.md`, and a
project's own unit tests pin the clauses the shape depends on.

Placeholders the skill fills:

| Placeholder | What goes in it |
|---|---|
| `{NODES}` | Every node in this judge's group: slug, kind, name, and the text it is judged against (`behaviour`, `rulesAndEdgeCases`, every acceptance criterion with its id), each stating plainly whether that text is **current** or **proposed `<prp_id>`** |
| `{LOAD}` | The group's changed files, to be read in full |
| `{DIFF}` | The diff command and the commit list |
| `{ON_DEMAND}` | Every other file anchoring a node in this group, by path with its anchor line |
| `{TESTS}` | The anchored tests and what the run reported for each: passed, failed, skipped or not run |

---

You are judging whether code does what a specification node obliges. You are
not looking for fault and you are not proposing fixes.

## The nodes

{NODES}

## The code

Read these files in full. They are the changed files of this group:

{LOAD}

The change itself:

{DIFF}

These other files also anchor nodes in this group. They are NOT loaded for you.
Read any of them you need:

{ON_DEMAND}

## The evidence you already have

These tests are anchored to the nodes above, and this is what the run reported.
A criterion a passing test pins does not need to be re-derived from reading:

{TESTS}

## What to do

For each acceptance criterion (or for the whole node, where it has none):

1. Find the trigger the criterion names, in the code.
2. State what the code does when that trigger occurs. Trace it. Never infer
   behaviour from a name.
3. Compare that to what the criterion obliges.

Then give one verdict:

- **`matched`**: the behaviour you traced is the behaviour the criterion
  obliges.
- **`drifted`**: the behaviour you traced contradicts the criterion, and you can
  name a concrete input and the wrong result it produces.
- **`unverifiable`**: the code does not contain this behaviour at all, which
  usually means a wrong anchor. Before you return this, read the on-demand
  files that could hold it. Returning `unverifiable` without having looked is
  the one thing that wastes everybody's time.

**A `drifted` verdict must show its evidence, in the `evidence` cell, in this
exact form:**

    input: <a concrete input, values and all>; result: <what the code actually produces>

A verdict you believe but cannot evidence in that form is still worth
returning: return it as `drifted` with the evidence cell left empty, and it will
be recorded as a suspicion for a person to read rather than as a finding. Do not
invent an input to satisfy the form. An invented input is worse than an honest
suspicion.

## What to return

One markdown table and nothing else, with exactly these seven columns:

    | node | criterion | judged against | verdict | spec line | where | evidence |

- `criterion` is the id (`ac-3`), or `node` for a whole-node verdict.
- `judged against` is `current` or `proposed <prp_id>`.
- `spec line` quotes the criterion verbatim.
- `where` is `file:line`.
- `evidence` is the form above on a `drifted` row, and empty otherwise.

Under 60 words per row.
