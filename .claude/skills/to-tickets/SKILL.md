---
name: to-tickets
description: Break a spec or plan into tracer-bullet tickets, each declaring its blocking edges, published to the issue tracker. Phase 3 of /feature, also usable against any existing spec.
---

# To Tickets

Break a plan, spec, or conversation into **tickets**: tracer-bullet
vertical slices, each declaring the tickets that **block** it.

All tracker operations follow the contract in
`docs/agents/issue-tracker.md`.

## Process

### 1. Gather context

Work from whatever is already in the conversation. If the user passes a
reference (a spec issue number, a URL), fetch it and read its full body
and comments.

### 2. Explore the codebase

If you have not already explored the codebase, do so now. Ticket titles
and descriptions use the vocabulary from `docs/GLOSSARY.md`, and respect
ADRs in the area you are touching.

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

### 4. Quiz the user

Present the proposed breakdown as a numbered list. For each ticket, show:

- **Title**: short descriptive name
- **Blocked by**: which other tickets (if any) must complete first
- **What it delivers**: the end-to-end behaviour this ticket makes work

Ask the user:

- Does the granularity feel right (too coarse, too fine)?
- Are the blocking edges correct: does each ticket only depend on tickets
  that genuinely gate it?
- Should any tickets be merged or split further?

Iterate until the user approves the breakdown.

### 5. Publish the tickets

Publish one issue per approved ticket, in dependency order (blockers
first) so each ticket's blocking edges can reference real issue numbers.
Link each ticket to the spec issue as its parent and record the blocking
edges; the mechanics for both (sub-issues, native dependencies, and the
fallbacks) are in `docs/agents/issue-tracker.md`.

Use this body template per ticket:

<issue-template>

## Parent

A reference to the spec issue (omit if there is none).

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
all closed. For a purely linear chain that means top to bottom.

---
Adapted from [mattpocock/skills](https://github.com/mattpocock/skills) (MIT).
