---
name: document
description: Write or repair project documentation under the AI-native docs standard. Use for "write an ADR", "check the docs", "where does this go", or when the user invokes /document.
argument-hint: "[adr <title> | check | <topic to document>]"
allowed-tools: Bash(git *), Bash(node scripts/check-docs.mjs*), Bash(python3 scripts/check-docs.py*), Read, Write, Edit, Glob, Grep
---

# Document

Route a fact to its one home, or prove the docs still match the code.

`docs/README.md` is the manifest. **Read it first, every time**, whichever
mode you are in. It says which doc owns what. Never invent a new doc when the
manifest already assigns that content a home.

Dispatch on `$ARGUMENTS`:

| Argument | Mode |
|---|---|
| `adr <title>` | [Mode A: scaffold an ADR](#mode-a-scaffold-an-adr) |
| `check` (or empty on a branch with changes) | [Mode B: audit the diff](#mode-b-audit-the-diff) |
| anything else | [Mode C: route a topic](#mode-c-route-a-topic) |

If `docs/README.md` does not exist, the project has not adopted the standard.
Offer to scaffold it: `docs/README.md`, `docs/GLOSSARY.md`,
`docs/SECURITY.md`, `docs/TESTING.md`, `docs/architecture/TEMPLATE.md`,
`docs/decisions/TEMPLATE.md`, `docs/runbooks/TEMPLATE.md`, and
`scripts/check-docs.mjs`. Copy them from the harness template repo named in
`.harness-version` rather than writing them from memory.

## Mode A: scaffold an ADR

1. Claim the number before you write anything. Two sessions cut from the
   same `preprod` tip otherwise compute the same number, and because the
   filenames differ git merges both without a conflict (ADR 0015).

   Read both views and take the successor of the higher one:

       ON_PREPROD=$(bash .claude/scripts/coordination.sh adr-numbers-on-preprod)
       CLAIMED=$(bash .claude/scripts/coordination.sh list adr)
       NUMBER=$(bash .claude/scripts/coordination.sh next-adr "$ON_PREPROD" "$CLAIMED")

   `preprod` is the source of truth and the coordination branch is a cache over
   it, so a lost branch can never re-issue a number that already landed.

   Then write `claims/adr/<NUMBER>.md` on the `coordination` branch with the
   GitHub contents API (`mcp__github__create_or_update_file`, branch
   `coordination`, **no `sha` argument**). Omitting the sha is what makes
   this a reservation: the call fails when the path already exists, and that
   failure is the compare-and-swap.

   Body:

       ---
       number: "<NUMBER>"
       title: <the ADR title>
       claimed_by: <feature slug from .harness-feature, or "none">
       branch: <the feature branch, or "none">
       author: <git config user.email>
       claimed_at: <ISO 8601 UTC>
       state: claimed
       ---

   The title is written once and never refreshed. `claimed_by` is provenance:
   it is what says where the reservation came from.

   **On a failed write, re-read and retry with the next number, at most five
   times.** Report which numbers were taken and by which feature.

   **If the branch cannot be read or written at all** (no network, no branch,
   no MCP tool), do not stop. Take `next-adr`'s answer, warn the user in one
   clear line that the number is unclaimed and may collide, and carry on. The
   guarantee does not live here: `check-docs.mjs` fails the merge gate on a
   duplicated number, and it runs against the merged tree.

2. Slugify the title: lowercase, kebab-case, no stop words to pad it. The
   filename is `docs/decisions/NNNN-<slug>.md`.

3. Copy `docs/decisions/TEMPLATE.md` into the new file. Delete the
   instructional HTML comment. Fill in:
   - `Status: Proposed` unless the user says the decision is already made,
     in which case `Accepted`.
   - `Date:` today, `YYYY-MM-DD`.
   - **Context**: the constraint that forced the decision, not a summary of
     the feature.
   - **Decision**: present tense.
   - **Rejected alternatives**: at least one row. An ADR with no rejected
     alternative is a note, not a decision. Ask the user what else was on the
     table if you cannot infer it from the diff.
   - **Consequences**: what this forecloses, and the invariants it creates.
   - **Threat model** and **When to reconsider**: include when they apply,
     delete the headings when they do not.

4. Add the row to the ADR table in `docs/README.md`, in number order:

       | [NNNN](./decisions/NNNN-slug.md) | Title | Status | YYYY-MM-DD |

5. Add the back-reference in code. Find the module the decision governs and
   put a comment containing the id at the top of the relevant declaration:

       // ADR 0007: writes go through the queue so ordering survives retries.

   Without this, `grep -rn "ADR 0007"` finds nothing and the rationale is
   unreachable from the code. If you genuinely cannot identify a governing
   module (a process decision, for example), say so instead of inventing a
   placement.

6. Run the checker (see Mode B step 5) and report the ADR path.

**Superseding.** To replace an accepted ADR, never edit its body. Write a new
ADR whose Context explains what changed, set the old one's status line to
`Superseded by ADR NNNN`, and update both rows in the index. Editing the
status line of a superseded ADR is the only edit an accepted ADR ever takes.

## Mode B: audit the diff

1. Establish the base and the changed paths:

       git fetch origin preprod
       BASE=$(git merge-base HEAD origin/preprod)
       git diff --name-status "$BASE"..HEAD

2. Read `docs/README.md`. Map every changed path through the definition of
   done table there. The mapping is mechanical; work through it row by row
   rather than by intuition:

   | Changed | Owning doc |
   |---|---|
   | Migration or schema file | the data-model architecture doc |
   | Route, tool, command, event handler | that subsystem's surface table |
   | New `process.env.X` / `Bun.env.X` reference | `.env.example` |
   | Auth, session, secret, validation, or limit | `docs/SECURITY.md` |
   | New domain noun in a type or table name | `docs/GLOSSARY.md` |
   | Test tier, runner, or convention | `docs/TESTING.md` |
   | New doc file | a row in `docs/README.md` |

   A pure rename, extraction, or reformat maps to nothing. Do not manufacture
   a doc change for it.

3. Check the `sources:` globs. For each `docs/architecture/*.md`, read its
   front-matter and test every changed path against its globs. For each doc
   whose globs match a changed path, either update it or state explicitly in
   your report that the change does not affect it and why. "Probably fine" is
   not an outcome.

4. Apply the mechanical updates yourself:
   - add missing env vars to `.env.example` with a comment describing what
     they are for
   - add missing rows to surface tables, and correct row counts flagged by a
     `surface-count` directive
   - fix path references that moved
   - add the index row for any new doc
   - update the ADR index if an ADR's status changed

   Leave judgment calls to the user: prose that requires knowing intent, a
   tradeoff that may deserve an ADR, a doc that has outgrown its budget.
   Report those instead of guessing.

5. Run the checker:

       node scripts/check-docs.mjs

   (or `python3 scripts/check-docs.py` if that is the variant in this repo).
   Fix every ERROR. Report WARNs with a recommendation; do not silence a WARN
   by deleting the check.

6. Report in this shape:

       DOCS CHECK
       Base: <sha>  Changed: <N> files
       Updated:      <file>: <what and why>
       Confirmed unaffected: <arch doc>: globs matched <path>, surface unchanged
       Needs you:    <question>
       Checker:      <N> errors, <M> warnings

## Mode C: route a topic

The user has a fact and wants it written down. Your job is to put it in
exactly one place.

1. Read `docs/README.md` and find the owning doc for the topic.
2. `grep` for the fact before writing it. If it already exists somewhere
   else, do not add a second copy: move it to its owning home and delete the
   original in the same commit. One home per fact.
3. Write it under the owning doc's conventions:
   - Lead with the invariant or the trap, not with narrative.
   - Never restate what the code says. Code is truth for WHAT; docs are truth
     for WHY and WHERE.
   - Name files and exports in backticks with every claim.
   - Prefer a short table to a paragraph.
   - Keep existing headings unchanged; they are grep anchors.
4. If the topic has no owning doc, that is a decision, not an accident:
   propose the new doc, its budget, and its index row, and get agreement
   before creating it. Never create a generic catch-all like `docs/api.md`
   when the standard already assigns that content to a subsystem doc.
5. If the fact is a tradeoff with a non-obvious rationale, it is an ADR.
   Switch to Mode A.
6. If the target is a historical document (a retrospective, a handoff, a
   post-mortem), it is frozen. Do not edit the body. Append a bracketed,
   dated correction instead.
7. Run the checker before you finish.
