# Code review in connected mode

Read from `SKILL.md` when `.harness-version` has a `spec_product:` line:

    SPEC_PRODUCT=$(sed -n 's/^spec_product: *//p' .harness-version | tail -1)

Set, the loop is awake, and the Spec axis reads Spec Universe rather than the
tracker, one judge sub-agent per **changed-file group**: the nodes reached by
the same set of changed files, capped at ten acceptance criteria. It is not
one agent for the whole diff, and it is not one per node. The judge compares
behaviour to obligation rather than hunting for fault, and may not return
`drifted` without naming a concrete input and the wrong result. All three are
measured decisions (`.claude/SPEC-LOOP.md`, the judge section). The
classification lives in `scripts/judge-plan.mjs` and the brief in
`judge-prompt.md` beside this file, so neither can be paraphrased into a
different instrument.

Each section below names the `SKILL.md` step it replaces. The Standards axis
and the S reviewer are unchanged by this file: connected, the S reviewer keeps
Standards and the docs scope, and the Spec axis is the judges at every tier,
because the judge prompt is measured and is never merged into another brief.

## The implicated set (step 2)

The Spec axis reads **Spec Universe, never the tracker issue.** The
specification of a change lives there as proposals under the change key; the
issue is a thin work item that points at them (`.claude/SPEC-LOOP.md`).

Every Spec Universe read and write goes through the shared client:

    SU="bash .claude/scripts/spec-universe.sh"

It fails closed, and the three faults it distinguishes (exit 3 a missing
credential, 4 a refused token, 5 unreachable, printing exactly
`spec unreachable, cannot verify`) are documented once in
`.claude/SPEC-LOOP.md`. On any non-zero exit, stop and report what the client
printed. Run one read first (`$SU nodes "$SPEC_PRODUCT"`) so the review dies
before it spawns judges rather than after: on exit 5 the whole review stops
with **"spec unreachable, cannot verify"**. Judge from the specification as
read, never from memory of it, and never from the issue.

Resolve the change key: the leading `<key>` of the feature name in
`.harness-feature`, or the Tracker section of the feature context. Standalone,
with no change key, say so and judge against current text only.

`prepare` (next section) builds the implicated set. This is what it builds,
so the plan it prints can be read:

1. **Anchors from the BASE side of the diff.** For every changed path
   (`git diff --name-status <fixed-point>...HEAD`), its `Spec:` lines from
   `git show <fixed-point>:<path>`, so a deleted or moved file still fans out
   to the nodes it served. For a path that is added, or whose anchors
   changed, the HEAD side too, as the union. The grammar is the one
   `scripts/check-spec.mjs` enforces; `Spec: support` contributes nothing.
   Per node, the list of files that cited it.

2. **The change's own proposals** (`$SU change-proposals <KEY>`). Every
   proposal in state `draft` or `accepted` adds its node (or the new node it
   proposes) to the set, and its `fields` are the PROPOSED text that node is
   judged against. A `declined`, `withdrawn` or `superseded` proposal adds
   nothing and is listed in the report as a fact.

   **A proposal implicates its node on its own**, so a change that moves the
   specification to match code that already exists is judged and therefore
   claimable, even though its diff anchors nothing. The set is a set: a node
   reached by both a changed anchor and a proposal is judged once, against
   the proposed text.

3. **Governing requirements and declared dependencies.** For every
   capability and interface in the set, the target of every outgoing
   `is-governed-by` edge: those are the requirements the node answers to,
   and they are what gets judged with criteria. For every node the change's
   proposals touch, the targets of its other outgoing edges too (what the
   feature declares it depends on), whole-node.

4. **The text to judge against.** For each node in the set, the current
   `behaviour`, `rulesAndEdgeCases` and `acceptanceCriteria` (with ids) and
   the node's `effectiveStrictness` and `criticality`. Where item 2 found a
   proposal on that node, its `fields` overlay the current text and the node
   is marked **judged against proposed `<prp_id>`**; otherwise **judged
   against current**.

An empty set is itself a finding: a diff that changes behaviour and
implicates no node means a wrong or missing anchor, and the report says
which changed files were `support`.

## Plan the judges (step 2b)

The grouping is a deterministic answer, not a judgement, so the script owns
it. Two commands, in this order:

    node scripts/judge-plan.mjs prepare --diff-base=<fixed-point> \
      --product="$SPEC_PRODUCT" --key=<KEY>
    node scripts/judge-plan.mjs plan --diff-base=<fixed-point> > /tmp/judges.json

`prepare` writes the inputs (`anchors.json`, `governs.json`, `criteria.json`,
`index.json`, `nodes.json`, `proposals.json`) under `/tmp/judge-inputs`,
fetching through the client only the nodes the diff reaches; it prints one
summary line (changed files, anchoring files, nodes, proposals, unresolved).
Report that line. On a client fault it exits non-zero with the client's
words: stop, as above. Omit `--key` standalone.

`plan --diff-base` reads the hunks of the changed files and drops a node
reached only through files whose hunks touch no block anchoring it; a `Spec:`
line change, a new file, a deleted file and a proposal's node always judge.
The dropped nodes come back under `## Not judged` with the reason, beside
the line-count threshold that decided any file-level anchor. Keep that block:
it is printed with the review (see "The verdict sections"), so the pruning is
a decision put to the reader and never a silent loss.

Each judge in `/tmp/judges.json` carries its `id`, its `nodes`, the files it
must `load` in full, and the files it may read `onDemand`. **Do not regroup
by hand.** Every node lands in exactly one group, which is what keeps one
criterion to one row; a hand-made group breaks that and the verdict table
with it.

## The judges (step 4)

**Judge sub-agent prompt**: `judge-prompt.md` beside this file, everything
below its horizontal rule, verbatim, with its placeholders filled from the
judge's entry in `/tmp/judges.json` and the node text from
`/tmp/judge-inputs/nodes.json` and `proposals.json`. Do not restate it here
and do not improve it in passing: the measured numbers belong to that exact
wording. The sub-agent has no Spec Universe access of its own and must not
go looking. Fill `{DIFF}` with the pasted diff from step 1, as every other
prompt gets it.

**Judges are resumable.** Each writes its table to `/tmp/judges/<id>.md`
(`{ID}` in the prompt). Before dispatching, list that directory: **skip
every id whose file exists**, so a review resumed after a dead session or a
mid-dispatch failure re-runs only what never finished. Start a fresh review
of a new sha by clearing the directory first; a table from an earlier sha is
not evidence about this one. A judge that returned its table but left no
file: write the table it returned to the file yourself.

Dispatch all remaining judges in one turn (batches of ten where the set is
large). **On a concurrent-limit refusal**, wait for one completion and retry
the **same id**; never re-plan, because a second plan on the same diff gives
the same groups and a re-plan only costs the tables already written.

**Tier 1 runs every judge on `sonnet`** (the Agent tool's `model` parameter;
the tier is a model because there is no effort knob). Collect the tables:

    node scripts/judge-plan.mjs rows --tier1=/tmp/judges/ > /tmp/rows1.md

A tier-1 drifted row is INPUT to tier 2, never a finding. Do not write, fix,
comment or record anything from it until the tier-2 row exists.

`rows --tier1` without `--tier2` is provisional: its heading says so
(`## Spec verdicts (provisional, tier 1 only)`), and a `## Rows for tier 2`
section lists exactly what to re-run. Nothing under a provisional heading is
carried into the feature context, the PR body or a claim.

**Tier 2 re-runs only the `drifted` and `suspect` rows**, at the session's
default model, with the same prompt narrowed to those criteria and `{ID}`
filled as `tier2/<id>`, so the table lands in `/tmp/judges/tier2/<id>.md`
where the tier-1 read (top-level files only) never picks it up. The same
skip rule applies to that directory. Those are exactly the rows the
measurement calls unreliable; a `matched` or `unverifiable` row is not
re-run. Then produce the final sections:

    node scripts/judge-plan.mjs rows --tier1=/tmp/judges/ --tier2=/tmp/judges/tier2/

A tier-2 pass is skipped only when tier 1 returned no `drifted` and no
`suspect` row: `rows --tier1` alone is then final (no provisional heading),
and the report says so.

## The verdict sections (step 5)

Under `## Spec`, print the three sections `judge-plan.mjs rows` produced, in
the order it produced them, unaltered:

| Section | Holds | Who reads it |
|---|---|---|
| `## Spec verdicts` | The six columns `node \| criterion \| judged against \| verdict \| spec line \| where`, and only `matched`, `drifted` and `unverifiable` | The preprod gate, the PR body, `/release` |
| `## Suspect rows` | Every `drifted` verdict that showed no concrete input and wrong result, downgraded | A person, and nothing else |
| `## Tier disagreements` | Every row the two tiers scored differently | A person, as calibration |

Then the `## Not judged` block the plan printed, then the proposals the
implicated set found that added nothing (declined, withdrawn, superseded),
listed as facts. A `drifted` row on a node whose `effectiveStrictness` is
`legal` or `contractual` is flagged in the row's `node` cell as **strict**.

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

## Why a comparison, and why the evidence rule

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
