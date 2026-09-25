# Feature under `--ship`

Read from `SKILL.md` when the invocation carries `--ship`. Everything here applies only
then, with one exception: "Not stopping at gates" also defines phase autopilot, the option
the L 1d gate and the M why-and-how verdict offer, so it is read when a person chooses
that option too. Nothing here changes what a gate does, which artefacts a phase leaves, or
which positions a tier writes; `SKILL.md` owns all three.

## Not stopping at gates: phase autopilot and --ship

One concept, two entry points. The concept is that **the session does not stop at
gates**: everything a gate *does* still happens, and only the stopping stops.

- **The build verdict's fourth option**, *build, and go all the way to implement* (the
  phase 1d gate for L, the why-and-how verdict for M), auto-advances the plan gate and
  the phase 4 gate and stops at the phase 5 exit gate.
- **`--ship` in the invocation** declares the session **unattended from the start**:
  nobody is reading, so no gate is put to a person, and the exit is taken rather than
  offered. It composes with `--quick` and works without it.

**Why one stops at phase 5 and the other does not is derived, not decreed.** A person
answered the build verdict, so somebody is evidently reading, and the exit is a question
worth putting to them. `--ship` is the same switch thrown before any code exists, when
nothing proves that, so there is nobody to put it to. The difference is not how far the
session is trusted; it is whether anyone is there.

Under either, refresh the feature context at every phase boundary and push it at the
three checkpoints. Report what each phase produced (the plan, the spec, the ticket list,
the diff summary and review findings) as you pass through, so a reader reading back sees
the same trail they would have approved.

### What `--ship` reaches

**Ceiling.** `--ship` takes `/release`, always. A person typed it, about this session, so
it is release authority: the run goes from the first prompt to a merge on `preprod`, a
merge on `main` and a tagged release, and phase 0 says so in its exit line ("this run ends
in a tagged release on `main`"). `reviewers:` does not lower that: under `--ship`,
reviewers are requested on the pull request for the record, and the merge is not
withheld. A repository that wants a human on the diff runs without the flag, or takes
`/review`.

**`--ship` means production because a person said so, in the invocation.** The grant
line `agent-authority: release` in `.harness-version` is a different instrument: it
decides the exit for a no-flag run that reaches phase 5 with nobody answering, and it
gates `/hotfix` and `/rollback`. `--ship` neither reads it nor writes it. `/release`'s
`## Authority` section accepts three forms, a grant, a user asking in this turn, and
`--ship` in the invocation of the `/feature` run that chained there; the flag is the third.

**The chained `/release` does not re-ask.** Its step 4 blast-radius question is skipped
under the flag, on the same grounds `--quick` skips it: there is nobody to ask a second
time, and standing down there would make the flag worthless for the case it exists for.
Its step 3 blast-radius report is still produced, still reported, and still recorded in
the feature context, because a release nobody was asked about must still be one somebody
can read afterwards. Its bump proposal stands, as under `--quick`.

### What `--ship` still stops for

**Floor.** `--ship` still stands down. It removes gates, never blocks.

**A gate asks "shall I continue?" A block asks "which way?"** `--ship` answers the first
permanently and in advance. It answers the second never, because you cannot pre-answer a
question nobody has asked yet. These still stop, and standing down is the answer to each:

- A merge conflict with two incompatible intents in one hunk.
- A red check whose cause cannot be established. Being unable to fix it is not the same as
  being unable to explain it, and the second is the block.
- A review finding that is architecturally significant rather than local.
- Any design decision arising mid-build that was not settled beforehand.

**A grill break-out is the fourth case, reached earlier.** `/grilling` breaks out of
autonomy for a decision that is genuinely the user's, and under `--ship` there is nobody to
break out to. Stand down there exactly as mid-build, and do not answer it because the run
is supposed to be fast.

**A gate `--ship` would answer `park` or `drop` is a block, not a verdict.** Dropping the
change somebody asked for is a "which way?" question. Stand down and let a person answer
it.

**What `--ship` never skips**: the full check, and green as a precondition for the exit;
the regression test for a bug fix; Capture, the key and the work item, which are the
audit trail and what `/release` closes by key; the plan written into the work item before
any code, whatever the tier; the blast-radius report; and the stand-down path in full,
the four records and the reply block alike (`SKILL.md`, "Standing down").

### Gates under either entry point

Everything a gate *does* still happens. The journey gates keep their verdicts and their
artefacts: the **worth pursuing** verdict still rewrites `## Challenge` and applies the
`pursue` label, the **build it** and why-and-how verdicts are still commented on the work
item, and the S **plan-and-go** verdict is commented there the same way. A resumed session
reads the same tree either way. Only the answerer changed.

**Autopilot brings the user the build verdict; `--ship` answers it.** Under autopilot that
gate is never skipped, because it is the one place the whole settled design is visible in
one piece before it becomes tickets and code, and a person is there to look at it. Under
`--ship` nobody is, so the session answers it and records the verdict as an artefact.

**Autopilot and grill autonomy are two switches, not one.** Autonomy (in `/grilling`)
answers questions *inside* the grill. Autopilot advances phase *gates*. Granting autonomy
mid-grill still brings the user the build verdict. **`--ship` throws both**, because
unattended is a fact about the world rather than a preference about pace, and both
switches answer the same question: who answers. Without grill autonomy, a `--ship` run
carrying no `--quick` would stall on the first round of the grill, which is the opposite of
the point.

Connected: see `CONNECTED.md`, "Gates under `--ship`": the conflict card and the strict
pause are the user's decisions about the specification, and neither entry point answers
them.

Going backwards stays allowed. If the plan gate exposes a hole, return to the grill for
that branch of the tree; neither entry point is a reason to build on a gap.

**Neither switch survives the session.** Record in the feature context which one was
used, so a reader knows why the run carries no approvals. A resumed `/continue` session
never re-arms either: a switch flipped yesterday, or a flag typed yesterday, must not
drive a session started today.

## The gate report under `--ship`

A gate put to a person is reported at both ends (`SKILL.md`, "Gates"). Under `--ship` the
pair collapses to one report, carrying no `ref`, because nothing waits:

    bash .claude/scripts/cockpit.sh report <position> "gate <name> auto-answered: <verdict>" --key="$KEY"

Grill rounds keep their pair: a round is still asked and still answered, and
`/grilling`'s round loop owns that seam. Neither call is made when phase 0's
`cockpit.sh configured` exited non-zero: no cockpit reads them, and each would
cost a turn.

## The size under `--ship`

The session's tier stands, against the rubric in `SKILL.md` ("### Size"), with its one-line
reason recorded on the work item and in the record. It may take S by itself. A tier still
only goes up mid-run. `--quick` forces S as it always does.

## The alert-path probe (phase 0)

An unattended run's stand-down is only as good as its notification. The durable record is
`## Blocked` plus the `blocked` label, but the only thing that reaches a person is the
Board ask, and `ping`, `report` and `post` are three different routes: a ring that landed
says nothing about whether an ask would. Probe the one that matters, read-only, once, and
only when both `BOARD_URL` and `BOARD_TOKEN` are set:

    bash .claude/scripts/cockpit.sh read >/dev/null

`read` is a GET against the same path `post` writes to, with the same credential and the
same three exits, so it is the honest test and it writes nothing.

| What happened | Do |
|---|---|
| It exited 0 | Nothing. A check that passed is not news |
| Neither variable is set | Nothing, and do not run the probe. A repository with no cockpit is a normal repository, not a degraded one, and a line every run teaches a reader to skim past the one run it matters |
| One variable is set, or the probe exited 4 or 5 | One line: a stand-down on this run will leave the record but no alert. **Write the same line into the feature context**, because nobody reads an unattended session's output while it runs, and the person who finds the run stalled tomorrow reads that file |

**Warn; never refuse.** A `--ship` run with no Board is worse off than one with a Board
and still better off than one that never started. Refusing here would make this one flag
fail closed on the subsystem the harness makes fail-soft everywhere else, and it would
contradict the floor rule above.

## Grill autonomy

`--ship` grants grill autonomy from the first round (`/grilling`, "Grill autonomy"): the
session answers each round's questions with its own recommendation, says that it did, and
posts the round on the work item as usual. The why-and-how verdict and the worth pursuing
verdict are then the session's, recorded as artefacts, never `park` or `drop` (above).

## Seams other skills put to the user

Where a phase skill asks the user something of its own, answer it with your own
recommendation and say that you did; never drop the question silently. The seams:

| Skill | The question | Under `--ship` |
|---|---|---|
| `/to-spec` | The seam question at the plan gate | Answered by the session; the choice is recorded in the feature context |
| `/to-tickets` | The granularity quiz | Answered by the session with its own slicing, said so in the closing block |
| `/tdd` | "Confirm with the user" before a seam or a test shape | Confirmed by the session against the `## Brief` and the spec; the test shape is stated in the ticket's check result |
| `/code-review` | Findings that ask for a decision | Local ones are acted on; an architecturally significant one is a block (the floor) |

## Release authority

`--ship` is release authority, and phase 5 takes `/release` by reading
`.claude/skills/release/SKILL.md` and working its steps in order, to the end. Read its
`## Authority` before following the file: the flag is its third form, and it is the only
thing that has to be true for this run to release. Under it, step 4's confirmation is
skipped and step 3's blast-radius report is produced and recorded, as above. The floor
stands: a block on the way stands the session down (`SKILL.md`, "Standing down"), and a
session never reports the feature complete while its work sits unmerged, whatever the
flag said.
