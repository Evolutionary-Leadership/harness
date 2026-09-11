# Harness Context

This project was scaffolded from the
[`evolutionary-leadership/harness`](https://github.com/evolutionary-leadership/harness)
template repo using GitHub's "Use this template" button, then configured
by the one-shot `/setup` skill (variant: **harness-plain**). The template
added automated CI/CD infrastructure (feature branches, auto-merge,
releases), not application code. Understanding what it set up helps you
work with it instead of against it.

The template content is authored elsewhere and synced into this template
repo on every harness release. You never need to read the authoring repo:
everything an upgrade uses is published here, at a tag per release.

## Architecture

### Branch naming drives everything

```
claude/<codename>-<sessionId>  ← you work here (random codename)
       ↓ first push: slug commit from set-feature-name.sh, or any code push
       ↓ (GitHub Action)
feature/<name>                 ← created automatically from preprod
       ↓ (/to-preprod)
preprod                        ← PR auto-merged
```

- The session branch starts with a random codename
  (`claude/<adjective-scientist>-<id>`). To get a meaningful name, Claude
  runs `bash .claude/scripts/set-feature-name.sh <slug>` as its first
  action; it writes `.harness-feature` and pushes.
- The feature name is resolved as: use the slug in `.harness-feature` if
  present and valid, otherwise fall back to the codename (the `claude/`
  prefix and `-<sessionId>` suffix stripped). See "Feature naming" below.
- Pushing to a `claude/` branch triggers the Action that creates/updates
  the corresponding `feature/<name>` branch.

### Feature naming

Feature branches are named after the work, not the random session codename.
The mechanism:

- **Source of truth:** a committed file `.harness-feature` holding a
  kebab-case slug. Claude sets it early via
  `bash .claude/scripts/set-feature-name.sh <slug>`, which sanitizes the
  input, writes the file, commits, and pushes.
- **Resolution (everywhere):** use the slug if `.harness-feature` is
  present and valid (`^[a-z0-9][a-z0-9-]{0,40}$`, and not `preprod` or `main`),
  otherwise fall back to the codename. The shared resolver is
  `.claude/scripts/resolve-feature-name.sh`; the workflows
  (`claude-to-feature-branch.yml`, `claude-to-preprod.yml`) apply the
  identical check.
- **Set it before the first push** so the feature branch is created with the
  good name from the start.
- **Graceful fallback:** if `set-feature-name.sh` is never called, the first
  code push still creates `feature/<codename>`. Naming is an improvement,
  never a requirement.
- **No leak to preprod:** `.harness-feature` is removed by the to-preprod workflow
  before the merge, so a future session cloned from preprod never inherits a
  stale name. For this reason it must stay out of `.gitignore` (the
  workflows read it from the commit).

**Where do I look for X:**

| What | Where |
|------|-------|
| Provisioning trigger | A `claude/` push (the slug commit, or first code push) |
| Feature branch | `feature/<name>` |
| CI checks | Only on the PR to `preprod`/`main` |
| Current feature name | `bash .claude/scripts/resolve-feature-name.sh` |

### Signal files

- **`.pr-description.md`**: Committing this file to the repo root triggers
  the GitHub Action to create a PR from `feature/<name>` → `preprod` and
  auto-merge it. The `/to-preprod` skill writes this file for you. If the
  frontmatter contains `review: true`, the PR is created but NOT auto-merged
  (used by the `/review` skill). If `hotfix: true`, the hotfix workflow
  handles it instead.
- **`.release-description.md`**: Committing this file triggers the release
  workflow to create a PR from `preprod` → `main`, tag a version, and create a
  GitHub Release. The `/release` skill writes this file.
- **`.harness-feature`**: A committed one-line kebab-case slug naming this
  feature, written by `set-feature-name.sh`. The workflows and shell
  scripts resolve the feature name from it (with a codename fallback). It
  is removed before the merge to preprod (by `claude-to-preprod.yml`) so the name
  never leaks onto preprod and into the next session. Unlike the other signal
  files it must stay tracked (not in `.gitignore`), because the workflows
  read it from the commit.

### `.harness-version` configuration

The `.harness-version` file supports these fields:

```yaml
harness: harness-plain
version: 0.7.7
repo: Evolutionary-Leadership/harness
check: node scripts/check-docs.mjs && npm test && npm run lint
reviewers: teammate1, teammate2
spec_product: myproduct
change-prefix: MYPR
gate-mode: evaluate
```

- **`harness`**: variant identifier, written by `/setup` on first run
  (`harness-plain` or `harness-railway`).
- **`version`**: harness version installed; used by `/harness-upgrade` to
  diff against the latest release.
- **`repo`**: the published harness template repo
  (`Evolutionary-Leadership/harness`), which `/harness-upgrade` reads. Each
  release is a tag there holding the exact tree a scaffold receives, so an
  upgrade compares your repo against a real tree rather than replaying a
  list of changes. It is public: upgrades need no credentials.
- **`check`**: CI command to run on PRs to preprod. Keep
  `node scripts/check-docs.mjs` at the front of the chain so documentation
  drift fails the merge gate like any other error. When configured, the
  `feature-branch-checks.yml` workflow runs this command (also on every
  push to a `claude/**` branch, for feedback before the merge PR exists),
  and to-preprod polls the run's conclusion on the PR head, merging only on
  success. The check chain must finish within the gate's 12-minute budget.
- **`reviewers`**: Default reviewers assigned when using `/review`.

### The spec loop's three keys

All three are absent from a fresh scaffold, and the loop is asleep while
`spec_product` is. See `.claude/SPEC-LOOP.md` for the whole
mechanism; this is what the file holds and what each key switches.

- **`spec_product`**: the Spec Universe product slug this repository's
  specification lives under, and the switch for the whole loop. Absent or
  blank, `check:spec` prints one line, `spec loop not connected`, and exits 0
  before it reads a credential or walks the tree, and every spec section of
  every skill is skipped: `/code-review`'s Spec axis falls back to the
  tracker's spec issue, `/to-spec` writes a spec issue rather than proposals,
  and `/feature` neither captures a change key nor retrieves. Naming a product
  wakes all of it at once.
- **`change-prefix`**: the registry-issued prefix every change key of this
  repository carries (`MYPR-7`, never `MYPR-007`, never a padded form). It is
  a cached copy of an immutable fact: a prefix is issued once and never
  released, because the keys minted under it exist forever, and a copy of a
  value that cannot change is a cache rather than a second authority. It is
  verified against the registry once, when the line is written, and never
  again. Reading it live instead would put a registry credential in every
  repository that mints a key, and would fail a Capture on a registry outage.
  **Unlike the other two, this key is not switched by `spec_product`**: every
  `/feature` mints a change key and opens a work item, connected or not,
  because the work item is where the journey's first artefacts live
  (`.claude/JOURNEY.md`). A repository without a `change-prefix:` line cannot
  start a feature; `/feature` phase 0 stops and says which line to add.
- **`gate-mode`**: how the preprod gate treats drift, `evaluate` or `enforce`.
  **An absent key reads `evaluate`**, which is the shipped default and not an
  oversight: a scaffold has no recorded conformance yet, so every baseline
  reads `pending` and `enforce` would block nothing, while `evaluate` still
  writes the ledger the decision to enforce is later made from. Both modes
  compute identical rows and print identical words; `evaluate` adds one line
  saying the merge proceeded. Only drift the branch INTRODUCED is ever a
  blocking row. A feature context may TIGHTEN this to `enforce` for one branch
  and may never loosen it, because a branch that can switch off the gate it is
  failing is not a gate. Two things ignore the mode and stop in both: a
  proposal on a `legal` or `contractual` node accepted by an identity that is
  not a `user`, and a specification that could not be read.

**There is no `spec_url`, and there never will be.** The base URL travels with
the credential, as `SPEC_UNIVERSE_URL` beside `SPEC_UNIVERSE_TOKEN` in the
environment, so a session and a CI job are configured identically and no
checked-in file names a host. `feature-branch-checks.yml` passes both from
repository secrets to the check step unconditionally; an unset secret is an
empty string, which a dormant checker never reads. The three faults those two
variables can produce are told apart by what fixes each: an unset variable and
a refused token are configuration faults and say so, and only a genuine failure
to read reports an outage.

**Prerequisites for CI checks:**
- None: the merge gate polls the check run directly, so it works without
  branch protection (unavailable on private free-plan repos, where
  auto-merge would silently degrade to an immediate merge)
- Optionally add a branch protection rule for `main` with required status
  checks to gate releases and hotfixes

### Hooks

- **SessionStart**: Runs `.claude/scripts/session-start.sh` on every new
  session. On a `claude/` branch, it resolves the feature name and, if a
  matching `feature/<name>` branch already exists, merges previous work. It
  no longer pushes an init commit: a fresh session just prints naming
  guidance (skipped while the one-shot `/setup` skill is still present,
  since the only sane first move then is `/setup`, which pushes to `preprod`,
  never to this branch). The feature branch is created on Claude's first
  push, ideally
  the `set-feature-name.sh` slug commit (see "Feature naming"). You do not
  need `/feature` to start; just describe what you want to build and Claude
  names the session before its first push.
- **PreToolUse (Write/Edit/Bash)**: Runs
  `.claude/hooks/prevent-em-dash.sh`, which blocks any write that contains
  a U+2014 em dash.

## The feature flow

### The three-rung ladder

Every session starts by stating its flavor explicitly (the opening
question in `/getting-started`):

| Rung | Skill | Writes to |
|---|---|---|
| Talk | `/chat` | nothing |
| Think | `/brainstorm` | the tracker only (an idea issue, if kept) |
| Build | `/feature` | the repo, through five gated phases |

`/brainstorm` runs the same interview engine as `/feature` phase 1
(`/grilling` plus `/domain-modeling`) and ends by asking where the
thinking lands: nowhere, an idea issue, or straight into `/feature`.
`/feature #<issue>` consumes an idea issue and grills only the remaining
frontier. All tracker conventions live in `docs/agents/issue-tracker.md`.

Every `/feature` is also a change on the journey the Product Cockpit draws:
twelve states alternating with eleven transitions, from `captured` to
`evaluated`. `.claude/JOURNEY.md` is the one home for what each position
means in harness terms (which skill, which artefact, when a transition is
ready and done, what blocked means), and `/feature` writes the position it is
at into the touched-set record as it moves, so a person or the cockpit can see
where a feature is without inferring it.

### The feature context

`.harness/feature-context/<feature-slug>.md`, committed on the feature
branch, is the feature's memory across sessions and colleagues: colleague
A stops mid-feature, colleague B runs `/continue` the next day and lands
mid-flow with the reasoning intact. It exists to serve `/continue` and to
be the current summary of the feature at any point in time; it is not
application documentation, which lives in `docs/` (the docs standard owns
it after the merge).

**Format.** One file per feature slug (so concurrent features never
collide), rewritten in place, never an append-only log. Length is fine;
staleness is not. Sections:

- **Phase and next step**: where the flow stands and the single explicit
  next action.
- **Decisions settled**: each with the reasoning and the rejected
  alternatives. Mark one-way decisions; write "ADR to follow", never an
  `ADR NNNN` number before that ADR file exists (the docs checker
  validates ADR references it can see).
- **Open frontier**: the questions still unanswered.
- **Out of scope**: the boundary the grill settled.
- **Tracker**: spec issue, ticket issues and their state, the idea issue
  if one started this.
- **Exit route**: `/to-preprod`, `/review` or `/release`, once chosen;
  "awaiting human review" while a `/review` PR is open.
- **Autonomy granted**: whether grill autonomy or phase autopilot was used,
  so a reader knows why a phase carries no approvals. It is a record, not a
  setting: a resumed session never re-arms either.
- **The change**: the change key and its work item, the challenge verdict
  from phase 1a and the build verdict from phase 1d, each with its reasoning.
- **Blocked**: present only while a session has stood down on something it
  could not get past: what blocks, since when, and what would unblock it.
  Rewritten, never appended; deleted when the block clears, together with the
  `blocked` label on the work item (`.claude/JOURNEY.md`, "Blocked").

Where the spec loop is connected (`spec_product:` above), the same file also
carries, and a dormant repository carries none of them:

- **The change view**: the Spec Universe change view, beside the key and the
  work item every repository records.
- **Retrieved specification**: the block `/feature` phase 1 wrote, holding the
  three to six nodes the change's own words reached, with the read timestamp,
  the terms and each node's version. It is INTERVIEW CONTEXT and never the
  text a write is built from: `/to-spec` re-reads live the node it is about to
  propose against, because this block ages while the specification moves. It
  is scoped to one feature and dies with this file at the merge, which is what
  keeps it from becoming a second copy of the specification. A run that could
  not read Spec Universe records the client's fault here by its code, so an
  interview that proceeded blind says so rather than looking like one that
  found nothing.
- **Conflict decisions**: every conflict card answered, with the option taken
  (amend, retire, conform) and the reason; and a **strict pause waiting** line
  while an amendment on a legal or contractual node waits for a person to
  accept it in Spec Universe.
- **Spec verdicts**, then **Suspect rows**, then **Tier disagreements**: the
  three sections `/code-review` wrote, in that order and no other. The first
  is the fixed six-column table `/to-preprod` gates on and copies into the PR
  body. The second holds `drifted` verdicts that showed no concrete input and
  wrong result, which gate nothing and are never claimed, and travels into the
  PR body because this file is deleted at the merge. The third is calibration
  and nothing parses it. **The order is load bearing**: the gate's parser
  stops at the next heading and faults on a fourth verdict, so a suspect row
  above or inside the verdict table makes every gate run report a malformed
  table.

Link issues by `#number` or URL; never use relative markdown links in
this file.

**Lifecycle.** `/feature` phase 0 creates it. Any agent that finishes
work on the feature refreshes it whenever the result changes what a fresh
reader would need (a decision settled, a ticket landed, direction
changed). Commits are cheap and continuous; pushes ride along with pushes
already happening, plus a mandatory push at every phase gate and at
session end (only the pushed copy survives the container). Commit a pure
context refresh (a commit touching only this file) with the message
prefix `chore(context):`; the harness workflows use both signals to skip
busywork, and pushes that touch only this file skip the CI checks
(`feature-branch-checks.yml` ignores the path). At merge time
`/to-preprod` uses it to draft the PR
description, promotes anything permanent into `docs/`, and deletes it: it
never reaches `preprod`. If a merge bypasses `/to-preprod` (the GitHub merge
button), `feature-merge-cleanup.yml` removes the leftover from preprod, and
`/continue` and `/to-preprod` also sweep strays as a safety net.

### The touched set

`features/<feature-slug>.md` on the `coordination` branch is what this
feature declares it is going to touch. It is the feature context's opposite
half: the context is this feature's reasoning, private to the branch and
deleted at the merge; the touched set is a handful of facts, public to every
other session in the repository from phase 0, so a parallel feature sees a
collision before the merge rather than at it.

**A declaration, never a mirror of the diff.** What a branch has already
changed is derivable from GitHub (compare `preprod` against the feature
branch), and the coordination branch never keeps a second copy of something
GitHub owns. What does not exist anywhere else is what a branch says it is
*about to* touch, which is also the only half a branch that has pushed
nothing can offer.

**Format.** Front matter and no body, the shape `claims/adr/NNNN.md` already
uses. `.claude/scripts/touched-set.mjs` composes it, reads it back and
computes the overlap.

| Field | Holds |
|---|---|
| `slug` | The feature slug, which is also the filename |
| `branch` | `feature/<slug>`, the handle a reader acts on |
| `key` | The change key, unpadded, where the repository mints one |
| `author` | Provenance, the same field a claim carries |
| `declared_at`, `updated_at` | ISO 8601 UTC. The pair is how stale a declaration is |
| `spec` | The `spec_product`, or the literal `none` |
| `phase` | The journey position the feature is at, one of the 23 keys `touched-set.mjs` lists, spelled as the Product Cockpit's lifecycle spells them. A state key means that state's artefact exists; a transition key means a session is working on it. Written at phase 0 as `captured` and at every phase boundary after, twice per transition (`.claude/JOURNEY.md`). The record only ever carries the front half, through `built`: it dies at the merge, and from `verified` on the evidence is on GitHub |
| `paths` | Repository-relative paths or prefixes. A `**` tail is compared by its literal segments |
| `nodes` | Specification node slugs, or the single `none`. Only where `spec` names a product |

**Two halves, and one of them is dormant.** `paths` is written by every
repository, because two sessions collide over files whether or not a
specification is connected. `nodes` is written only where `.harness-version`
names a `spec_product`. The absence is declared and never silent (`spec:
none`, and a connected change touching no node writes the single node
`none`), which is the rule `Spec: support` already applies to anchors.

**The beat is the feature context's beat.** `/feature` phase 0 declares it
once the branch is named; every refresh of the feature context refreshes it;
every phase boundary refreshes it with `--phase`; phase 5 reports the overlap
again with the diff in hand. `updated_at` moving is therefore also the signal
that a session is working: a reader (the cockpit above all) treats a record
older than four working hours as no longer in progress, and shows the change
back at the last state it completed. That fallback is deliberate, and it is
why there is no `blocked_since` field: a stalled session must not keep
claiming a transition it is not working on. Writing on every
push instead would buy a mirror, which is the thing this is not. The reason
is not the one `feature-branch-checks.yml` gives for rationing context
pushes: no workflow triggers on `coordination` at all, so a write here costs
one API call and no CI.

**One writer per file, which is why there is one file per feature.** Nothing
here needs the compare-and-swap `claims/` needs. Writes go through the
contents API with the sha, because they are updates by the file's owner.

**It dies at the merge.** `/to-preprod` deletes the record in the step that
retires the feature context. After that the code is on `preprod` and GitHub
owns it, so keeping the record would be the second copy the branch forbids. A
record whose branch is gone from the remote **and** which has not been
touched in a day has no writer left, so the next reader sweeps it; that is
the same rule `claims/adr` uses before it releases a number, and it is what
covers a merge that went around `/to-preprod`. The day is not caution for its
own sake: phase 0 writes the record before `feature/<slug>` exists, because
the branch is created by a workflow moments after the naming push, and
without the guard the first reader through that window would sweep the record
of a branch that has pushed nothing, which is the exact case this exists for.

**Nothing here blocks anything.** An overlap is reported to a person, in the
closing block and in the feature context, and never to a gate. A missing
branch, a dead network, an absent tool or a malformed record is one warning
line and the flow continues. This is deliberately not the change-key mint's
fail-closed rule: a guessed key welds two changes together forever, while an
unwritten touched set costs one advisory warning.

### The gate run record

`.harness/gate-runs/<KEY>-<n>.json` is the opposite of the feature context and
the one thing under `.harness/` that MUST reach `preprod`. `/to-preprod`
writes one file per gate run (`scripts/gate-run.mjs`) holding the mode and
where it came from, the head sha and merge base, rows by verdict, the drifted
rows split into new, known and pending, the blocking rows with their reasons,
the outcome, and a `dispositionUrl` pointing at the work-item comment where a
person writes `true-drift` or `false-drift`.

It exists to make one number: after ten features, the rate at which the gate
would have stopped a merge that should have merged, which is what the decision
to run `gate-mode: enforce` is made from. So it is committed, never
gitignored, and never deleted at the merge. A ledger that dies at the merge is
not a ledger. A dormant repository never has one.

`.harness/spec-coverage.json`, by contrast, is derived from the tree and a
live read, so it belongs in `.gitignore`: a committed copy would be the second
copy the anchor convention exists to prevent.

### The closing block

Every reply a session gives the user ends with one closing block: the same
three sections in the same order, whichever skill is running and whether or
not one is. The contract is defined in
`.claude/skills/getting-started/SKILL.md`, which the session start hook
forces every session to read. It is not repeated here, because a second copy
is the thing that drifts.

### The two reviews

- **`/code-review` reviews code**: two axes (Standards, Spec) in parallel
  sub-agents, run automatically at the end of `/feature` phase 4.
- **`/review` requests humans**: opens a non-auto-merged PR carrying the
  `/code-review` findings and the spec link. Approved `/review` PRs land
  via `/to-preprod` (which reuses the open PR), never the GitHub merge
  button.

`/feature` phase 5 always asks which exit the user wants, suggesting
`/review` when `.harness-version` configures `reviewers:` and `/to-preprod`
otherwise.

### The variants differ only in the Railway steps

The skill catalog is the same across the two variants. Seven flow skills
(`continue`, `feature`, `getting-started`, `hotfix`, `release`,
`review`, `status`) carry a Railway override whose delta is limited to
preview-URL and environment mentions; `feature/SKILL.md` may differ only
in the Railway-specific steps of phase 0 (provisioning note) and phase 5
(preview-URL reporting). Any other difference between the variants'
skills is a bug; report it upstream rather than working around it.

## How an upgrade decides what to change

`/harness-upgrade` compares two real trees: the tag for the version you
are moving to, and your repository. It does not replay a list of changes,
which is why it stays correct even when you have edited a managed file by
hand, and why asking for a specific version gives you exactly that
version's content.

Every path falls into one of three classes, decided by the path itself:

- **Managed**: replaced with the new version's content. Workflows, hooks,
  skills, agents and the harness scripts.
- **Write-once**: created only when missing, evaluated per file. Your
  `server.js`, `package.json`, `.gitignore`, `docs/` and `scripts/` are
  yours once they exist. They are never overwritten, and never recreated
  if you delete them.
- **Never written**: one-shot setup and bootstrap machinery, plus this
  template repo's own `README.md`. Restoring the setup spine would leave
  it armed in a repo that must never run it again, and the template's
  README is not your project's README. `LICENSE` and `NOTICE` are
  write-once instead, so a project that never received them still can.

Files the harness has retired can be removed, but only inside directories
the harness owns outright, and only after you confirm.

The upgrade reads only public data and needs no credentials.

## Harness-managed files

These files are maintained by the harness and replaced on
`/harness-upgrade`. Do not edit them; your changes will be overwritten.

| File | Purpose |
|------|---------|
| `.github/workflows/harness-bootstrap.yml` | Guarantees the three branches (`main`, `preprod`, and the orphan `coordination`). Idempotent; dispatch it if a branch goes missing |
| `.github/workflows/claude-to-feature-branch.yml` | Merges `claude/` branches into `feature/` branches |
| `.github/workflows/claude-to-preprod.yml` | Creates PR from `feature/` to `preprod` and auto-merges (or opens for review) |
| `.github/workflows/feature-branch-checks.yml` | Runs CI checks on PRs to preprod (reads `check:` from `.harness-version`) |
| `.github/workflows/release.yml` | Creates release PR preprod → main, tags version, creates GitHub Release |
| `.github/workflows/hotfix.yml` | Handles hotfix PRs to main, tags patch release, back-merges to preprod |
| `.github/workflows/feature-merge-cleanup.yml` | Deletes feature branch after merge to preprod, and removes a leftover feature-context file if the merge bypassed `/to-preprod` |
| `.claude/scripts/session-start.sh` | Session startup hook |
| `.claude/scripts/list-skills.sh` | Skill discovery script |
| `.claude/scripts/resolve-feature-name.sh` | Resolves the feature name (slug from `.harness-feature`, else session codename); shared by the hooks, scripts, and workflows |
| `.claude/scripts/set-feature-name.sh` | Names the session's feature: sanitizes a slug, writes `.harness-feature`, commits, and pushes to trigger branch creation |
| `.claude/SPEC-LOOP.md` | The spec loop: how to connect it, the anchor grammar, the judge, the gate, the claim flow, and which file owns each mechanism. Read it only once `spec_product` is set |
| `.claude/JOURNEY.md` | The journey: the twelve states and eleven transitions the Product Cockpit draws, what each means in harness terms (skill, artefact, ready, done, how it is seen), the gate verdicts, what blocked means, and the `phase` write recipe. Read from `/feature`, `/continue` and `/to-preprod` |
| `.claude/scripts/board.sh` | The one Board client for the Product Cockpit: posts the stand-down ask the journey defines (marker `blocked`) and reads the board, with `BOARD_URL` and `BOARD_TOKEN`, failing with the same three exits as `spec-universe.sh`. Never carries a position |
| `.claude/scripts/coordination.sh` | Reads the `coordination` branch: the claimed ADR numbers, the in-flight touched sets, and the live feature branches. Every read is best-effort and exits 0 |
| `.claude/scripts/touched-set.mjs` | The touched-set record: composes it, reads it back, and computes the overlap between two in-flight features. Advisory; nothing it returns is an exit code |
| `.claude/scripts/spec-universe.sh` | The one `/v1` client every skill shares for Spec Universe: reads, proposes, patches, claims and promotes with `SPEC_UNIVERSE_URL` and `SPEC_UNIVERSE_TOKEN`, fails closed with three distinguishable exits, and offers no generic pass-through. Inert while `spec_product` is unset |
| `scripts/check-spec.mjs`, `gate-run.mjs`, `judge-plan.mjs`, `retrieval.mjs`, `spec-test-claims.mjs` | The spec loop: the anchor gate, the preprod gate, the judge, the interview's retrieval, and the test-basis claims. Managed rather than write-once, unlike everything else under `scripts/`, so a fix reaches you. All five are inert while `spec_product` is unset |
| `.claude/skills/code-review/judge-prompt.md` | The Spec axis judge's brief, below its horizontal rule sent verbatim. Managed on purpose: the shape was measured, and a brief that drifts silently changes every verdict downstream |
| `.claude/skills/feature/CONFLICT-PROTOCOL.md` | The conflict card, the A/B/C fork, where a decision is recorded, and the strict pause. Read from `/feature` at any phase and from `/to-spec`'s conflict sweep |
| `.claude/hooks/prevent-em-dash.sh` | Blocks writes containing U+2014 em dashes |
| `.claude/skills/getting-started/SKILL.md` | Orientation skill: the session-opening flavor question, the skill catalog, the two-review pair |
| `.claude/skills/feature/SKILL.md` | `/feature` skill: the five-phase gated flow (name, grill, spec, tickets, implement, hand over) |
| `.claude/skills/brainstorm/SKILL.md` | `/brainstorm` skill: standalone grilling that writes to the tracker only |
| `.claude/skills/to-preprod/SKILL.md` | `/to-preprod` skill: merge to preprod; owns the merge-conflict discipline and retires the feature context |
| `.claude/skills/review/SKILL.md` | `/review` skill: submit PR for team review, with `/code-review` findings in the body |
| `.claude/skills/release/SKILL.md` | `/release` skill: ship preprod to production; from an unmerged `claude/` branch it also runs the merge and waits for `preprod` to settle first |
| `.claude/skills/hotfix/SKILL.md` | `/hotfix` skill: emergency production fix |
| `.claude/skills/status/SKILL.md` | `/status` skill: team dashboard |
| `.claude/skills/changelog/SKILL.md` | `/changelog` skill: generate changelog |
| `.claude/skills/deps/SKILL.md` | `/deps` skill: handle Dependabot PRs |
| `.claude/skills/continue/SKILL.md` | `/continue` skill: resume an in-progress feature via its feature context |
| `.claude/skills/chat/SKILL.md` | `/chat` skill: conversation mode (no file changes) |
| `.claude/skills/endchat/SKILL.md` | `/endchat` skill: clean up the orphan feature branch left behind by `/chat` |
| `.claude/skills/rollback/SKILL.md` | `/rollback` skill: revert bad deploy |
| `.claude/skills/harness-upgrade/SKILL.md` | `/harness-upgrade` skill |
| `.claude/skills/document/SKILL.md` | `/document` skill: scaffold an ADR, audit docs against the diff, route a fact to its one home |
| `.claude/skills/grilling/` | `/grilling` skill: the relentless-interview engine (frontier, design tree) |
| `.claude/skills/domain-modeling/` | `/domain-modeling` skill: glossary and ADR discipline while designing |
| `.claude/skills/to-spec/` | `/to-spec` skill: synthesize the conversation into a spec issue |
| `.claude/skills/to-tickets/` | `/to-tickets` skill: slice a spec into tracer-bullet tickets with blocking edges |
| `.claude/skills/implement/` | `/implement` skill: work the ticket frontier, `/tdd` at agreed seams |
| `.claude/skills/tdd/` | `/tdd` skill: the red-green loop, seams, test anti-patterns |
| `.claude/skills/code-review/` | `/code-review` skill: two-axis (Standards, Spec) agent review of a diff |
| `.claude/skills/diagnosing-bugs/` | `/diagnosing-bugs` skill: feedback-loop-first debugging discipline |
| `.claude/skills/codebase-design/` | `/codebase-design` skill: deep-module vocabulary and design patterns |
| `.claude/skills/writing-for-agents/` | `/writing-for-agents` skill: how to write skills and agent-facing docs |
| `.claude/agents/docs-updater.md` | Documentation auditor agent (runs during `/to-preprod` and `/review`) |
| `.claude/HARNESS.md` | This file |
| `.harness-version` | Version tracking |

## Harness-provided starting points

The harness created these files as a starting point. You own them, so edit
freely to match your project. On `/harness-upgrade`, these are diffed and
you choose whether to accept upstream changes.

| File | What to customize |
|------|-------------------|
| `.claude/settings.json` | Add your own hooks and tool permissions alongside the harness-provided ones |
| `.github/dependabot.yml` | Add entries for your package ecosystems (npm, pip, Docker, etc.) |

The harness ships `.claude/settings.json` with an `env` block that sets
`API_TIMEOUT_MS=900000` and `CLAUDE_CODE_MAX_RETRIES=15` to harden
sessions against stream idle timeouts. Keep these values (or raise them)
when you add your own keys; see "Avoiding stream timeouts" in
`claude-md-snippet.md` for context.

## Documentation standard

The harness scaffolds a documentation layout built for AI readers. Nearly
every reader of this repo's docs is an agent starting a fresh session with
no memory, and `CLAUDE.md` is the only part that loads automatically, on
every session. So the layout minimizes auto-loaded context and pushes
detail into files retrieved on demand.

| Layer | Path | Owns | Budget |
|---|---|---|---|
| Router | `CLAUDE.md` | Conventions, one-way decisions, definition of done, don't-touch list, writing rules, and a map of which doc to read | 300 lines |
| Reference | `docs/architecture/*.md` | Per-subsystem catalogs, each declaring `sources:` globs in YAML front-matter | 400 lines each |
| Rationale | `docs/decisions/NNNN-*.md` | Numbered ADRs, append-only once accepted | no limit |
| Procedure | `docs/runbooks/*.md` | Operations that have bitten someone | no limit |
| Manifest | `docs/README.md` | The index: every doc, what it owns, when to update it | no limit |

Four rules hold it together: one home per fact; code is truth for WHAT and
docs for WHY and WHERE; accepted ADRs are superseded, never rewritten; and
freshness is mechanical, enforced by `scripts/check-docs.mjs`.

Wire the checker into `.harness-version` so broken docs block auto-merge
exactly like a type error:

```
check: node scripts/check-docs.mjs && npm test
```

`/document` writes ADRs, audits the diff against the manifest, and routes a
fact to its owning doc. The `docs-updater` agent runs the same taxonomy
automatically during `/to-preprod` and `/review`.

The rationale for the layout ships as ADR 0001 in `docs/decisions/`.

## Starter scaffold (write-once)

Write-once scaffold files are created once on first install, never
overwritten on `/harness-upgrade`, and never recreated if you delete them.
Skip-if-exists applies **per file**, so a partial `docs/` tree gets only its
missing pieces.

| File | Why write-once |
|---|---|
| `docs/README.md` | Your index. The harness must never clobber your rows |
| `docs/GLOSSARY.md`, `docs/SECURITY.md`, `docs/TESTING.md` | Skeletons you fill in with project facts |
| `docs/architecture/TEMPLATE.md`, `docs/decisions/TEMPLATE.md`, `docs/runbooks/TEMPLATE.md` | Starting points you copy, not files you edit in place |
| `docs/decisions/0001-adopt-the-ai-native-documentation-standard.md` | A record with a date; rewriting it upstream would rewrite your history |
| `scripts/check-docs.mjs` | Zero-dependency checker you may extend with project-specific rules |

Some variants also ship a write-once app scaffold (`server.js`,
`package.json`, `.gitignore`) so the deploy pipeline has something to build
on the first push. **This variant ships none of those.** It has no deploy
target, so a starter app would have nowhere to run.

## Project-owned files

Everything else belongs to the project. The harness does not touch:

- **`CLAUDE.md`**: Your project instructions. The harness provides
  `claude-md-snippet.md` as a starting point; copy what you need.
- **All application code**: Source files, configs, tests, etc.
- **Custom skills**: Any skill you add to `.claude/skills/` that isn't
  listed above.

## How to extend

### Adding a skill

Create `.claude/skills/<name>/SKILL.md` with YAML frontmatter (`name`,
`description`). Custom skills are not touched by `/harness-upgrade`.

### Adding an agent

Create `.claude/agents/<name>.md` with YAML frontmatter (`name`,
`description`, `allowed-tools`). Agents are autonomous specialists that
run in their own context via the Agent tool. Custom agents are not touched
by `/harness-upgrade`.

### Adding workflows

Prefer adding new workflow files in `.github/workflows/` over modifying
harness-managed ones. New files won't be touched by upgrades.

## Variants

This template repo ships one tree; the variant is chosen by the one-shot
`/setup` skill on first run and recorded in `.harness-version`:

| Variant | What you get |
|---------|--------------|
| **`harness-plain`** *(this project)* | Feature branches + auto-merge, no deploy target |
| `harness-railway` | + Railway preview environments per feature with isolated PostgreSQL and S3-compatible bucket |

Switching from `harness-plain` to `harness-railway` after setup is not
an automated migration; it requires re-scaffolding from the template
(answering the Railway question yes this time) and porting your
application code over.

## Upgrading (same variant)

Run `/harness-upgrade` to check for version updates within your current
variant. It shows what changed and why, drawn from the published release
notes, with any breaking items above the confirmation prompt, and then the
exact list of files it would write. Nothing is changed until you approve
it. See `.harness-version` for current version info.

### Version numbering

Harness versions use semver (`MAJOR.MINOR.PATCH`):
- **PATCH** bumps automatically on each feature merge upstream
- **MINOR** bumps are a developer decision for significant releases
- **MAJOR** is reserved for breaking architecture changes

## License

The Harness Companion is licensed under the **Apache License 2.0**.
See the `LICENSE` and `NOTICE` files in the root of this repository.

The NOTICE file must be preserved in any derivative works or forks.
It attributes this project to its origin:
[The Harness Companion](https://www.harnesscompanion.com)
by Evolutionary Leadership Coöperatie U.A.
