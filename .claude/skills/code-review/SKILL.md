---
name: code-review
description: Review the changes since a fixed point (commit, branch, tag, or merge-base) along two axes, Standards and Spec, in parallel sub-agents. Runs at the end of /feature phase 4; also usable when the user wants a branch, PR, or work-in-progress reviewed. This reviews code; /review is the separate skill that opens a PR for human review.
allowed-tools: Bash(git *), Bash(bash .claude/scripts/*), Bash(node scripts/*), Read, Write, Glob, Grep, Task
---

# Code Review

Two-axis review of the diff between `HEAD` and a fixed point:

- **Standards**: does the code conform to this repo's documented coding
  standards?
- **Spec**: does the code do what its specification obliges?

Both axes run as **parallel sub-agents** so they do not pollute each
other's context; this skill aggregates their findings.

## The spec loop, and the one key that switches it

The Spec axis has two shapes, and one key in `.harness-version` picks which.
Read it before anything else:

    SPEC_PRODUCT=$(sed -n 's/^spec_product: *//p' .harness-version | tail -1)

**Empty or absent: this repository has not connected a specification.** Take
every step marked **(dormant)** below and skip every step marked
**(connected)**. The Spec axis judges the diff against the tracker's spec
issue, exactly as it always has. Nothing else in this skill changes, and
nothing about the loop is mentioned to the user.

**Set: the loop is awake.** Take the **(connected)** steps instead. The Spec
axis then reads Spec Universe rather than the tracker, one judge sub-agent
per **changed-file group**: the nodes reached by the same set of changed
files, capped at ten acceptance criteria. It is not one agent for the whole
diff, and it is not one per node. The judge compares behaviour to obligation
rather than hunting for fault, and may not return `drifted` without naming a
concrete input and the wrong result. All three are measured decisions
(`.claude/SPEC-LOOP.md`, the judge section). The classification
lives in `scripts/judge-plan.mjs` and the brief in `judge-prompt.md` beside
this file, so neither can be paraphrased into a different instrument.

## Process

### 1. Pin the fixed point

Inside `/feature`, the fixed point is `origin/preprod`. Standalone, it is
whatever the user said (a commit SHA, branch name, tag, `HEAD~5`); if they
did not specify one, ask.

Capture the diff command once: `git diff <fixed-point>...HEAD` (three-dot,
so the comparison is against the merge-base). Also note the commit list
via `git log <fixed-point>..HEAD --oneline`.

Before going further, confirm the fixed point resolves
(`git rev-parse <fixed-point>`) and the diff is non-empty. A bad ref or an
empty diff should fail here, not inside two parallel sub-agents.

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

### 2. Resolve the implicated nodes **(connected)**

The Spec axis reads **Spec Universe, never the tracker issue.** The
specification of a change lives there as proposals under the change key; the
issue is a thin work item that points at them
(`.claude/SPEC-LOOP.md`).

Every Spec Universe read and write goes through the shared client:

    SU="bash .claude/scripts/spec-universe.sh"

It fails closed, and the three faults it distinguishes (exit 3 a missing
credential, 4 a refused token, 5 unreachable, printing exactly
`spec unreachable, cannot verify`) are documented once in
`.claude/SPEC-LOOP.md`. On any non-zero exit, stop and report
what the client printed. Run one read first (`$SU nodes "$SPEC_PRODUCT"`) so
the review dies before it spawns judges rather than after: on exit 5 the whole
review stops with **"spec unreachable, cannot verify"**. Judge from the
specification as read, never from memory of it, and never from the issue.

Then build the implicated set, in this order:

1. **Anchors from the BASE side of the diff.** For every changed path
   (`git diff --name-status <fixed-point>...HEAD`), read its `Spec:` lines
   from `git show <fixed-point>:<path>`, so a deleted or moved file still
   fans out to the nodes it served. For a path that is added, or whose
   anchors changed, read the HEAD side too and take the union. The grammar
   is the one `scripts/check-spec.mjs` enforces; `Spec: support`
   contributes nothing. Keep, per node, the list of files that cited it.

2. **The change's own proposals.** Resolve the change key (the leading
   `<key>` of the feature name in `.harness-feature`, or the Tracker section
   of the feature context) and run `$SU change-proposals <KEY>`. Every
   proposal in state `draft` or `accepted` adds its node (or the new node it
   proposes) to the set, and its `fields` are the PROPOSED text that node
   is judged against (step 4). A `declined`, `withdrawn` or `superseded`
   proposal adds nothing and is listed in the report as a fact. Standalone,
   with no change key, say so and judge against current text only.

   **A proposal implicates its node on its own**, so a change that moves the
   specification to match code that already exists is judged and therefore
   claimable, even though its diff anchors nothing. The set is a set: a node
   reached by both a changed anchor and a proposal is judged once, against
   the proposed text.

3. **Governing requirements and declared dependencies.** For every
   capability and interface in the set, `$SU dependencies <id> out` and add
   the target of every edge of type `is-governed-by`: those are the
   requirements the node answers to, and they are what gets judged with
   criteria. For every node the change's proposals touch, add the targets
   of its other outgoing edges too (what the feature declares it depends
   on), whole-node.

4. **The text to judge against.** For each node in the set, `$SU node <id>`
   gives the current `behaviour`, `rulesAndEdgeCases` and
   `acceptanceCriteria` (with ids) and the node's `effectiveStrictness` and
   `criticality`. Where step 2 found a proposal on that node, overlay its
   `fields` on the current text and mark the node **judged against proposed
   `<prp_id>`**; otherwise **judged against current**.

An empty set is itself a finding: a diff that changes behaviour and
implicates no node means a wrong or missing anchor, and the report says
which changed files were `support`.

### 2b. Plan the judges **(connected)**

The grouping is a deterministic answer, not a judgement, so the script owns
it. Write four JSON files and run it:

| File | Shape | From |
|---|---|---|
| `anchors.json` | `{ "<changed file>": ["<node slug>", ...] }` | step 2.1, the `Spec:` lines of the changed files |
| `governs.json` | `{ "<node slug>": ["<requirement slug>", ...] }` | step 2.3, the `is-governed-by` edges |
| `criteria.json` | `{ "<node slug>": ["ac-1", ...] }` | step 2.4, the criterion ids |
| `index.json` | `{ "<node slug>": ["<every file anchoring it>", ...] }` | `grep -rln 'Spec:.*\b<slug>\b' <the domain roots>`, symbol-level lines included |

    node scripts/judge-plan.mjs plan --anchors=/tmp/anchors.json \
      --governs=/tmp/governs.json --criteria=/tmp/criteria.json \
      --index=/tmp/index.json > /tmp/judges.json

Each judge in the output carries its `nodes`, the files it must `load` in
full, and the files it may read `onDemand`. **Do not regroup by hand.**
Every node lands in exactly one group, which is what keeps one criterion to
one row; a hand-made group breaks that and the verdict table with it.

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

### 4. Spawn the sub-agents in parallel

One Standards sub-agent always. Then, **(dormant)**, one Spec sub-agent; or,
**(connected)**, one judge sub-agent per judge in `/tmp/judges.json`, all in
one dispatch (batches of ten where the set is large).

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

**Spec sub-agent prompt (dormant)**, include:

- The diff command and commit list.
- The fetched contents of the spec.
- The brief: "Report: (a) requirements the spec asked for that are missing
  or partial; (b) behaviour in the diff that was not asked for (scope
  creep); (c) requirements that look implemented but where the
  implementation looks wrong. Quote the spec line for each finding. Under
  400 words."

If the spec is missing, skip the Spec sub-agent and note this in the final
report.

**Judge sub-agent prompt (connected)**: `judge-prompt.md` beside this file,
everything below its horizontal rule, verbatim, with its five placeholders
filled from the judge's entry in `/tmp/judges.json`. Do not restate it here
and do not improve it in passing: the measured numbers belong to that exact
wording. The sub-agent has no Spec Universe access of its own and must not
go looking.

**Tier 1 runs every judge on `sonnet`** (the Agent tool's `model` parameter;
the tier is a model because there is no effort knob). Collect the tables,
then:

    node scripts/judge-plan.mjs rows --tier1=/tmp/tier1.md > /tmp/rows1.md

**Tier 2 re-runs only the `drifted` and `suspect` rows**, at the session's
default model, with the same prompt narrowed to those criteria. Those are
exactly the rows the measurement calls unreliable; a `matched` or
`unverifiable` row is not re-run. Then produce the final sections:

    node scripts/judge-plan.mjs rows --tier1=/tmp/tier1.md --tier2=/tmp/tier2.md

A tier-2 pass is skipped only when tier 1 returned no `drifted` and no
`suspect` row, and the report says so.

### 5. Aggregate

Present the two reports under `## Standards` and `## Spec` headings,
verbatim or lightly cleaned. Do **not** merge or rerank findings; the two
axes are deliberately separate (see below).

**(dormant)** End with a one-line summary: total findings per axis, and the
worst issue *within each axis* (if any). Do not pick a single winner across
axes; that is the reranking the separation exists to prevent. Inside
`/feature`, this summary carries into phase 5 and into the PR body that
`/to-preprod` or `/review` writes.

**(connected)** Under `## Spec`, print the three sections
`judge-plan.mjs rows` produced, in the order it produced them, unaltered:

| Section | Holds | Who reads it |
|---|---|---|
| `## Spec verdicts` | The six columns `node \| criterion \| judged against \| verdict \| spec line \| where`, and only `matched`, `drifted` and `unverifiable` | The preprod gate, the PR body, `/release` |
| `## Suspect rows` | Every `drifted` verdict that showed no concrete input and wrong result, downgraded | A person, and nothing else |
| `## Tier disagreements` | Every row the two tiers scored differently | A person, as calibration |

Then the proposals step 2 found that added nothing (declined, withdrawn,
superseded), listed as facts. A `drifted` row on a node whose
`effectiveStrictness` is `legal` or `contractual` is flagged in the row's
`node` cell as **strict**.

**Do not move a `suspect` row into the verdict table, and do not put
`## Suspect rows` above it.** `parseVerdictTable` in `scripts/gate-run.mjs`
faults on a fourth verdict and stops reading at the next heading, so either
mistake makes every gate run report a malformed table. The ordering is the
mechanism, not a layout preference.

End with a one-line summary per axis: Standards gives its finding count and
its worst issue; Spec gives its matched, drifted, unverifiable and suspect
counts and its worst row (a strict drifted outranks a drifted, which
outranks an unverifiable, which outranks a suspect). Do not pick a single
winner across axes.

Inside `/feature`, write all three sections into the feature context,
replacing any earlier copy and keeping that order. They are the record the
phase 5 exit reads: `/to-preprod` runs its preprod gate on the `drifted`
rows judged against `current`, copies the verdict table and the suspect rows
into the PR body, and `/release` claims from the verdict table alone once
production serves the release. **A `suspect` never becomes a claim**, which
is why it never enters the table: claim vocabulary is what Spec Universe
accepts, `matched` and `drifted`. A verdict is against the specification as
it read at review time; if a proposal changes after this, re-run the review.

## Why two axes

A change can pass one axis and fail the other:

- Code that follows every standard but implements the wrong thing:
  Standards pass, Spec fail.
- Code that does exactly what the issue asked but breaks the project's
  conventions: Spec pass, Standards fail.

Reporting them separately stops one axis from masking the other.

## Why a comparison, and why the evidence rule **(connected)**

A reviewer asked "does this conform?" reads until it finds a reason to say
yes. That was the original argument for asking the judge to refute instead,
and the measurement says refutation overshoots badly: an adversarial or
explain-and-fix brief rejects CORRECT code 26 to 88 percent of the time,
while asking what the code does and comparing it to the obligation lifts
recognition of conforming code from 11 to 85 percent.

The evidence rule is what replaces the refutation as the thing that makes
`matched` mean something. A judge that cannot name a concrete input and the
wrong result has a suspicion, not a finding, and requiring the pair cuts
false rejection from 89 to 40 percent. The suspicion is not thrown away: it
becomes a `suspect` row a person reads. It is simply never claimed as drift,
never gated on, and never written to Spec Universe.

Grouping by the changed files that reach a node is what keeps the criterion
count per judge small enough that every row is a judgement and not a sample,
without judging a hub file once per node it anchors. A wrong anchor still
surfaces as `unverifiable` on exactly the node it is wrong for, because the
group's on-demand list gives the judge somewhere to look first.

---
Adapted from [mattpocock/skills](https://github.com/mattpocock/skills) (MIT).
