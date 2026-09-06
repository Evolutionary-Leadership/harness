# The spec loop

Harness-managed. `/harness-upgrade` overwrites this file, so record your own
project's decisions in `docs/decisions/` and its own facts in
`docs/architecture/`, not here.

Every scaffold ships this loop and every scaffold ships it **asleep**. It
wakes when `.harness-version` names a `spec_product`, and until then
`check:spec` prints one line and exits 0, every spec section of every skill is
skipped, and nothing in this file applies to you.

The loop closes two gaps an ordinary review leaves open. An anchor proves that
a file cites a specification node; it proves nothing about whether the code
does what that node says, or whether a new intent contradicts a node somebody
else is bound by. What follows is how each of those is closed, and which file
owns each mechanism.

## Connecting

Three keys in `.harness-version`, documented field by field in
`.claude/HARNESS.md`:

| Key | Holds |
|---|---|
| `spec_product` | The Spec Universe product slug. **The switch for everything below** |
| `change-prefix` | The registry-issued prefix every change key carries (`MYPR-7`, unpadded) |
| `gate-mode` | `evaluate` or `enforce`. An absent key reads `evaluate` |

Two variables in the environment, and no fourth key: `SPEC_UNIVERSE_URL` and
`SPEC_UNIVERSE_TOKEN`. The base URL travels with the credential rather than
sitting in a checked-in file, so a session and a CI job are configured
identically and nothing in the repository names a host.
`feature-branch-checks.yml` passes both from repository secrets to the check
step unconditionally.

Then put `node scripts/check-spec.mjs` on the `check:` line, and start
anchoring.

## Anchors are citations

The specification lives in Spec Universe. It does not live in your repository,
and no part of it is copied there.

An **anchor** is a citation of a node, by id, in a `Spec:` line. That is the
whole mechanism. Anchors carry ids and never spec text, so the specification
keeps exactly one home and cannot drift into a second copy nobody remembers to
update.

Every file under the domain roots carries a `Spec:` line in its leading
comment block. There is no third option: a file either names the nodes it
serves or declares `Spec: support`.

| Form | Means |
|---|---|
| `Spec: system-entry` | This file serves that capability |
| `Spec: http-api, fr-14` | A capability or interface, plus the requirements it carries as point rules |
| `Spec: support` | This file serves no node: glue, wiring, a test helper |

`Spec: support` is a **claim**, not an absence. It is why a file with no
`Spec:` line at all is an error: silence must always mean "not yet annotated"
and never "deliberately unanchored". The checker prints the support files with
a count, so a support list that keeps growing is visible as the smell it is.

### The grammar

A `Spec:` line must sit behind a comment marker (`*`, `//`, `/*`, `/**`, `#`),
so a string literal containing the word can never be mistaken for one. The
value is either the literal `support` or a comma-separated list of node local
slugs.

A local slug is lowercase, starts with a letter, and contains only letters,
digits and hyphens: `overview`, `system-entry`, `http-api`, and requirements
in the unpadded form `fr-12`.

An anchor may carry **one criterion suffix**, in the `ac-N` form the product
mints its acceptance criteria in: `fr-14/ac-3`. It is a **criterion anchor**:
this file proves that one criterion, and it anchors the node as well. A bare
`fr-14` keeps meaning the whole node. Several criteria of one node are several
anchors, and a bare anchor and a criterion anchor of the same node may share a
line, because they are different claims.

| Refused | Why |
|---|---|
| `Spec:` with nothing after it | The line names nothing |
| `Spec: FR-12` | Anchors are lowercase |
| `Spec: fr-01` | Zero padding is not the form Spec Universe mints |
| `Spec: fr-14/ac-03` | A criterion id is unpadded too |
| `Spec: fr-14/x`, `fr-14/ac-1/ac-2`, `fr-14/` | The suffix is exactly one `ac-N`, or nothing |
| `Spec: fr-14/ac-9` where `fr-14` holds `ac-1` to `ac-5` | Unresolved, naming the criteria the node holds |
| `Spec: support, fr-1` | `support` is a whole answer and cannot be combined |
| `Spec: fr-1,,fr-2` | An empty entry left by a stray comma |

The first `Spec:` line in a file is the file-level anchor. Later lines are
symbol-level and sit in the symbol's own doc comment; they are additive to the
file's, never a replacement. Use them where one line per file is too coarse: a
route file holding two handlers that serve different requirements, or a module
whose exports are each fixed word for word by a different rule.

### What the checker enforces

| Level | Code | Fires when |
|---|---|---|
| ERROR | `spec-line-unparsable` | A `Spec:` line does not parse |
| ERROR | `anchor-unresolved` | An anchor names no node of this product, or a criterion its node does not hold |
| ERROR | `requirement-uncovered` | A requirement at status `live` is anchored nowhere |
| ERROR | `file-unanchored` | A domain file carries no `Spec:` line |
| ERROR | `spec-unreachable` | Spec Universe could not be read |
| ERROR | `missing-credential` | A credential is unset or blank |
| ERROR | `rejected-credential` | A credential is set but Spec Universe answers 401 or 403 |
| WARN | `prose-dangling` | A prose `fr-N` mention resolves to no node |

Coverage keys on **status, not on ambition**. A requirement at status `live`
with no anchor is an error. A requirement at status `planned` is the build
backlog: printed, never an error, and the honest reading of "specified and not
yet claimed". Planned requirements that already carry an anchor are listed
separately, as built work awaiting a status flip.

**The tree constants are the first thing to adapt.** `DOMAIN_ROOTS` (which
directories must anchor), `PROSE_ROOTS` (which are scanned for dangling
mentions), `SKIP_PATHS` (generated or immutable directories the checker never
reads) and `PROSE_EXEMPT` at the top of `scripts/check-spec.mjs` describe a
tree, and the shipped values describe the project the loop was proven in. Set
them to yours before you turn the checker on. They are the only part of these
scripts you are expected to edit, and an upgrade will overwrite your edit, so
record it where your project records decisions.

### Coverage per criterion

For every requirement carrying acceptance criteria, the checker says which
have at least one criterion anchor behind them and which are **bare**. It is
reported, never enforced: a bare criterion changes no exit code.

| Where | What |
|---|---|
| stdout, every normal run (`--quiet` suppresses it) | One line per requirement, under a total |
| `.harness/spec-coverage.json`, or `--coverage-out=<path>` | `{ product, writtenAt, requirements: [{ slug, name, status, criteria: [{ id, files }] }] }` |

The artifact is written **before** the report, on every run that reaches
evaluation, red or green: the release step reads it from a worktree at the
release commit, and that worktree's run may be red for reasons that are not
this gate's business. Gitignore it. It is derived from the tree and a live
read, and a committed copy would be the second copy the anchor convention
exists to prevent. The path is a contract the release step reads.

## Fail closed, and the two red gates told apart

**If the specification cannot be read, the check errors.** It does not warn,
skip, or pass. A check that goes green when it cannot see the specification is
worse than no check at all, because it turns an unverified build into a
verified-looking one.

That leaves three ways to go red without a code fault, and they have different
fixes, so they never share copy:

| Cause | Reported as | Fix |
|---|---|---|
| A variable is unset or blank | `missing-credential`, naming the variable | Set it. A configuration fault |
| The token is set but refused (401, 403) | `rejected-credential`, naming the token and the status | Replace the token. Also a configuration fault, not an outage |
| The read failed: network, non-2xx, unparsable body, or no answer within 20s | `spec-unreachable`, with exactly `The specification cannot be read, so nothing can be validated against it.` | Wait, or check Spec Universe. An outage |

A hang counts as an outage: the read is bounded, so a silent Spec Universe
fails the gate with that sentence instead of running CI to its job limit.

**A configuration fault must never wear the outage sentence.** It is the
difference between a reader setting a variable and a reader waiting for an
outage that is not happening.

Accepting all this means a Spec Universe outage turns your build red,
including the merge gate. That is the cost, and it is the deliberate one.

## The shared client

Every skill call to Spec Universe goes through
`.claude/scripts/spec-universe.sh`, so no skill carries its own curl line and
every one fails closed the same way. Its faults are the three above, told
apart by exit code:

| Exit | Code | Means |
|---|---|---|
| 3 | `missing-credential` | A variable is unset or blank; the message names it |
| 4 | `rejected-credential` | Spec Universe answered 401 or 403; replace the token |
| 5 | `spec-unreachable` | Anything else. Prints exactly `spec unreachable, cannot verify`, and the skill stops |

There is no generic pass-through. A call the client cannot make is a command
to add to it, with a test.

**The write dialect is not what the MCP tool schema implies**, and the client
refuses the wrong spellings before sending:

| Key | `/v1` takes | The MCP schema implies |
|---|---|---|
| the node | `node` | `node_id` |
| the change | `changeId` | `change_id` |
| its work item | `changeUrl` | `change_url` |

Three properties of the endpoint that bite silently, which is why the client
guards rather than trusts:

- **A PATCH replaces `fields`, it does not merge into them.** Patching a
  proposal to add one field drops every field already on it. Send the whole
  set every time. A patch that omits `fields` leaves them alone.
- **`state` and `fields` cannot travel in one PATCH.** Together they answer
  400, so accepting a proposal and editing it are two calls.
- **An unrecognised key is accepted and DROPPED, not refused.** A body in the
  wrong spelling therefore lands with `changeId` null: a write that reports
  success and leaves a proposal no release can promote.

The claim body is exactly `{value, basis, criterionId?, evidence?}`, and the
same dropping rule applies: a misspelt criterion key does not fail, it
silently widens a per-criterion claim to the whole node.

## The interview retrieves; nothing snapshots

`/feature` phase 1 loads the three to six nodes the change's own words reach.
A whole-product snapshot runs over the tool result cap, so it arrives
truncated and still lacks the node the feature is about, and a truncated
snapshot looks exactly like a snapshot. `scripts/retrieval.mjs` owns every
mechanical part.

| Rule | What it means |
|---|---|
| **Terms are the Capture title and why, verbatim** | Tokenized by the script: stopwords, tokens under three characters and pure numbers dropped. A vocabulary mismatch is answered with `--include=<slug>`, in the open |
| **The ranking is ours** | `/v1` has one proven read of a product's nodes and no search route a repository can verify, and it DROPS an unknown key rather than refusing it. Ordering is by distinct terms matched, then weighted score, then slug, so a rerun is identical |
| **The node list never enters context** | It is redirected to a file; only the selected nodes are rendered. The currency saved is model context, not network bytes |
| **Six seeds, 20,480 bytes, a loud truncation** | Whole seeds in rank order; the first that does not fit ends the set, and every drop is named with the flag that brings it back |
| **Edges listed, bodies on demand** | The judge's rule at interview scale |
| **Interview context, never a write's source** | The block carries `readAt` and each version; `/to-spec` re-reads live the node it proposes against. It dies with the feature context at the merge |
| **A check fails closed, an interview degrades openly** | The three client faults reach the block by code. Only exit 5 carries `spec unreachable, cannot verify` |

The retrieved set does NOT serve the judge, whose implicated set comes from
the diff's anchors and the change's proposals: a fact about the code, not
about how well a paragraph happened to be worded.

## The judge (`/code-review`, Spec axis)

The Spec axis reads Spec Universe, never the tracker. It resolves the diff's
changed files to their anchors on the BASE side (so a deleted file still fans
out), expands capabilities and interfaces to their governing requirements over
`is-governed-by`, and adds the nodes the change's own proposals touch. Where
the change has a proposal on a node, the judge reads the PROPOSED text.

`scripts/judge-plan.mjs` owns every mechanical part, so none is a judgement
made twice.

| Rule | What it means |
|---|---|
| **Compare, never refute** | The judge states what the code does when a criterion's trigger occurs and compares that to the obligation. An adversarial brief rejects correct code 26 to 88 percent of the time; comparison lifts recognition of conforming code from 11 to 85 percent. The brief has ONE home, `.claude/skills/code-review/judge-prompt.md`, and is sent verbatim |
| **One judge per changed-file group** | A node is keyed by the sorted set of changed files that reach it, directly or through a citing capability or interface. Nodes sharing a key are one judge, capped at ten criteria, split on node boundaries. Every node lands in exactly ONE group, so one criterion yields one row and no reconciliation rule exists |
| **Load the diff, read the rest on demand** | A judge loads its group's changed files; every other file anchoring one of its nodes is listed by path and read by the sub-agent itself |
| **Two tiers** | Tier 1 runs every group on `sonnet`; only `drifted` and `suspect` rows are re-run at the default model, and that verdict reaches the table. A MODEL, because the Agent tool exposes no effort knob |

| Verdict | Means | Claimable |
|---|---|---|
| `matched` | The behaviour traced is the behaviour the criterion obliges | yes |
| `drifted` | The code contradicts the criterion, and the row names a concrete input and the wrong result | yes |
| `unverifiable` | The code does not contain the behaviour. Usually a wrong anchor | no |
| `suspect` | A `drifted` verdict that showed neither. A local review state, read by a person, never a claim value | never |

One row per criterion, quoting the spec line, in the fixed shape three later
readers parse: `node | criterion | judged against | verdict | spec line |
where`. A judge returns a seventh `evidence` column, which the evidence rule
reads and the rendered table drops, so "no evidence, no claim" is enforced by
the downgrade and never by the claim body.

**Three sections, in this order:** `## Spec verdicts`, `## Suspect rows`,
`## Tier disagreements`. The order is the mechanism: the gate's parser stops at
the next heading and faults on a fourth verdict, so a suspect row above or
inside the verdict table makes every gate run report a malformed table.

## The preprod gate (`/to-preprod`)

The gate refuses drift **the branch introduced** and nobody decided. It does
not refuse drift that was already recorded: an audit of an existing product
routinely records dozens of drifted criteria at once, and gating on those
stops merges that never touched them. `scripts/gate-run.mjs` owns the
classification and the copy, so the modes cannot diverge in wording.

**Two modes**, `gate-mode:`, an absent key reading `evaluate`. Both compute the
identical rows and print the identical words; `evaluate` merges anyway and
adds one line saying so. A feature context may TIGHTEN the mode to `enforce`
for one branch and may never loosen it, because a branch that can switch off
the gate it is failing is not a gate.

**The baseline is the conformance Spec Universe already records**, read live at
gate time. Nothing new is stored: `/release` refreshes that record at every
release, so it is the state as of the last release.

| Recorded conformance | Baseline | A `drifted` row on it |
|---|---|---|
| `drifted` | `known` | reported, never blocks |
| `matched` | `matched` | new drift, blocks under `enforce` |
| absent, or anything else | `pending` | an absence, not a regression, never blocks |

A row judged against a proposal is always new: the proposed text has no prior
record to have drifted from. New drift is covered, and does not block, by an
`accepted` or `promoted` proposal under the change key on that row's node; a
`draft` proposal, a `declined` one and no proposal at all each block, naming
the one missing piece and one deep link. `unverifiable` rows never block and
travel to the PR body as anchors to repair.

**Two things ignore the mode and stop in both.** A proposal on a node whose
effective strictness is `legal` or `contractual` whose acceptance was not a
person's act, because Spec Universe refuses that acceptance over MCP and
`/v1`: a security control, not drift. And an unreadable specification.

**Every run is recorded**, in `.harness/gate-runs/<KEY>-<n>.json`, which is
COMMITTED and reaches `preprod`. It exists to make one number: after ten
features, the rate at which the gate would have stopped a merge that should
have merged, which is what the decision to run `enforce` is made from. It is
the opposite of the feature context: the context dies at the merge, the ledger
must survive it, or no false-drift rate can ever be computed.

## The claim flow (`/release`)

Claims are written once, from one place: after production is confirmed to
serve the release, either outright or **by equivalence**, which is a release
changing no path the deploy platform watches and so producing no deploy to
wait for. Without that second case a docs-only release polls out and strands
its work item open.

First every change key in the blast radius is **promoted**, so a claim
describes the text that is now current; what the promotion left behind
unaccepted is reported, never swallowed. Then one claim per criterion row,
value from the verdict, basis `source-code` (the judge read the code and ran
nothing), evidence the release PR URL, idempotency key
`release-<version>-<node>-<criterion>`. A `drifted` verdict is claimed drifted
and reported. Branch and preprod results are never claimed: a claim says what
production does.

**Then the second basis, `test`.** The releasing session checks the release
commit out into a temporary worktree, runs `check:spec` there and the project's
suite, and `scripts/spec-test-claims.mjs` intersects the two. Every criterion
with an anchoring test file the run reports **passed** is claimed `matched`,
basis `test`, key `release-<version>-<node>-<criterion>-test` (the suffix keeps
it apart from the source-code claim on the same criterion, so both bases stand
and a disagreement between judge and run is visible rather than voted away). A
failed, skipped or unrun file claims nothing and is listed, because a session
without a database fails an integration tier for want of one, and that is not
drift. The evidence is a comment on the release PR carrying the sha and the
per-file results.

The run report's shape is the contract: `{ testResults: [{ name, status }] }`,
which is what `vitest run --reporter=json --outputFile` writes. A runner that
emits something else is converted to that shape before this step.

The same step closes each change's work item naming the version, so closed
means live means promoted.

## The change key

`<PREFIX>-<n>`. The prefix is `change-prefix:`, a cached copy of an immutable
fact. The number comes from `counters/change-key` on the `coordination`
branch, one bare integer, advanced by a sha-guarded write through the contents
API, created at `1` when absent, retried three times, and **fail closed**: a
key that cannot be minted stops Capture, because a guessed key welds two
changes together.

**Keys are unpadded, like the `fr-N` slugs they follow.** The feature name is
key-first (`mypr-1-<slug>`), so every branch and environment starts with the
key.

## The thin work item

The tracker issue for a change holds the title (`<KEY>: <title>`), the why,
the key, the Spec Universe change view, a short summary, and the tickets as
sub-issues. The specification is the proposals under the key, and nothing
else. `/to-spec` updates it, `/release` closes it, nothing deletes it.

## The conflict protocol

A collision between a feature's intent and an existing node stops the session
at any phase and renders the conflict card: the node's text verbatim, its
effective strictness and the place that binds it, its criticality, its citing
nodes, its bound systems, and the believed collision. Then a forced choice:
**A** amend the node, **B** retire it (a status proposal, never a delete),
**C** conform. The decision is recorded in the feature context, on the work
item, and in the proposal rationale, and binds later phases. On a strict node
under A or B the session pauses and waits for a person to accept on the node's
own page.

The card and the pause are **user decisions**, exempt from phase autopilot and
grill autonomy. `.claude/skills/feature/CONFLICT-PROTOCOL.md` is the one home
for all of it.

## Where each mechanism lives

| File | Owns |
|---|---|
| `scripts/check-spec.mjs` | The anchor grammar, the coverage rules, the dormancy switch, the three faults |
| `scripts/gate-run.mjs` | The gate's two modes, the baseline, the classification, the run record |
| `scripts/judge-plan.mjs` | The judge groups, the cap, the evidence rule, the tier reconciliation, the three renderers |
| `scripts/retrieval.mjs` | The ranking, the ceiling, the seed renderer, the fault copy |
| `scripts/spec-test-claims.mjs` | The intersection of the coverage artifact with a run report |
| `.claude/scripts/spec-universe.sh` | Every `/v1` read and write, and the three exits |
| `.claude/skills/code-review/judge-prompt.md` | The judge's brief, sent verbatim |
| `.claude/skills/feature/CONFLICT-PROTOCOL.md` | The conflict card, the fork, the strict pause |

Each of the five scripts keeps a **pure exported core above its CLI**, so your
own unit tests drive them with in-memory input and need no network, no fixture
tree and no running Spec Universe. Only the CLI section at the foot of each
file reads a file or exits.
