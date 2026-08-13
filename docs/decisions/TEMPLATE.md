# NNNN. Short imperative title

- **Status:** Proposed
- **Date:** YYYY-MM-DD

<!--
Copy this file to docs/decisions/NNNN-slug.md (next free number, zero-padded
to 4 digits), fill it in, and add a row to the ADR table in docs/README.md.
`/document adr <title>` does all three for you.

Rules:
- Accepted ADRs are append-only. Never rewrite the body of an accepted ADR to
  match new reality. Write a new ADR and set this one's status to
  "Superseded by ADR NNNN".
- Status is one of: Proposed | Accepted | Rejected | Superseded by ADR NNNN.
- Leave a back-reference in the code this decision governs, e.g.
  `// ADR 0004: single writer per aggregate, see docs/decisions/`.
  That comment is what makes the rationale findable from the code.
- Delete the sections that do not apply. Do not leave empty headings.
-->

## Context

What forced a decision. State the constraint, the failure, or the tradeoff
that made the obvious choice not obvious. Name the files and exports
involved in backticks. Two paragraphs at most.

## Decision

What we are doing, in the present tense: "requests are authenticated by X",
not "we will authenticate".

### Rejected alternatives

| Alternative | Why not |
|---|---|
| | |

The rejected options are the most valuable part of an ADR. A future agent
that does not know why the obvious approach was skipped will propose it
again.

## Consequences

What this costs, what it forecloses, and what now has to be true for the
system to keep working. Include the invariants a future change must not
break. If an invariant belongs in every session's context, also add it to
`CLAUDE.md` and point back here.

## Threat model

_Optional. Include for anything touching auth, secrets, or untrusted input._

- **Trusted:** what we assume is not hostile
- **Untrusted:** what we validate
- **Out of scope:** what this decision explicitly does not defend against

## When to reconsider

_Optional but strongly recommended._ The concrete trigger that should make
someone open this file again: a scale threshold, a dependency reaching a
version, a feature landing. Without it, an ADR is read as permanent.
