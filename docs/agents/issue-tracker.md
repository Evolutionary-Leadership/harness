# Issue tracker: GitHub

Issues, specs, and tickets for this repo live as GitHub issues. This file
is the **one home** for tracker knowledge: every skill that says "per the
tracker contract" means this file. To move the project to a different
tracker (Linear, GitHub Projects, ...), rewrite this file; no skill
changes needed.

Use the `gh` CLI for all operations. In remote Claude Code sessions where
`gh` is absent, use the equivalent GitHub MCP tools instead (issue and
sub-issue read/write, search); the conventions below are tool-agnostic.

## Operations

- **Create an issue**: `gh issue create --title "..." --body "..."`. Use a
  heredoc for multi-line bodies.
- **Read an issue**: `gh issue view <number> --comments`.
- **List issues**: `gh issue list --state open --json
  number,title,body,labels` with `--label` and `--state` filters as
  needed.
- **Search issues**: `gh issue list --search "<terms>" --state all`.
- **Comment on an issue**: `gh issue comment <number> --body "..."`
- **Update an issue body**: `gh issue edit <number> --body "..."`
  (`issue_write` update where `gh` is absent). Read the body first,
  rewrite one section, and leave every other line byte-for-byte: this is
  how `/to-spec`, `/to-tickets` and `/implement` write the work item's
  sections.
- **Apply / remove labels**: `gh issue edit <number> --add-label "..."` /
  `--remove-label "..."`
- **Close**: `gh issue close <number> --comment "..."`

Infer the repo from `git remote -v`; `gh` does this automatically when run
inside a clone.

## The four issue kinds the flow uses

An S or M change files only the first kind: its spec and its tickets live
in the work item's own sections. An L change files all four.

### Work items (`/feature` phase 0)

One issue per change, created at Capture and titled exactly
`<KEY>: <title>`, where the key is `<change-prefix>-<n>` from
`.harness-version` and the counter on the `coordination` branch. Its body
has five sections in this order: **Why** (verbatim from Capture, and the
one home of the prose; below), **Challenge** (written by phase 1 at the end
of the why round: the why as it stands after the challenge, what was
rejected, the verdict; for S, "not challenged: size S"), **Change key**
(the key and the size; below), **Specification** (written by `/to-spec`:
the spec text for S and M, the spec issue link for L, or the Spec Universe
change view when the spec loop is connected), then **Tickets** (written by
`/to-tickets`: a checklist for S and M, below; for L the tickets are
sub-issues of the spec issue). It is the journey's `captured` artefact and
the home of every gate verdict, so the labels below mean exactly one thing
each:

| Label | Means | Applied by |
|---|---|---|
| `pursue` | The why survived the challenge | Phase 1a, on the `pursue` verdict |
| `parked` | A gate answered park. The issue stays OPEN, the branch and the touched-set record stay too; removing the label un-parks | Phase 1a or 1d |
| `blocked` | A session stood down on something it could not get past; the feature context's `## Blocked` says what. Removed when the block clears | Any phase, per `.claude/JOURNEY.md` |

A `drop` verdict closes the work item as **not planned** with a comment
saying why; nothing else ever closes it as not planned, and `/release` is
the only skill that closes it as completed. The frontier is read from it
(S, M: the checklist in `## Tickets`; L: the sub-issues of the spec issue
it links), and it is never deleted.

**Change key** holds two sentences, both written at Capture: the key, then
the size.

```
`<KEY>`. Size: `S`.
```

The tier is `S`, `M` or `L`. It decides which phases run and where the
spec and the tickets live; the rubric is `/feature` phase 0, "Size". A
skill that needs the tier reads it from the feature context's `## Size`
line, else from this sentence, and treats no tier on record as `L`.

### Idea issues (`/brainstorm`)

One issue per brainstorm the user chose to keep. Label: `idea`. The body
has exactly five sections: **Why**, **Destination**, **Decisions so
far**, **Not yet specified**, **Out of scope** (the format is in the
`/brainstorm` skill). `/feature #<number>` consumes an idea issue:
settled decisions are honored, and only the "Not yet specified" frontier
gets grilled. When a feature session picks an idea up, it comments on the
issue; close the idea issue when the feature that came from it merges.

### Spec issues (`/to-spec`, `/feature` phase 2; L only)

One issue holding an L change's spec, linked from the work item's
`## Specification`. For S and M there is no spec issue: `/to-spec` writes
the spec text into that section instead, and the work item is the spec.
Put the feature slug from `.harness-feature` in the title, so a later
session can find it with `gh issue list --search "<slug>" --state all`.
Its `## Why` is the single line `Why: <work item URL>` (below). The spec
issue is never closed or modified by ticket work; it is the reference the
tickets and `/code-review`'s Spec axis read.

### Tickets (`/to-tickets`, `/feature` phase 3)

One ticket per tracer-bullet slice, in dependency order (blockers first).
Where a ticket lives is the tier's call.

**S and M: a checklist in the work item's `## Tickets`.** No issue is
created. One line per ticket, in exactly this grammar:

```
- [ ] T1 <title> (blocked-by: none)
- [ ] T2 <title> (blocked-by: T1)
- [x] T3 <title> (blocked-by: none) [check: green]
```

`- [ ]` or `- [x]`, then `T<n>`, then a title with no parentheses, then
`(blocked-by: none|T<n>[,T<n>...])`, and on completion ` [check: green|red]`.
Nothing else on the line. `/implement` ticks a line with one update of the
work item's body that turns `- [ ]` into `- [x]` and appends the check
result; every other line stays byte-for-byte. `/continue` reads the list:
an unticked line means `building`, every line ticked means `built`, and a
filled `## Specification` with no lines yet means the plan is not finished
(`planned` for M; `committed` for S, whose one gate writes both together).

**L: one issue per ticket**, each linked to the spec issue as a GitHub
**sub-issue**, or with `Part of #<spec>` at the top of the body where
sub-issues are unavailable. Its `## Why` is the single line
`Why: <work item URL>` (below). Blocking edges use native issue
dependencies (below). Close each ticket as its acceptance criteria land, so
the frontier query stays honest and a resumed session can tell what is
left.

## Every ticket opens with WHY

Every issue this flow files opens with a `## Why`. The prose is written
once, on the work item, at Capture: one or two sentences saying what is
wrong or missing today. It is the only part a human writes that nothing
else can derive, and it is the first thing a reader picking the change up
three sessions later needs. Everywhere else the `## Why` is the single
line `Why: <work item URL>`: on the spec issue, on every L ticket, and in
`.pr-description.md`. Nothing re-types the prose, and a checklist line
(S, M) has only a title; a second copy is the copy nobody updates.

On the work item:

```markdown
## Why

Two devices editing one task currently pick a winner silently and tell nobody.
```

On an L ticket (a spec issue reads the same, minus the parent line):

```markdown
Part of #12

## Why

Why: https://github.com/<owner>/<repo>/issues/9

## Acceptance
- [ ] a conflict is shown rather than resolved
- [ ] the loser is recoverable
```

The rules below are the work item's. `/to-tickets` checks them once,
against the work item, before the first ticket is written; a Why that
fails is rewritten there and checked again.

| Rule | Reason |
|---|---|
| One or two sentences, under roughly 240 characters | A reader gets the first sentence that fits; a purpose needing a third is a specification |
| Say what is WRONG or missing TODAY, not what the change does | The title already says what it does. `Dark mode` plus "adds a dark theme" tells a reader nothing they did not have |
| Never restate the title | Both are drawn, one above the other |
| Plain prose: no checklist, no table, no code fence, no bare link | Structure is skipped, and a body that is only structure reads as an absence. The work item is the one home of the prose; the link is the required form everywhere else, and never here |
| `Part of #n` and `Blocked by: #n` stay where they are | They are recognised as bookkeeping and skipped wherever they sit |
| `## Purpose` and `**Why:**` are read the same way | With no such heading the first prose paragraph is used, so a hand-filed ticket still reads sensibly. The heading is what makes it PREDICTABLE |

**Idea issues carry the prose too**, above their own first section: an
idea has no work item yet, and `/feature #<number>` carries its Why into
the work item it creates. What a later session reads first should be why
anybody wants the thing, not where it is going.

The framing is what changes the output, more than the format:

> Write the Why for somebody with two minutes and no context, who will read
> it on a board beside forty others.

## Blocking edges and the frontier

Used by `/to-tickets` (writing edges) and `/implement` (querying the
frontier). For S and M the edges are the `blocked-by` list on each
checklist line, and the frontier is every unticked line whose blockers are
all ticked (`none` counts as all); nothing below applies. For L:

- **Add a blocking edge**: GitHub's native issue dependencies are the
  canonical, UI-visible representation. Add an edge with
  `gh api --method POST
  repos/<owner>/<repo>/issues/<child>/dependencies/blocked_by
  -F issue_id=<blocker-db-id>`, where `<blocker-db-id>` is the blocker's
  numeric **database id** (`gh api repos/<owner>/<repo>/issues/<n> --jq
  .id`, *not* the `#number` or `node_id`). Where dependencies are not
  available, fall back to a `Blocked by: #<n>, #<n>` line at the top of
  the ticket body.
- **A ticket is unblocked** when every blocker is closed. GitHub reports
  `issue_dependencies_summary.blocked_by` (open blockers only; the live
  gate).
- **Frontier query**: list the spec's open tickets (`gh issue list
  --state open`, scoped to the spec's sub-issues or `Part of #<spec>`
  markers), drop any with an open blocker
  (`issue_dependencies_summary.blocked_by > 0`, or an open issue in the
  `Blocked by` line). What remains is the frontier: the tickets
  `/implement` may start now.

## Resumed sessions

A resumed session derives its position from the durable artefacts rather
than trusting the record, and `/continue` owns the table (its step 5). For
S and M the evidence is the work item (the size in `## Change key`, then
`## Challenge`, `## Specification` and the ticks in `## Tickets`) and the
feature context's settled decisions. For L it is the same, plus the spec
issue the work item links and its ticket sub-issues (open ones among
them). The session re-enters the first `/feature` phase whose artefact is
missing and writes that position to the touched-set record. The tracker
holds the *state*; the *reasoning* (decisions, rejections, open questions)
lives in the feature context file on the feature branch, per
`.claude/HARNESS.md`. An idea issue, if one started the feature, holds the
pre-feature thinking.

## When a skill says "publish to the tracker"

Create a GitHub issue per the conventions above.

## When a skill says "fetch the ticket / spec / idea issue"

Run `gh issue view <number> --comments` (or the MCP equivalent).
