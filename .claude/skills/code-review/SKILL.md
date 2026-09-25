---
name: code-review
description: Review the changes since a fixed point (commit, branch, tag, or merge-base) along two axes, Standards and Spec, in parallel sub-agents. Runs at the end of /feature phase 4; also usable when the user wants a branch, PR, or work-in-progress reviewed. This reviews code; /review is the separate skill that opens a PR for human review.
allowed-tools: Bash(git *), Bash(bash .claude/scripts/*), Bash(node scripts/*), Read, Write, Glob, Grep, Task
---

# Code Review

Read `CONNECTED.md` beside this file when `.harness-version` has a `spec_product:` line.
Otherwise it does not apply and is not read.

Two-axis review of the diff between `HEAD` and a fixed point:

- **Standards**: does the code conform to this repo's documented coding
  standards?
- **Spec**: does the code do what its specification obliges?

The axes run as **parallel sub-agents** so they do not pollute each other's
context; this skill aggregates their findings. Every sub-agent gets the diff
pasted into its prompt: none re-runs `git diff` and none re-reads the
standards files.

## The spec loop, and the one key that switches it

The Spec axis has two shapes, and one key in `.harness-version` picks which.
Read it before anything else:

    SPEC_PRODUCT=$(sed -n 's/^spec_product: *//p' .harness-version | tail -1)

**Empty or absent: this repository has not connected a specification.** Take
every step marked **(dormant)** below. The Spec axis judges the diff against
the tracker's spec issue, exactly as it always has. Nothing else in this skill
changes, and nothing about the loop is mentioned to the user.

**Set: the loop is awake.** Connected: see `CONNECTED.md`, which owns the
Spec axis in full (the implicated set, the judge plan, the tiers, the verdict
sections). Every pointer below marked "Connected" names its section.

## The tier

Inside `/feature`, the size is the `## Size` line of the feature context
(the rubric is `/feature` phase 0, "Size"). Standalone, it is what the user
said; unsaid, `M`. Step 4 dispatches by it: S one reviewer, M and L two axes.

## Process

### 1. Pin the fixed point

Inside `/feature`, the fixed point is `origin/preprod`. Standalone, it is
whatever the user said (a commit SHA, branch name, tag, `HEAD~5`); if they
did not specify one, ask.

Capture the diff once, to paste into every prompt: `git diff
<fixed-point>...HEAD` (three-dot, so the comparison is against the
merge-base), redirected to `${TMPDIR:-/tmp}/review.diff`. Also note the
commit list via `git log <fixed-point>..HEAD --oneline`.

Before going further, confirm the fixed point resolves
(`git rev-parse <fixed-point>`) and the diff is non-empty. A bad ref or an
empty diff should fail here, not inside two parallel sub-agents.

Then **report the start**; skip this, and every report below, when `/feature`
phase 0 found no cockpit configured. A review is minutes of parallel
sub-agents with nothing visible happening, and it is one of the eight seams in
`.claude/JOURNEY.md` ("Reporting activity"), which owns the voice and the
rules. Bind the ref once here, so the two halves of the pair cannot disagree,
and pair against the sha reviewed so a re-review after a fix is a new
operation, not a suppressed duplicate:

    REF="$KEY:review@$(git rev-parse --short HEAD)"
    bash .claude/scripts/cockpit.sh report building "running the code review" \
      --key="$KEY" --ref="$REF"

The seam lives here and not in the caller because BOTH callers reach this
step: `/feature` phase 4 runs this skill directly, and `/implement`'s
Finishing runs it too. A recipe kept in either one would be skipped by the
other. Run standalone there is no `$KEY`; pass no `--key` and the report is
scoped to the repository, which is honest where a made-up key would not be. A
report can never stop a review: it exits 0 whatever happens, and prints
nothing without a cockpit.

### 2. Identify the spec source **(dormant)**

Look for the originating spec, in this order:

1. The spec issue on the tracker whose title carries the feature slug
   (the convention and the fetch operations are in
   `docs/agents/issue-tracker.md`).
2. Issue references in the commit messages (`#123`, `Closes #45`),
   fetched the same way.
3. A path the user passed as an argument.
4. If nothing is found, ask the user where the spec is. If they say there
   is none, the Spec sub-agent skips and reports "no spec available".

Connected: see `CONNECTED.md`, "The implicated set" and "Plan the judges".

### 3. Collect the standards excerpts

The Standards axis reads excerpts pasted into its prompt, never the files.
Collect them once:

- **Guardrails**: the `Guardrails:` line of the feature context's `## Brief`
  names the `CLAUDE.md` headings and bold lines the change is bound by; paste
  those passages. Standalone, with no feature context, build the brief first
  (`bash .claude/scripts/brief.sh --title="review of <branch>"` with one
  `--path=` per changed path) and take its `Guardrails:` line.
- **`docs/TESTING.md` and `docs/SECURITY.md`**: the sections that bear on the
  changed paths, or the whole file when it is short.
- Any other standards doc the repo carries (`.claude/traits/*.md`,
  `CONTRIBUTING.md`, a coding-standards doc): the passages the diff touches.

On top of whatever the repo documents, the Standards axis always carries
the **smell baseline** below: a fixed set of Fowler code smells
(*Refactoring*, ch. 3) that applies even when a repo documents nothing.
Two rules bind it:

- **The repo overrides.** A documented repo standard always wins; where it
  endorses something the baseline would flag, suppress the smell.
- **Always a judgement call.** Each smell is a labelled heuristic
  ("possible Feature Envy"), never a hard violation. And like any standard
  here, skip anything tooling already enforces.

Each smell reads *what it is*, then *how to fix*; match it against the diff:

- **Mysterious Name**: a function, variable, or type whose name does not
  reveal what it does or holds. Fix: rename it; if no honest name comes,
  the design is murky.
- **Duplicated Code**: the same logic shape appears in more than one hunk
  or file in the change. Fix: extract the shared shape, call it from both.
- **Feature Envy**: a method that reaches into another object's data more
  than its own. Fix: move the method onto the data it envies.
- **Data Clumps**: the same few fields or params keep travelling together
  (a type wanting to be born). Fix: bundle them into one type, pass that.
- **Primitive Obsession**: a primitive or string standing in for a domain
  concept that deserves its own type. Fix: give the concept its own small
  type.
- **Repeated Switches**: the same `switch`/`if`-cascade on the same type
  recurs across the change. Fix: replace with polymorphism, or one map
  both sites share.
- **Shotgun Surgery**: one logical change forces scattered edits across
  many files in the diff. Fix: gather what changes together into one
  module.
- **Divergent Change**: one file or module is edited for several unrelated
  reasons. Fix: split so each module changes for one reason.
- **Speculative Generality**: abstraction, parameters, or hooks added for
  needs the spec does not have. Fix: delete it; inline back until a real
  need shows.
- **Message Chains**: long `a.b().c().d()` navigation the caller should
  not depend on. Fix: hide the walk behind one method on the first object.
- **Middle Man**: a class or function that mostly just delegates onward.
  Fix: cut it, call the real target direct.
- **Refused Bequest**: a subclass or implementer that ignores or overrides
  most of what it inherits. Fix: drop the inheritance, use composition.

### 4. Dispatch by tier, in one turn

Every prompt carries the same **common block**: the diff pasted in full (the
`git diff <fixed-point>...HEAD` output from step 1), the diff command and the
commit list; a sub-agent opens a file only for a line the diff cut off.

**S: one reviewer**, Standards and Spec merged in a single prompt. Include:

- The common block.
- The `## Brief` guardrail passages, the TESTING.md and SECURITY.md excerpts,
  and any other excerpt from step 3, **plus the smell baseline pasted in
  full**; the sub-agent has no other access to it.
- **(dormant)** The fetched contents of the spec, or "no spec available".
- The docs scope, when the caller passed one (`/feature` phase 4 passes the
  `check-docs.mjs --diff` output for S), under a heading
  `## Scope (from check-docs --diff)`.
- The brief: the Standards brief below under a `## Standards` heading, the
  Spec brief below under `## Spec`, and, only when a scope was given, "Under
  `## Docs`: for each listed doc, whether the diff changes what it describes
  and the line that needs updating, or `nothing to update`." One word limit
  for the whole report: "Under 500 words."

**M and L: the two axes.** One Standards sub-agent always. Then, **(dormant)**,
one Spec sub-agent.

**Standards sub-agent prompt**, include:

- The common block.
- The excerpts from step 3, **plus the smell baseline from step 3 pasted in
  full**; the sub-agent has no other access to it.
- The brief: "Report, per file/hunk where relevant, (a) every place the
  diff violates a documented standard: cite the standard (file plus the
  rule); and (b) any baseline smell you spot: name it and quote the hunk.
  Distinguish hard violations from judgement calls: documented-standard
  breaches can be hard, but baseline smells are always judgement calls,
  and a documented repo standard overrides the baseline. Skip anything
  tooling enforces. Under 400 words."

**Spec sub-agent prompt (dormant)**, include:

- The common block.
- The fetched contents of the spec.
- The brief: "Report: (a) requirements the spec asked for that are missing
  or partial; (b) behaviour in the diff that was not asked for (scope
  creep); (c) requirements that look implemented but where the
  implementation looks wrong. Quote the spec line for each finding. Under
  400 words."

If the spec is missing, skip the Spec sub-agent and note this in the final
report.

Connected: see `CONNECTED.md`, "The judges". The Spec axis is then the judge
sub-agents at every tier; the S reviewer keeps Standards and the docs scope.

### 5. Aggregate

Present the reports under `## Standards` and `## Spec` headings (and
`## Docs` when the S reviewer was given a scope), verbatim or lightly
cleaned. Do **not** merge or rerank findings; the two axes are deliberately
separate (see below).

**Close the pair from step 1** as the aggregate goes out, naming what came
back:

    bash .claude/scripts/cockpit.sh report building "code review done: <n> findings" \
      --key="$KEY" --completes="$REF"

A review that found nothing completes it too ("code review done: no
findings"). Leaving it open would claim the review is still running, and the
whole point of a pair is that an unfinished one means a session that died.

**(dormant)** End with a one-line summary: total findings per axis, and the
worst issue *within each axis* (if any). Do not pick a single winner across
axes; that is the reranking the separation exists to prevent. Inside
`/feature`, this summary carries into phase 5 and into the PR body that
`/to-preprod` or `/review` writes, and the `## Docs` section is what phase 4
records as `## Docs verdict`.

Connected: see `CONNECTED.md`, "The verdict sections".

## Why two axes

A change can pass one axis and fail the other:

- Code that follows every standard but implements the wrong thing:
  Standards pass, Spec fail.
- Code that does exactly what the issue asked but breaks the project's
  conventions: Spec pass, Standards fail.

Reporting them separately stops one axis from masking the other. Under S the
two share one prompt and still report under two headings: the separation
forbids the reranking, not the shared context.

---
Adapted from [mattpocock/skills](https://github.com/mattpocock/skills) (MIT).
