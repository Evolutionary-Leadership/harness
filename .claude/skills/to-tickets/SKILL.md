---
name: to-tickets
description: Break a spec or plan into tracer-bullet tickets, each declaring its blocking edges, published to the issue tracker. Phase 3 of /feature, also usable against any existing spec.
---

# To Tickets

Break a plan, spec, or conversation into **tickets**: tracer-bullet
vertical slices, each declaring the tickets that **block** it.

All tracker operations follow the contract in
`docs/agents/issue-tracker.md`.

## The tier decides what a ticket is

The change's size tier (`S`, `M` or `L`; the rubric is `/feature` phase 0,
"Size") decides where the tickets live. Read it from the feature context's
`## Size` line, else from the work item's `## Change key` section (its
`Size:` sentence). No tier on record means `L`.

- **S and M:** the tickets are a checklist in the work item's `## Tickets`
  section, one line each. No issues are created. `/implement` ticks the
  lines and `/continue` reads them, so the grammar below is exact.
- **L:** one issue per ticket, sub-issues of the spec issue, with native
  blocking edges, created by one script.

## Process

### 1. Gather context

Work from whatever is already in the conversation. If the user passes a
reference (a spec issue number, a URL), fetch it and read its full body
and comments. Inside `/feature`, the spec is where `/to-spec` put it: the
work item's `## Specification` (S, M) or the spec issue it links (L).

### 2. Explore the codebase

If you have not already explored the codebase, do so now. Ticket titles
and descriptions use the vocabulary from `docs/GLOSSARY.md`, and respect
the decision records in the area you are touching (the feature context's
`## Brief` names them).

Look for opportunities to prefactor the code to make the implementation
easier: make the change easy, then make the easy change.

### 3. Draft vertical slices

Break the work into **tracer bullet** tickets:

- Each slice cuts a narrow but COMPLETE path through every layer (schema,
  API, UI, tests): vertical, NOT a horizontal slice of one layer.
- A completed slice is demoable or verifiable on its own.
- Each slice is sized to fit in a single fresh context window.
- Any prefactoring comes first.

Give each ticket its **blocking edges**: the other tickets that must
complete before it can start. A ticket with no blockers can start
immediately.

**The Why is written once, on the work item.** A ticket never re-types it:
a checklist line has only a title, and an L ticket's `## Why` is the one
line `Why: <work item URL>` (the spec issue's URL when there is no work
item). What a ticket does say is its title and, for L, what it delivers.

**Wide refactors are the exception to vertical slicing.** A wide refactor
is one mechanical change (rename a column, retype a shared symbol) whose
blast radius fans across the whole codebase, so a single edit breaks
thousands of call sites at once and no vertical slice can land green. Do
not force it into a tracer bullet; sequence it as **expand-contract**.
First expand: add the new form beside the old so nothing breaks. Then
migrate the call sites over in batches sized by blast radius (per package,
per directory), each batch its own ticket blocked by the expand, keeping
CI green batch to batch because the old form still exists. Finally
contract: delete the old form once no caller remains, in a ticket blocked
by every migrate batch.

### 4. Present the breakdown

Present the proposed breakdown as a numbered list. For each ticket, show:

- **Title**: short descriptive name
- **Blocked by**: which other tickets (if any) must complete first
- **What it delivers**: the end-to-end behaviour this ticket makes work

**The granularity quiz is the caller's.** Inside `/feature`, the plan gate
that follows this skill shows this list and offers "re-slice" as one of
its options; do not stop to ask here. Standalone, ask the user:

- Does the granularity feel right (too coarse, too fine)?
- Are the blocking edges correct: does each ticket only depend on tickets
  that genuinely gate it?
- Should any tickets be merged or split further?

and iterate until the user approves the breakdown.

### 5. Publish the tickets

**Self-check before anything is written.** The Why every ticket points at
is the work item's `## Why` (standalone against a bare spec issue, that
issue's). Run these five against it, once, before the first write:

1. A `## Why` is present.
2. It is one or two sentences, under roughly 240 characters.
3. It says what is WRONG or missing TODAY, not what the ticket does.
4. It does not restate the title.
5. It is plain prose: no checklist, no table, no code fence, no bare link.

A Why that fails any of the five is **rewritten on the work item and
checked again** before a ticket is filed against it. Fixing it before the
tickets exist is what makes the Why worth anything: the body is what every
downstream reader reads, and they read it once.

#### S and M: the checklist

One update of the work item's body (`gh issue edit --body`, or
`issue_write` update where `gh` is absent): read the body, replace the
contents of `## Tickets` with the checklist, and leave every other section
as it was. One line per ticket, in dependency order, in exactly this
grammar:

```
- [ ] T1 <title> (blocked-by: none)
- [ ] T2 <title> (blocked-by: T1)
- [ ] T3 <title> (blocked-by: T1,T2)
```

`- [ ]`, then `T<n>`, then a title with no parentheses, then
`(blocked-by: none|T<n>[,T<n>...])`. Nothing else on the line: `/implement`
appends ` [check: green|red]` when it ticks the box, and `/continue` reads
an unticked line as `building` and an all-ticked list as `built`.

#### L: the script

Publish every ticket, then every link, from **one Bash call**, so the
tracker round trips happen inside one turn rather than one per ticket.
Write each body to a file first, naming blockers as `#T<n>`; the script
substitutes real numbers as it goes, creating in dependency order.

```bash
set -e
R=$(gh repo view --json nameWithOwner --jq .nameWithOwner)
PARENT=<spec issue number>
D=$(mktemp -d)
cat > "$D/T1.md" <<'EOF'
<body from the template below>
EOF
cat > "$D/T2.md" <<'EOF'
<body, with "Blocked by: #T1">
EOF

declare -A NUM ID
create() {   # create T<n> "<title>": files the issue and links it under the spec
  local t=$1 title=$2 body k n i
  body=$(cat "$D/$t.md")
  for k in $(printf '%s\n' "${!NUM[@]}" | sort -r); do body=${body//"#$k"/"#${NUM[$k]}"}; done
  read -r n i < <(gh api "repos/$R/issues" -f title="$title" -f body="$body" --jq '"\(.number) \(.id)"')
  NUM[$t]=$n; ID[$t]=$i
  gh api --method POST "repos/$R/issues/$PARENT/sub_issues" -F sub_issue_id="$i" --silent
}
blocked() {  # blocked T<n> T<m>: T<n> is blocked by T<m>
  gh api --method POST "repos/$R/issues/${NUM[$1]}/dependencies/blocked_by" -F issue_id="${ID[$2]}" --silent
}

create T1 "<title>"
create T2 "<title>"
blocked T2 T1
for t in "${!NUM[@]}"; do echo "$t=#${NUM[$t]}"; done | sort
```

The `id` each create returns is the issue's database id, which is what the
sub-issue and dependency endpoints take (the tracker contract says why it
is neither the number nor the node id). Where `gh` is absent, create each
ticket with `issue_write` (one call each, in dependency order, the
tracker's MCP note), then batch every link in one turn afterwards:
all `sub_issue_write` calls together, and a `Blocked by: #<n>` line at the
top of each blocked ticket's body where native dependencies are not
available. Never interleave links with creates.

Use this body template per L ticket:

<issue-template>

## Parent

A reference to the spec issue (omit if there is none).

## Why

Why: <work item URL>

## What to build

The end-to-end behaviour this ticket makes work, from the user's
perspective, not layer-by-layer implementation.

## Acceptance criteria

- [ ] Criterion 1
- [ ] Criterion 2

## Blocked by

- A reference to each blocking ticket, or "None, can start immediately".

</issue-template>

Avoid specific file paths or code snippets in ticket bodies; they go
stale fast.

Do NOT close or modify the spec issue itself.

Implementation then works the **frontier**: any ticket whose blockers are
all done (ticked, or closed for L). For a purely linear chain that means
top to bottom.

---
Adapted from [mattpocock/skills](https://github.com/mattpocock/skills) (MIT).
