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
- **Apply / remove labels**: `gh issue edit <number> --add-label "..."` /
  `--remove-label "..."`
- **Close**: `gh issue close <number> --comment "..."`

Infer the repo from `git remote -v`; `gh` does this automatically when run
inside a clone.

## The three issue kinds the flow uses

### Idea issues (`/brainstorm`)

One issue per brainstorm the user chose to keep. Label: `idea`. The body
has exactly four sections: **Destination**, **Decisions so far**, **Not
yet specified**, **Out of scope** (the format is in the `/brainstorm`
skill). `/feature #<number>` consumes an idea issue: settled decisions are
honored, and only the "Not yet specified" frontier gets grilled. When a
feature session picks an idea up, it comments on the issue; close the idea
issue when the feature that came from it merges.

### Spec issues (`/to-spec`, `/feature` phase 2)

One issue holding the feature's spec. Put the feature slug from
`.harness-feature` in the title, so a later session can find it with
`gh issue list --search "<slug>" --state all`. The spec issue is never
closed or modified by ticket work; it is the reference the tickets and
`/code-review`'s Spec axis read.

### Ticket issues (`/to-tickets`, `/feature` phase 3)

One issue per tracer-bullet slice, created in dependency order (blockers
first), each linked to the spec issue as a GitHub **sub-issue**, or with
`Part of #<spec>` at the top of the body where sub-issues are unavailable.
Blocking edges use native issue dependencies (below). Close each ticket as
its acceptance criteria land, so the frontier query stays honest and a
resumed session can tell what is left.

## Blocking edges and the frontier

Used by `/to-tickets` (writing edges) and `/implement` (querying the
frontier).

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

A resumed session reads the durable artifacts in order (spec issue, then
ticket issues, then open tickets among them) and re-enters the first
`/feature` phase whose artifact is missing. The tracker holds the *state*;
the *reasoning* (decisions, rejections, open questions) lives in the
feature context file on the feature branch, per `.claude/HARNESS.md`. An
idea issue, if one started the feature, holds the pre-feature thinking.

## When a skill says "publish to the tracker"

Create a GitHub issue per the conventions above.

## When a skill says "fetch the ticket / spec / idea issue"

Run `gh issue view <number> --comments` (or the MCP equivalent).
