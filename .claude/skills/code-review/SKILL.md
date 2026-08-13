---
name: code-review
description: Review the changes since a fixed point (commit, branch, tag, or merge-base) along two axes, Standards and Spec, in parallel sub-agents. Runs at the end of /feature phase 4; also usable when the user wants a branch, PR, or work-in-progress reviewed. This reviews code; /review is the separate skill that opens a PR for human review.
---

# Code Review

Two-axis review of the diff between `HEAD` and a fixed point:

- **Standards**: does the code conform to this repo's documented coding
  standards?
- **Spec**: does the code faithfully implement the originating spec?

Both axes run as **parallel sub-agents** so they do not pollute each
other's context; this skill aggregates their findings.

## Process

### 1. Pin the fixed point

Inside `/feature`, the fixed point is `origin/dev`. Standalone, it is
whatever the user said (a commit SHA, branch name, tag, `HEAD~5`); if they
did not specify one, ask.

Capture the diff command once: `git diff <fixed-point>...HEAD` (three-dot,
so the comparison is against the merge-base). Also note the commit list
via `git log <fixed-point>..HEAD --oneline`.

Before going further, confirm the fixed point resolves
(`git rev-parse <fixed-point>`) and the diff is non-empty. A bad ref or an
empty diff should fail here, not inside two parallel sub-agents.

### 2. Identify the spec source

Look for the originating spec, in this order:

1. The spec issue on the tracker whose title carries the feature slug
   (the convention and the fetch operations are in
   `docs/agents/issue-tracker.md`).
2. Issue references in the commit messages (`#123`, `Closes #45`),
   fetched the same way.
3. A path the user passed as an argument.
4. If nothing is found, ask the user where the spec is. If they say there
   is none, the Spec sub-agent skips and reports "no spec available".

### 3. Identify the standards sources

Anything in the repo that documents how code should be written: the
project's `CLAUDE.md`, `.claude/traits/*.md` if present, `docs/TESTING.md`
and `docs/SECURITY.md`, and any `CONTRIBUTING.md` or coding-standards doc.

On top of whatever the repo documents, the Standards axis always carries
the **smell baseline** below: a fixed set of Fowler code smells
(*Refactoring*, ch. 3) that applies even when a repo documents nothing.
Two rules bind it:

- **The repo overrides.** A documented repo standard always wins; where it
  endorses something the baseline would flag, suppress the smell.
- **Always a judgement call.** Each smell is a labelled heuristic
  ("possible Feature Envy"), never a hard violation. And like any standard
  here, skip anything tooling already enforces.

Each smell reads *what it is*, then *how to fix*; match it against the
diff:

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

### 4. Spawn both sub-agents in parallel

**Standards sub-agent prompt**, include:

- The full diff command and commit list.
- The list of standards-source files you found in step 3, **plus the
  smell baseline from step 3 pasted in full**; the sub-agent has no other
  access to it.
- The brief: "Report, per file/hunk where relevant, (a) every place the
  diff violates a documented standard: cite the standard (file plus the
  rule); and (b) any baseline smell you spot: name it and quote the hunk.
  Distinguish hard violations from judgement calls: documented-standard
  breaches can be hard, but baseline smells are always judgement calls,
  and a documented repo standard overrides the baseline. Skip anything
  tooling enforces. Under 400 words."

**Spec sub-agent prompt**, include:

- The diff command and commit list.
- The fetched contents of the spec.
- The brief: "Report: (a) requirements the spec asked for that are missing
  or partial; (b) behaviour in the diff that was not asked for (scope
  creep); (c) requirements that look implemented but where the
  implementation looks wrong. Quote the spec line for each finding. Under
  400 words."

If the spec is missing, skip the Spec sub-agent and note this in the final
report.

### 5. Aggregate

Present the two reports under `## Standards` and `## Spec` headings,
verbatim or lightly cleaned. Do **not** merge or rerank findings; the two
axes are deliberately separate (see below).

End with a one-line summary: total findings per axis, and the worst issue
*within each axis* (if any). Do not pick a single winner across axes; that
is the reranking the separation exists to prevent.

Inside `/feature`, this summary carries into phase 5 and into the PR body
that `/mergedev` or `/review` writes.

## Why two axes

A change can pass one axis and fail the other:

- Code that follows every standard but implements the wrong thing:
  Standards pass, Spec fail.
- Code that does exactly what the issue asked but breaks the project's
  conventions: Spec pass, Standards fail.

Reporting them separately stops one axis from masking the other.

---
Adapted from [mattpocock/skills](https://github.com/mattpocock/skills) (MIT).
