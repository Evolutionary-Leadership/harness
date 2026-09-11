# The journey: where a feature is, and how anyone can see it

Every change a harness repository makes travels one journey, and the Product
Cockpit draws it: twelve **states** (a milestone reached, named in the past
participle) alternating with eleven **transitions** (work in progress, named
as an activity), with a gate at the end of some transitions. This file is the
one home for what each position MEANS in harness terms: which skill does the
work, what artefact it leaves, when a transition may start, when it is done,
and how a person or the cockpit can see any of that without inferring it.

The cockpit places nothing it cannot observe. So the whole design reduces to
one rule, and everything below is that rule applied position by position:

> **A state is an artefact that exists. A transition is a session that is
> working.** A transition's definition of done is the entry predicate of the
> state it reaches: "this artefact exists, here, and passes this check". Its
> definition of ready is the previous state's artefact, plus the previous
> gate's verdict where there was one.

That makes a definition of done and a cockpit binding the same sentence,
which is what makes the front half of the journey instrumentable at all.

## The record: `phase` in the touched set

The touched-set record (`features/<slug>.md` on the `coordination` branch,
contract in `.claude/HARNESS.md`) carries one scalar for this: **`phase`**,
holding the position the feature is at, spelled exactly as the cockpit's
lifecycle spells it. `touched-set.mjs` refuses any other value.

```
captured  challenging  challenged  shaping  shaped  assessing  assessed
deciding  committed  planning  planned  building  built  verifying  verified
reviewing  reviewed  releasing  released  adoption  used  evaluating  evaluated
```

**Two writes per transition.** Write the transition's key the moment work on
it starts, and the state's key the moment its artefact exists. Both are
observations: "a session is working on `shaping`" and "the `shaped` artefact
exists". Writing only states would leave the cockpit to infer the edge from
nothing, and inferring from nothing is the one thing it refuses to do.

**The write is the refresh recipe, with `--phase`.** Every write of `phase`
is a refresh of the record, so `updated_at` moves with it:

    R=$(mktemp -d)
    bash .claude/scripts/coordination.sh feature "$FEATURE_NAME" > "$R/mine.md"
    node .claude/scripts/touched-set.mjs refresh --from="$R/mine.md" \
      --phase=<position> > "$R/next.md"

then write `$R/next.md` back to `features/$FEATURE_NAME.md` on `coordination`
with `mcp__github__create_or_update_file` and the sha you read. `/feature`
and `/continue` say "write the phase" and mean this recipe; `/to-preprod`
never writes it, it deletes the record at the merge. A write is advisory
like every coordination write: a failure is one line and the flow continues.

**The record covers `captured` through `built`, and hands over there.** From
`verified` on, the evidence is a check run on the pushed head, a pull
request, a review, a merge, a release: artefacts GitHub owns and the cockpit
already reads. `/to-preprod` deletes the record at the merge, and nothing is
lost by that, because placement takes the LAST position whose evidence holds
and the later ones hold on GitHub. The front half is declared; the back half
is observed; the seam is the first position whose artefact exists outside
the session.

**Staleness is the signal, not a fault.** A transition holds only while its
signal is live. The cockpit's binding on `phase` should treat a record whose
`updated_at` is older than **four working hours** as no longer working: the
change then falls back to the last STATE it completed and starts ageing
there as waiting, against the state's threshold, rather than as duration
against the transition's. That is the honest reading of a session that
stopped, and it is why there is no `blocked_since` scalar (see "Blocked").
Four hours is longer than an interview round and shorter than a working day.

## The states

Where the work lives once a state is reached, and how its presence is seen.
"Waits on" is who has to act for the change to leave.

| State | Means | Artefact (where the work lives) | Seen as | Waits on |
|---|---|---|---|---|
| `captured` | Someone can say the title, what will be different, and why | The work item on the tracker, titled `<KEY>: <title>`, with `## Why` | An issue with the key; `phase: captured` | A person: is this even right? |
| `challenged` | The why survived "why do you want this?" | `## Challenge` on the work item: the sharpened why, what was rejected, the verdict, and the `pursue` label | Section present, verdict `pursue` | A person: what exactly will it be? |
| `shaped` | What it will be is settled | The feature context's `Decisions settled` and `Out of scope`, pushed, beside the `## Retrieved specification` block the grill used as context | The file on `feature/<slug>` | A person or agent: where is the impact? |
| `assessed` | Where the impact is | The touched-set record's `paths` and `nodes`, `## Parallel work` in the feature context, and every settled decision checked against the retrieved specification with each conflict carrying an A/B/C decision | `coordination.sh feature <slug>`; the overlap report | A person: are we doing this? |
| `committed` | "Build it" was decided | The verdict on the work item, as a comment naming build, and the `## Decision` line in the feature context | Comment present; no `parked` label, issue open | An agent: but how? |
| `planned` | The spec and the tickets exist | The spec issue or the Spec Universe proposals under the key, `## Specification` on the work item, ticket sub-issues with blocking edges | The work item lists tickets | An agent: how do we build it? |
| `built` | Every ticket closed, the full check green locally, `/code-review` run | Commits on the branch, closed tickets, the findings and the check result at that sha in the feature context | Zero open sub-issues; `phase: built` | Machinery: is this any good? |
| `verified` | Checks green on the pushed head | The check run on the feature branch head (`feature-branch-checks.yml`), plus the findings and the local check result the feature context already carries | A green check on the current head; red takes the state away again | A person: do we approve it? |
| `reviewed` | Merged into `preprod` | The merged pull request, its body carrying the findings, the docs audit and the verify steps | The merge | Machinery: may this go to prod? |
| `released` | Tagged and published | The GitHub Release, `VERSION`, the release note | The release | Nobody |
| `used`, `evaluated` | Somebody used it; the outcome has a verdict | **Nothing yet.** The harness leaves both dark on purpose: seeing use needs an analytics source no harness repository has, and a dark position is honest where a guessed one is not | Not instrumented | |

## The transitions

Which skill does the work, when it may start, when it is done, and how a
reader can see that it is in progress. "Done when" is the next state's
entry predicate, restated so this table can be read on its own.

| Transition | Skill or step | Ready when | Done when | Working seen as | Gate and verdicts |
|---|---|---|---|---|---|
| `challenging` | `/feature` phase 1a: a short `/grilling` on the WHY alone | The work item exists | `## Challenge` is written and the verdict is `pursue` | `phase: challenging`; comments on the work item | **worth pursuing**: pursue, drop or park |
| `shaping` | `/feature` phase 1b: `/grilling` with `/domain-modeling` on the how | Verdict was `pursue` | The grill is satisfied: frontier empty, nothing silently assumed, vocabulary recorded, scope boundary stated | `phase: shaping`; `chore(context):` commits | none |
| `assessing` | `/feature` phase 1c: declare the touched set fully, check the settled decisions against the specification retrieved in 1b, read the namespace | Decisions settled | The record carries its paths and nodes, the overlap is reported, every conflict has a decision | `phase: assessing`; the record's `updated_at` moving | none |
| `deciding` | `/feature` phase 1d: the gate, put to the user | The assessment exists | The verdict is on the work item | `phase: deciding` | **build it**: build, drop or park |
| `planning` | `/to-spec` then `/to-tickets` (phases 2 and 3) | Verdict was `build` | Tickets exist, each with its blocking edges and its parent | `phase: planning`; issues appearing | **plan accepted**: the phase 3 gate, whose approval starts the build |
| `building` | `/implement` with `/tdd`, then `/code-review` (phase 4) | Tickets exist | Frontier empty, full check green, review run and acted on | `phase: building`; commits closing tickets | none |
| `verifying` | Phase 5's push; `feature-branch-checks.yml` on the pushed head | Built | The check on the current head is green | `check_run_activity` on the branch | **checks passed** |
| `reviewing` | `/review` (people) or `/to-preprod` (machinery, with the docs audit) | Verified | The pull request is merged | Review activity on the pull request | **approved to merge** |
| `releasing` | `/release` | Merged | The release is published | Deploy activity | none |
| `adoption`, `evaluating` | Nothing. Both stay dark with the states they lead to | | | | |

## Gate verdicts, and what each does to the work item

The two front-half gates can end a journey as well as continue it. Both are
put to the user and never self-answered, under autopilot or grill autonomy.

| Verdict | Where | What happens |
|---|---|---|
| `pursue` (challenging) or `build` (deciding) | Label `pursue` on the work item at challenging; a comment naming the verdict at deciding | The next transition starts and its phase is written |
| `park` | Label `parked` on the work item, which stays OPEN; the branch, the feature context and the record stay too | The record's phase stays at the state the change was resting on. Nothing is deleted: a parked change is not a finished one, and `/continue` lists it with the label. Un-parking is removing the label and writing the next phase |
| `drop` | The work item is closed as **not planned**, with a comment saying why; the branch is deleted; the record is deleted from `coordination`; the feature context goes with the branch | The cockpit reads a canceled tracker item as a dropped exit. Dropping by any other route (closing as completed, deleting the issue) is indistinguishable from finishing or from never having existed |

Parked and dropped are verdicts, never blockages: the change LEFT the linear
stream, on purpose, and a reader should see that it did rather than watch it
age.

## Blocked

Three different things hide under the word, and only one needs the harness to
do anything.

**Resting on a person at a state.** `captured`, `challenged`, `assessed`,
`verified` and `used` wait on a person by design. That is not blocked, it is
waiting, and the cockpit flags it as waiting too long after the state's
threshold. Nothing to record.

**Unable to pass a definition of done mid-transition.** A red check, a
conflict card the user has not answered, a strict pause, a merge conflict the
session cannot resolve, a question only the author can answer. The session
STANDS DOWN, and standing down has three parts, in this order:

1. **`## Blocked` in the feature context**: what is blocking, since when, and
   what would unblock it. Rewritten, not appended; deleted when the block
   clears.
2. **The `blocked` label on the work item.** Removed when the block clears.
3. **One Board ask, only when a person is what unblocks it**, posted with the
   `blocked` marker through `.claude/scripts/board.sh`, subject
   `<KEY>: blocked at <position>`, body naming the change, the position, what
   blocks and what would unblock, addressed to the person the position waits
   on where one is known. At the moment of standing down, never on a timer,
   and never for a block the session then clears itself: a Board that carries
   every hiccup is a log, and nobody reads a log. If the Board is unreachable
   (`board.sh` exit 3, 4 or 5), say so in one line; the section and the label
   are the record, the ask is only how a person hears sooner.

The phase is NOT rewritten. The record keeps saying which transition was in
progress, and its `updated_at` stops moving; after the recency window the
cockpit shows the change back at the last state it completed, waiting.
That fallback is the design, not an accident: a `blocked_since` scalar would
let a stalled session keep claiming a transition it is not working on.

**A verdict of park or drop.** Not a blockage at all; see the gates above.

## Quick mode and resumption

`/feature --quick` skips `challenging` through `planning`: the record goes
from `captured` straight to `building`, and the cockpit's visit history shows
the gap. That is the honest rendering of a change that genuinely skipped four
states, and quick mode stays available for the work it exists for.

`/continue` re-derives the phase from the durable artefacts (work item,
challenge, spec, tickets, open tickets) and WRITES it, rather than trusting
the record's own value. The record is the one field a crashed session leaves
wrong, and a resume is the cheapest moment to correct it.

## Where the words live

This file owns the procedure: which skill, which artefact, which check. The
Product Cockpit's lifecycle carries one line per transition naming the
artefact it produces, and its binding rules read `phase` from this record
through a file read scoped to the `coordination` branch. Neither restates
the other, and there is no third copy. A repository connecting to a cockpit
binds each front-half position to the record and each back-half position to
the GitHub evidence the tables above name; the binding screen is
configuration, not code.
