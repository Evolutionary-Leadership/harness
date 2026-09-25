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

The touched-set record (contract in `.claude/HARNESS.md`) lives on the
session branch as `.harness/journey/<slug>.md` while the feature is in flight,
and `journey-sync.yml` mirrors every push of it onto the `coordination` branch
as `features/<slug>.md`, which is where the cockpit and every other session
read it. It carries one scalar for this: **`phase`**, holding the position the feature is at, spelled exactly as the cockpit's
lifecycle spells it. `touched-set.mjs` refuses any other value.

```
captured  challenging  challenged  shaping  shaped  assessing  assessed
deciding  committed  planning  planned  building  built  verifying  verified
reviewing  reviewed  releasing  released  adoption  used  evaluating  evaluated
```

The record carries two more scalars beside `phase`, both optional and in this
order after it: **`size`**, the tier the change was given at Capture (`S`, `M`
or `L`, set by `journey.sh phase --size=`), and **`phases`**, the append-only,
comma-separated history of every position written, in order. `phases` is what
makes a gap readable: a record at `building` whose history reads
`captured,committed,building` says the change took the S tier rather than
that four states went missing. A record without either line parses as before.

**Two writes per transition.** Write the transition's key the moment work on
it starts, and the state's key the moment its artefact exists. Both are
observations: "a session is working on `shaping`" and "the `shaped` artefact
exists". Writing only states would leave the cockpit to infer the edge from
nothing, and inferring from nothing is the one thing it refuses to do. The
transition write exists for the cockpit's in-progress edge and is skipped
where no cockpit is configured: `journey.sh` decides, dropping transition
positions from a call unless `cockpit.sh configured` succeeds or the call
passes `--all`, and says `journey: states only (no cockpit)` once per session.
State writes happen everywhere, cockpit or not.

**Positions by tier.** An S change writes `captured`, `committed` and `built`,
plus `building` where a cockpit reads transitions, and nothing between: the
gap is the honest rendering of a change that took no interview and cut no
spec. M and L write every state they pass through, and every transition where
a cockpit reads them.

**The write is one call.** Every write of `phase` is a refresh of the record,
so `updated_at` moves with it:

    bash .claude/scripts/journey.sh phase <position> "<one sentence in the position's own terms>"

Several positions in one call (`phase committed,building "..."`) write the
last as `phase` and append all of them to `phases`; `--size=S|M|L` sets the
tier. The script reads the record (the journey file on this branch, else the
`coordination` copy), refreshes it with `touched-set.mjs`, commits that file
alone with the sentence as the commit body, and pushes the session's
`claude/` branch, the one ref the git proxy lets a session write. `--no-push`
leaves the commit for a push that follows at once. Capture's first record
goes the same way through `journey.sh declare <file>`. It is one call inside
the claude.ai sandbox and out of it, and nothing follows it: the session
makes no GitHub API write and no ring for a position. Every command exits 0
and prints nothing on stdout.

The push starts `journey-sync.yml` (the check and feature-merge workflows
ignore the path, so a journey-only push starts nothing else), which mirrors
the file onto `coordination` under the workflow's own token, then **rings the
cockpit and reports the boundary** (`cockpit.sh ping --key`, then
`cockpit.sh report <position> "<the sentence>" --key`, the key read from the
record, the sentence from the commit body). The ring needs the repository's
Actions `BOARD_URL` (a variable or a secret) and `BOARD_TOKEN` (a secret);
without them the record is still mirrored and nobody is rung. The session
decides whether to write transition positions from its own environment, so
it needs the same two variables to draw the in-progress edge. The position
reaches `coordination` 20 to 40 seconds after the push, one runner start,
which the cockpit's poll covers anyway. The key comes out of the record rather
than the session, so a write lands the same way from a fresh session, from
`/continue`, and after a crash; a record with no `key:` rings and reports
with none, which is the fail-soft answer rather than a wrong key.

`/feature` and `/continue` say "write the phase" and mean that one call;
`/to-preprod` never writes it, it retires the record at the merge with
`journey.sh retire`, which stages the file's deletion for its signal commit,
whose push has `journey-sync.yml` delete the `coordination` copy. A write is
advisory like every coordination write: a failure is one `journey:` line on
stderr and the flow continues.

**Ring AFTER the write, never before.** The ping says where to look, so a ring
that goes out first sends the cockpit to read the position the change already
had, and the new one then waits for the next poll: worse than not ringing.
The rule is now the workflow's: `journey-sync.yml` rings only once its push to
`coordination` has landed, and a session never rings for a position itself.
This is also why the ping carries a key and no position. The record is the fact; the ping is the doorbell
(`.claude/HARNESS.md` names the client).

**The report is the third step and not a second doorbell.** The ring says
where to look; the report says what is happening once somebody looks. Its
sentence is one line in the position's own terms ("working the frontier, 6
tickets open", "the spec is published, cutting tickets"), and it carries no
`ref`, because a boundary is a fact rather than an operation that will finish.
The section below has the voice and the other seven seams.

**A ring costs nothing when it fails, and nothing at all when no cockpit is
configured.** `ping` never exits non-zero at runtime: it is silent with no
`BOARD_URL` and `BOARD_TOKEN` in the environment, and one line otherwise. It
is an optimisation over a poll that runs anyway, so it may never be the reason
a phase write, or anything else, stops.

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
`updated_at` is older than **four working hours** (the manifest below declares
it, as 14400 seconds) as no longer working: the change then falls back to the
last STATE it completed and starts ageing there as waiting, against the state's
threshold, rather than as duration against the transition's. That is the honest
reading of a session that stopped, and it is why there is no `blocked_since`
scalar (see "Blocked"). Four hours is longer than an interview round and
shorter than a working day.

## Reporting activity

The record says WHERE a change is, and its `updated_at` says somebody is still
working there. Neither is content. A reader looking at `building` under a
fourteen-minute-old timestamp cannot tell a session running a test suite from
a session waiting on an answer from a session that died. A **report** is one
sentence of that missing half, posted with `.claude/scripts/cockpit.sh report`.

**A report never moves a change.** The position it names is stored as the
producer's own words and the cockpit's placement never consults it, exactly as
the Board carries an ask and never a position. Where a feature is comes from
the record and from GitHub, and nothing said here changes it.

### The eight seams

Coverage that asks every step to remember a report rots: the next person
editing a skill will not know they owe one, and within a few releases the
stream has holes. A stream with holes reads as a STALL, which is worse than no
stream at all, because a reader cannot tell "nothing is happening" from
"nobody instrumented this". So there are eight seams and no more, and each one
sits inside a shared procedure that other steps already quote, so a step added
later inherits its report instead of owing one.

| Seam | Where it lives | Ref |
|---|---|---|
| A phase boundary | `journey-sync.yml`, after it mirrors a `journey.sh phase` push onto `coordination` | none |
| A question round asked | `/grilling`'s round loop | `<KEY>:<position>:round-<first question number>` |
| The same round answered | the same loop | completes it |
| A gate put to the user | `/feature`'s "Gates" | `<KEY>:gate-<name>`, e.g. `gate-plan-and-go` |
| The gate's verdict | the same rules | completes it |
| A long operation starting | `/implement`'s frontier loop and Finishing, and `/code-review`'s own steps 1 and 5 | `<KEY>:ticket-<n>`, `<KEY>:check@<sha>`, `<KEY>:review@<sha>` |
| The same operation finishing | the same three | completes it |
| A stand-down | "Blocked" below, as its fourth part | none |

The long-operation seam is ONE seam with three named uses, which is why eight
seams are twelve lines of recipe, in five files. A fourth use of it is a
decision, and so is a ninth seam: both are the difference between a heartbeat
and a log, and nobody reads a log.

**A seam lives in the procedure that BOTH its callers reach.** The review pair
is in `/code-review` rather than in `/implement`, because `/feature` phase 4
runs the review directly and would never reach a recipe kept in `/implement`.
The same test decides where any later seam goes.

### Pairs, and what a ref promises

`ref` and `completes` are how a pair works, and a pair is DERIVED rather than
stored: the cockpit keeps no "running" column, exactly as the Board keeps no
"answered" one. A long operation starting carries a `ref`; the same operation
finishing carries a `completes` naming it. "Still running" and "for how long"
fall out of that.

**A ref is a promise of a matching finish.** Only a report that will be
completed carries one, so an unfinished pair always means a session that died
mid-operation, and never a fact that was instantaneous. That is why a phase
boundary and a stand-down carry none.

**Bind a ref once, in a shell variable, and use it in both halves.** Every
recipe above does. The client refuses an unknown position by name, but it
cannot check a ref, because a ref's correctness is relational rather than a
vocabulary: a mistyped one delivers its sentence and then pairs with nothing,
which shows as an operation that never finished. One variable two lines apart
is what makes that unable to happen.

A ref is also the idempotency guard, so every shape above is derived from
something the producer already holds and a re-run reproduces it rather than
randomising it. There is no session identity in a ref because there is none on
the wire: the credential is the author. The honest consequence is that a grill
resumed in a fresh session restarts its question numbering, so a re-used round
number reads as the same round and the cockpit writes nothing. That is as
close as an idempotent ref gets without inventing an identity the design
refuses to send.

### What a sentence says

One line, in the work's voice and not the session's: present tense for
something that started, past tense for something that finished, naming the
work and never the narrator. No "I", no "the agent". Sentence case, no
trailing full stop, under about a hundred characters, because it lands in a
row beside a timestamp rather than in prose.

    asked round 3, four questions on the storage seam
    round 3 answered
    ticket #47 started: the frontier query
    ticket #47 closed
    running the full check
    the full check passed
    waiting at the phase 3 gate: 6 tickets to approve
    gate answered: build
    stood down: the preview deploy is red and only its owner can clear it

**A report can never stop a session**, the same as a ring. It exits 0 on every
runtime path, prints nothing at all when no cockpit is configured, and one
line otherwise. Read the line, put it in the closing block if there is one,
and carry on. Do not retry it and do not ask the user about it.

**One line is the exception to reading past it: `COCKPIT REPORTS OFF`.** It is
said once per session, for a refusal that covers every report the session will
make: a credential the cockpit rejects, or a repository no product in the
cockpit is configured against (a `ping` still lands then, because a refresh
accepts any repository, so the ring is no evidence the reports arrive).
Nothing the session reports afterwards is recorded, and the client stays quiet
about it. Put the line in `Act later` with the fix it names and where that fix
is made (the product's repository in the cockpit, or the `BOARD_TOKEN`
secret), and say it again in the phase 5 summary. It still stops nothing.

Its sibling, `COCKPIT REFUSED A REPORT`, is also said once per session and
status, for a refusal of what was sent rather than of the session: a shape the
cockpit does not take (a harness and a cockpit at different versions, most
likely) or a rate limit. Later reports may still land, so carry it the same
way but do not call the cockpit off. A `/feature` session's first report goes
out at phase 0, with `captured`, so either line arrives before any work does.

**Every seam in a `/feature` run carries the change key**, because the key is
minted in phase 0 before any seam can fire. A technique skill run on its own
(`/grilling` against an idea, `/implement` against a ticket) has no key, passes
none, and its report is scoped to the repository, which is honest where a
made-up key would not be.

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
| `challenging` | `/feature` phase 1: round 1 of the one `/grilling`, on the why alone | The work item exists | `## Challenge` is written and the verdict is `pursue` | `phase: challenging`; comments on the work item | **worth pursuing**: pursue, drop or park |
| `shaping` | `/feature` phase 1: the rounds after round 1 of the same `/grilling`, with `/domain-modeling`, on the how | Verdict was `pursue` | The grill is satisfied: frontier empty, nothing silently assumed, vocabulary recorded, scope boundary stated | `phase: shaping`; `chore(context):` commits | none |
| `assessing` | `/feature` phase 1c, L only (a gate only when connected): declare the touched set fully, read the namespace and, connected, check the settled decisions against the specification | Decisions settled | The record carries its paths and nodes, the overlap is reported, every conflict has a decision | `phase: assessing`; the record's `updated_at` moving | none |
| `deciding` | `/feature` phase 1d for L: the gate, put to the user; M folds it into the grill's why-and-how verdict | The assessment exists | The verdict is on the work item | `phase: deciding` | **build it**: build, drop or park |
| `planning` | `/to-spec` then `/to-tickets` (phases 2 and 3) | Verdict was `build` | Tickets exist, each with its blocking edges and its parent | `phase: planning`; issues appearing | **plan accepted**: the phase 3 gate, whose approval starts the build |
| `building` | `/implement` with `/tdd`, then `/code-review` (phase 4) | Tickets exist | Frontier empty, full check green, review run and acted on | `phase: building`; commits closing tickets | none |
| `verifying` | Phase 5's push; `feature-branch-checks.yml` on the pushed head | Built | The check on the current head is green | `check_run_activity` on the branch | **checks passed** |
| `reviewing` | `/review` (people) or `/to-preprod` (machinery, with the docs audit) | Verified | The pull request is merged | Review activity on the pull request | **approved to merge** |
| `releasing` | `/release` | Merged | The release is published | A `release.yml` run in progress | none |
| `adoption`, `evaluating` | Nothing. Both stay dark with the states they lead to | | | | |

## Gate verdicts, and what each does to the work item

The two front-half gates can end a journey as well as continue it. Both are
put to the user and never self-answered under autopilot or grill autonomy, and
self-answered only where the session was declared unattended.

**`/feature --ship` is the one exception, and it is an exception about who is
there rather than about what a gate is for.** The flag declares the session
unattended, so there is no user to put either gate to, and the session answers
both. Nothing else changes: the `pursue` label, the `## Challenge` rewrite and
the `build` comment are still written, so the artefacts below and the tree a
resume reads are exactly what a supervised run leaves. A run that would answer
`park` or `drop` does neither; choosing to end somebody else's change is a
decision, not a gate, and the session stands down instead. The skill owns the
rest of what the flag does.

| Verdict | Where | What happens |
|---|---|---|
| `pursue` (challenging) or `build` (deciding) | Label `pursue` on the work item at challenging; a comment naming the verdict at deciding | The next transition starts and its phase is written |
| `park` | Label `parked` on the work item, which stays OPEN; the branch, the feature context and the record stay too | The record's phase stays at the state the change was resting on. Nothing is deleted: a parked change is not a finished one, and `/continue` lists it with the label. Un-parking is removing the label and writing the next phase |
| `drop` | The work item is closed as **not planned**, with a comment saying why; the branch is deleted; the record is deleted from `coordination` (`journey.sh retire`, committed and pushed first, has `journey-sync.yml` do it; else the next stale sweep); the feature context goes with the branch | The cockpit reads a canceled tracker item as a dropped exit. Dropping by any other route (closing as completed, deleting the issue) is indistinguishable from finishing or from never having existed |

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
STANDS DOWN, and standing down has four parts, in this order:

1. **`## Blocked` in the feature context**: what is blocking, since when, and
   what would unblock it. Rewritten, not appended; deleted when the block
   clears.
2. **The `blocked` label on the work item.** Removed when the block clears.
3. **One Board ask, only when a person is what unblocks it**, posted with the
   `blocked` marker through `.claude/scripts/cockpit.sh`, subject
   `<KEY>: blocked at <position>`, body naming the change, the position, what
   blocks and what would unblock, addressed to the person the position waits
   on where one is known. At the moment of standing down, never on a timer,
   and never for a block the session then clears itself: a Board that carries
   every hiccup is a log, and nobody reads a log. If the Board is unreachable
   (`cockpit.sh` exit 3, 4 or 5), say so in one line; the section and the label
   are the record, the ask is only how a person hears sooner.
4. **One report, always**, at the position the record still names:

       bash .claude/scripts/cockpit.sh report <position> "stood down: <what blocks>" \
         --key="$KEY"

   Unlike the ask above, this one is NOT conditional on a person being what
   unblocks it. The two are different instruments: an ask is somebody's inbox,
   and a Board that carries every hiccup is a log nobody reads, while a report
   is a stream that costs nothing and a session going quiet without saying why
   is the exact thing the stream exists to prevent. It carries no `ref`:
   standing down is a fact, and the record's staleness already carries how long
   it has lasted.

Those four are the RECORD. The fifth part is the REPLY: emit the stand-down
block defined in `.claude/skills/getting-started/SKILL.md`, Step 3c, so the
session says it in the one shape every skill uses, and never reports the work
complete in a reply that carries it. The record is what the cockpit reads
later; the block is what the person reading this session sees now, and the two
failures in issue #277 were both in the second (a forge decision record).

The phase is NOT rewritten. The record keeps saying which transition was in
progress, and its `updated_at` stops moving; after the recency window the
cockpit shows the change back at the last state it completed, waiting.
That fallback is the design, not an accident: a `blocked_since` scalar would
let a stalled session keep claiming a transition it is not working on.

**A verdict of park or drop.** Not a blockage at all; see the gates above.

## Tiers, quick mode and resumption

The size tier decides which positions a change passes through (`/feature`,
`### Size`, owns the rubric). An S change goes `captured`, `committed` and
`built`, plus `building` where a cockpit reads transitions, and the record's
`phases` history shows the gap. That is the honest rendering of a change that
genuinely skipped the interview and the plan. `--quick` forces the S tier and
nothing else.

`--ship` is orthogonal to the tier: it changes who answers a gate, never which
positions a change passes through, so a `--ship` run writes every position its
tier would. Both are session-scoped, and `/continue` re-arms neither.

`/continue` re-derives the phase from the durable artefacts (work item,
challenge, spec, tickets, open tickets) and WRITES it, rather than trusting
the record's own value. The record is the one field a crashed session leaves
wrong, and a resume is the cheapest moment to correct it.

## A change that continues after its merge

A change can land in parts. When its first part merges, `/to-preprod` deletes
the record, and from then on the key's position is read from GitHub: the
merged pull request puts it at `reviewed`, and a release at `released`. More
work under the same key is a **continuation**: a new slug carrying the same
key, with a new record (`/feature`, "Continue a change after its merge", owns
the steps).

**That record names an earlier position than GitHub shows, and it wins.** A
continuation's record says `building`, or `shaping` if the next part is
grilled first, for a key whose first part already reached `reviewed`. The
cockpit places the key at the live record's position: a record still being
written, its `updated_at` inside the staleness window above, is the newest
fact about the change, while the merged pull request is evidence about a
part that shipped. "The last position whose evidence holds" applies within a
part, never across parts. The earlier evidence is outranked, not lost: when
the continuation's record is deleted at its own merge, placement reads GitHub
again, where both parts now are. A continuation's record that goes stale ages
like any other (above), at the last state it completed, so a second part that
stalled shows as stalled rather than hiding behind the first part's merge. A
key that goes from `built` or later back to `building` is therefore a
continuation, and its visit history shows both passes.

**Never write a position to keep a key high.** A continuation writes where its
work is. A record claiming `built` so the key would not appear to go
backwards would be the one wrong fact this whole design exists to refuse.

## The binding manifest

`.claude/journey-bindings.json` is this file's machine-readable sibling. Where
the tables above say in prose what each position leaves behind, the manifest
says, per position, which cockpit rule expression observes it and how recently
that signal must have fired for the position to still count as live:

    {
      "position": "shaping",
      "expression": "journey_phase_active",
      "recency_window_seconds": 14400
    }

All 23 positions are listed, in the journey's order. It also carries the
harness version it shipped as, so a reader meeting a vocabulary it does not
know can say which one it met instead of quietly placing nothing; and a `join`
block saying how a change key, a work item title and the two branch names are
shaped, as patterns with `{placeholder}` slots.

**It declares nothing instance-specific, and nothing about mechanism.** No
connection id, no actor source, no polling interval, and not this repository's
own change prefix: the file is byte-identical in every scaffold at a given
version, and the reader fills the rest in when it applies the manifest. It does
not say where the record lives either. `journey_phase_reached` and
`journey_phase_active` are the two expressions that read it, and where they
look is theirs to know.

Four positions carry `"expression": null` and a one-line reason. `adoption`,
`used`, `evaluating` and `evaluated` stay dark for the reason the states table
gives, and an explicit null is how the file says "on purpose" rather than
leaving a reader to wonder whether four entries went missing.

The manifest is harness-managed: it arrives with an upgrade and is not yours to
edit. A binding you want that it does not declare is one you add on the
reader's side.

## Where the words live

This file owns the procedure: which skill, which artefact, which check. The
Product Cockpit's lifecycle carries one line per transition naming the
artefact it produces, and its binding rules read `phase` from this record
through a file read scoped to the `coordination` branch. Neither restates
the other, and there is no third copy. A repository connecting to a cockpit
binds each front-half position to the record and each back-half position to
the GitHub evidence the tables above name; the binding screen is
configuration, not code, and the manifest is where that configuration comes
from rather than a person's memory of this page.
