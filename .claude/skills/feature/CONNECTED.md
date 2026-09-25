# Feature in connected mode

Read from `SKILL.md` when `.harness-version` has a `spec_product:` line:

    SPEC_PRODUCT=$(sed -n 's/^spec_product: *//p' .harness-version | tail -1)

Set, the spec loop is awake: the grill retrieves the nodes the change's own words reach,
the plan writes proposals rather than a spec issue, and phase 4's review judges against
Spec Universe. `.claude/SPEC-LOOP.md` is the whole mechanism. Each section below names the
`SKILL.md` step it extends; nothing here forks Capture, the change key or the work item,
which every repository mints and opens. Only where the specification goes forks.

## Phase 0: the work item

In `## Change key`, after the size line: "Every proposal this change drafts carries
`changeId = <KEY>` and `changeUrl` = this issue." `## Specification` is filled by
`/to-spec` with the Spec Universe change view link and a short summary, whatever the tier;
the specification itself lives in Spec Universe under the key.

## Phase 0: nodes in the touched set

The declaration carries nodes as well as paths. Pass `--spec="$SPEC_PRODUCT"` to `render`
in place of `none`, and one `--node=<slug>` per node the change means to touch, or the
single node `none` where it touches none. Every later widening of the record (the plan
reaching an undeclared path, phase 1c, phase 5) refreshes nodes the same way, with
`--node` on `touched-set.mjs refresh`.

## Phase 0: a strict pause on resume

After the durable artefacts have named the phase, check the feature context for a
**strict pause waiting** (see "The conflict protocol" below): if one is recorded, re-read
that proposal before anything else and act on its state as `CONFLICT-PROTOCOL.md` says.

## Phase 1: retrieve the specification first, and never snapshot it

Before the first grill round (M and L), load the three to six nodes the change's own words
reach, not the whole product: a whole-product snapshot runs over the tool result cap, so it
buys a truncated document that still lacks the node the feature is about. The snapshot
command stays on the client for the one thing it is good at, a person asking for a
whole-product view.

The terms are the Capture **title and why, verbatim**. A session that picks its own nouns
makes a judgement twice and makes it differently on the resume; a session that finds the
vocabulary does not match adds terms with `--include=<slug>` and records that it did.

```
R=$(mktemp -d)
P="$SPEC_PRODUCT"
printf '%s\n%s\n' "<the title>" "<the why>" > "$R/terms.txt"
SU="bash .claude/scripts/spec-universe.sh"

# The node list is REDIRECTED, never read into context: that is the whole
# saving. Only the selected nodes are ever paid for.
if $SU nodes "$P" > "$R/all.json"; then
  node scripts/retrieval.mjs select --product="$P" --nodes="$R/all.json" \
    --terms-file="$R/terms.txt" --dir="$R" > "$R/slugs.txt" || exit 1
  # A `for` over the file, never a pipeline into `while read`: an inner
  # command that reads stdin would eat the rest of the slug list with no
  # error, and truncate the set silently.
  for slug in $(cat "$R/slugs.txt"); do
    $SU node "$P.$slug" > "$R/$slug.node.json"
    $SU dependencies "$P.$slug" out > "$R/$slug.deps.json"
  done
else
  node scripts/retrieval.mjs select --product="$P" --dir="$R" \
    --terms-file="$R/terms.txt" --fault=$?
fi
node scripts/retrieval.mjs render --dir="$R"
```

`render` prints the block on stdout and **one summary line on stderr**: the node count,
the byte count and the terms. Report that line, so the cost of the load is visible at the
load. Paste the block into the feature context as its `## Retrieved specification`
section.

Dependencies are listed by name, never fetched: a governing requirement whose text turns
out to matter is read on demand with `$SU node "$P.<slug>"`. That is the judge's rule at
interview scale, and it is why the set stays at 5 to 10 KB.

**The block is interview context and never the text a write is built from.** It carries
`readAt` and each node's version so a reader can see how old it is; `/to-spec` re-reads
live the node it is about to propose against, because a proposal built on the recorded
copy would replace a field with a value someone else has since changed.

The three client faults reach the block as themselves. Exit `3` and `4` are configuration
faults, named as such; exit `5` means "spec unreachable, cannot verify", and the grill
then covers only what touches no existing node. A check still fails closed; an interview
degrades in the open, which is what the fault block is. Nothing is committed but that
block, and it dies with the feature context at the merge: no copy of the specification
outlives the change it served.

With the retrieved set in context, an answer that collides with a node is recognisable in
the round it is given, which is the cheapest moment for the conflict card. A collision
with a node retrieval did NOT reach is still a collision: `/to-spec`'s conflict sweep is
what catches it, and it reads live.

**The grill is done** only when, beside `SKILL.md`'s done-when, every conflict the grill
surfaced has a recorded A/B/C decision. A conflict can surface in any phase; 1c is where
the settled decisions are checked as a set.

## The conflict protocol

A feature can collide with the specification as it stands: a node whose text says the
opposite of what the feature intends, a rule another system is bound by, a criterion the
change would make false. That collision can surface at any phase, and whenever it does,
**STOP and read [CONFLICT-PROTOCOL.md](./CONFLICT-PROTOCOL.md)**, which owns the conflict
card, the A/B/C fork (amend, retire, conform), the three places the decision is recorded,
and the strict pause. A collision is settled by that fork, in the open, before the phase
continues.

**The card and the pause are the user's decisions**, exempt from phase autopilot and from
grill autonomy, and never self-answered.

## Phase 1c as a gate

Connected, 1c is a gate on every tier that runs a grill (M runs it between the grill and
the plan gate; L as its own phase). Write `assessing`. The question is "where is the
impact?", and the answer is three artefacts:

1. **The touched set, in full.** Refresh the declaration with every path the settled
   decisions now reach and one `--node` per implicated node (or the single node `none`).
   Re-run the overlap report from phase 0 and put what it says in the closing block and,
   where it found an overlap, under `## Parallel work` in the feature context.
2. **The settled decisions against the specification.** For each decision, the nodes it
   touches in the retrieved block: a decision that contradicts a node's text is a
   collision, and the conflict card is rendered now. A collision with a node retrieval did
   not reach is still caught by `/to-spec`'s sweep, which reads live.
3. **Every conflict with a recorded A/B/C decision.**

Then write `assessed` and gate: continue, or stay. The closing block carries the overlap
report and any conflict card in `Good to know`, the gate decision in `Act next`.

## Phase 2 (L) and the plan gate (M): proposals, not a spec issue

`/to-spec` runs the conflict sweep, writes the specification as Spec Universe proposals
under the change key, and UPDATES the work item's `## Specification` with the change view
link and a short summary. A conflict it finds comes back as a conflict card. Record the
change view link and the proposal ids in the feature context. The closing block carries
the change view link and the proposal count in `Good to know`, in place of a spec issue
number.

## Phase 4: verdict handling

`/code-review`'s Spec axis judges every implicated node against Spec Universe and writes
the three verdict sections into the feature context. A `drifted` verdict against current
text that no decision explains is a conflict: render the card. The docs-updater's scope
is unchanged by this; the two run in the same turn as `SKILL.md` says.

## Phase 5: the preprod gate

`/to-preprod`'s preprod gate reports every `drifted` verdict this branch INTRODUCED that
no accepted proposal covers, and under `gate-mode: enforce` refuses the merge on one, so a
conflict left undecided stops here rather than on `preprod`. Under `evaluate`, the
default, the same rows are printed in the same words and the merge proceeds; the run is
recorded either way. Under `--ship` a refused merge is a block: stand down.

## Gates under `--ship`

Two things neither entry point answers: the conflict card and the strict pause. Both are
the user's decision about the specification itself, not about this session's pace. The
session still stops there and renders the card or the pause; under `--ship`, where there
is nobody to wait for, it stands down (`SKILL.md`, "Standing down"), and the feature
context records the card or the pause that is waiting.
