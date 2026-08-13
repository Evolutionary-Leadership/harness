---
# Globs naming the files this doc describes. A diff touching any of them
# implicates this doc: update it, or state in the PR that it is unaffected.
# The checker fails if a glob matches nothing, which is how a rename or a
# deletion surfaces as a docs error instead of silent drift.
sources:
  - src/example/**/*.ts
  - src/example.config.ts
---

# <Subsystem name>

<!--
Copy to docs/architecture/<subsystem>.md, fill in, and add a row to the
Architecture table in docs/README.md.

Budget: 400 lines. Over budget means this covers more than one subsystem.
Split it rather than trimming detail.

Rules for the body:
- Lead with the invariant or the trap, not with narrative.
- Never restate what the code already says. Code is truth for WHAT; this
  file is truth for WHY and WHERE.
- Name every file and export in backticks.
- Prefer short tables to paragraphs.
- Keep headings stable. They are grep anchors for future sessions.
-->

## Invariants

The rules a change here must not break. One line each. Link the ADR when the
rule has a rationale worth reading.

- `example`: every write goes through `src/example/write.ts` so the audit log
  cannot be bypassed
- ...

## Traps

What has already gone wrong here, so nobody rediscovers it.

| Trap | Symptom | What to do instead |
|---|---|---|
| | | |

## Surface

The catalog. Keep it a table. Where the rows correspond one-to-one with a
countable construct in the code, declare it so the checker can catch a
missing row:

<!-- surface-count: glob=src/example/**/*.ts pattern=export\s+const\s+\w+Handler -->

| Name | Where | Purpose |
|---|---|---|
| | | |

The directive above counts regex matches across the glob and compares them
against the body rows of the table that follows. A mismatch is an error, not
a warning: a surface table that silently loses a row is worse than no table.

## How it fits

Where this subsystem sits relative to the others, and which module owns the
boundary. Point at the ADRs that shaped it. Two paragraphs at most; if it
needs more, the boundary is probably in the wrong place.
