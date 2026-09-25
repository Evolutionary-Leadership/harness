# Harness Context

This project was scaffolded from the
[`evolutionary-leadership/harness`](https://github.com/evolutionary-leadership/harness)
template repo, then configured by the one-shot `/setup` skill (variant:
**harness-railway**). It added CI/CD infrastructure (feature branches,
auto-merge, releases, Railway preview environments with PostgreSQL and
S3-compatible object storage), not application code, and is synced into the
template repo at a tag per release, which is all an upgrade reads.

## Architecture

### Branch naming drives everything

```
claude/<codename>-<sessionId>  ← you work here (random codename)
       ↓ first push: slug commit from set-feature-name.sh, or any code push
       ↓ (GitHub Action)
feature/<name>                 ← created automatically from preprod
       ↓                         + Railway env + Postgres + Bucket, when .harness-feature says preview: yes
       ↓ (/to-preprod)
preprod                        ← PR auto-merged; the Railway env is cleaned up
```

Pushing to a `claude/` branch triggers the Action that creates or updates
the corresponding `feature/<name>` branch, named after the work rather than
the random session codename; a preview environment, when one is provisioned,
takes the same name (Railway has no clean environment rename), which is why
the slug is set before the first push and never renamed later:

- **Source of truth:** a committed file `.harness-feature` whose line 1 is a
  kebab-case slug, set as Claude's first action via
  `bash .claude/scripts/set-feature-name.sh <slug> [--preview=yes|no]`
  (sanitizes, writes, commits, pushes).
- **Resolution (everywhere):** the slug if present and valid
  (`^[a-z0-9][a-z0-9-]{0,40}$`, not `preprod` or `main`), else the codename
  (`claude/` prefix and `-<sessionId>` suffix stripped). The shared resolver
  `.claude/scripts/resolve-feature-name.sh` reads line 1 only; the workflows
  (`claude-to-feature-branch.yml`, `claude-to-preprod.yml`,
  `feature-branch-railway.yml`) apply the identical check.
- **Set it before the first push.** Never set, the first code push still
  creates `feature/<codename>`: naming is an improvement, not a requirement.
- **No leak to preprod:** the to-preprod workflow removes it before the
  merge. It stays out of `.gitignore`: the workflows read it from the commit.

| Where do I look for | Where |
|------|-------|
| The feature branch | `feature/<name>`, created by the first `claude/` push (slug commit or code); the Railway deployment trigger points here |
| Provisioning | `feature-branch-railway.yml`, once, via `workflow_run` off the bridge workflow, only when `.harness-feature` says `preview: yes` |
| Ongoing builds and deploys | The Railway dashboard, the feature's environment (Railway-native, not Actions) |
| Preview URL | `.railway-url` on the `feature/` branch, or `bash .claude/scripts/get-railway-url.sh` |
| CI checks | On every `claude/**` code push and on the PR; the PR run is the gate. Never on the `feature/` branch itself, so a blank check status there is normal |
| Current feature name | `bash .claude/scripts/resolve-feature-name.sh` |

### Signal files

- **`.pr-description.md`**: written by `/to-preprod`, it triggers the Action
  that opens a PR from `feature/<name>` → `preprod` and auto-merges it.
  Frontmatter `review: true` skips the auto-merge (`/review`); on a
  `hotfix/**` branch the same file hands it to the hotfix flow instead.
- **`.release-description.md`**: written by `/release`, it triggers the
  release workflow: merge `preprod` into `main`, tag, create a Release.
- **`.harness-feature`**: line 1 is the slug. Optional line 2, `preview: yes`
  or `preview: no` (default `no`), says whether a deploy variant provisions a
  preview environment: `/feature` writes `yes` for an L change and for a run
  whose exit is `/review`; `/review` flips a `no` to `yes`. Removed before
  the merge by `claude-to-preprod.yml`; unlike the others it stays tracked.
- **`.railway-url`**: written by `feature-branch-railway.yml` to the feature
  branch; the preview URL of this feature's environment.

### `.harness-version` configuration

```yaml
harness: harness-railway
version: 0.3.38
repo: Evolutionary-Leadership/harness
check: node scripts/check-docs.mjs && npm run lint
tests: npm test
reviewers: teammate1, teammate2
spec_product: myproduct
change-prefix: MYPR
registry: off
gate-mode: evaluate
agent-authority: release
```

- **`harness`**: the variant, written by `/setup`. **`version`**: the harness
  version installed, which `/harness-upgrade` diffs against the latest.
- **`repo`**: the published template repo. Each release is a tag there
  holding the exact tree a scaffold receives; public, so upgrades need no
  credentials.
- **`check`**: the CI command. Keep `node scripts/check-docs.mjs` at the
  front so documentation drift fails the merge gate like any other error.
  `feature-branch-checks.yml` runs it as the `check` job on every `claude/**`
  code push (feedback before the merge PR exists) and on the PR to
  `preprod`; the PR run is the gate, and `/to-preprod` polls its conclusion
  on the PR head, merging only on success, within a 12-minute budget. A push
  touching only the feature context skips it.
- **`tests`**: the test command, run by the `tests` job of the same workflow
  beside a Postgres service (`TEST_DATABASE_URL` and `DATABASE_URL` are
  `postgres://postgres:postgres@localhost:5432/app_test`); the gate then
  waits for both run names. The gate is these two lines and nothing else;
  `/implement`'s full check runs `check:` then `tests:`.
- **`reviewers`**: default reviewers assigned by `/review`. **`registry`**:
  `off` makes Capture skip the System Registry lookup entirely.
- **`agent-authority`**: the production-reaching skills a session may
  complete without a person present, space or comma separated; absent or
  empty grants none. Only `release`, `hotfix` and `rollback` are gated;
  `/to-preprod` and `/review` reach no production surface. Project-owned: an
  upgrade never rewrites it, and a commit is reviewable and revertible.
  `/feature --ship` is release authority in its own right (a person typed the
  flag about this session, and the run ends in a tagged release on `main`);
  the key still decides the exit for a no-flag unattended run that reaches
  the phase 5 gate with nobody answering, and it still gates `/hotfix` and
  `/rollback`. See "What a session can finish alone".

### The registry keys and the spec loop's keys

`change-prefix` and `system-key` are this repository's identity in the System
Registry, written by `/setup` when it can. `spec_product` and `gate-mode` are
the spec loop, asleep while `spec_product` is; `.claude/SPEC-LOOP.md` owns it.

- **`spec_product`**: the Spec Universe product slug, and the switch for the
  whole loop. Absent or blank, `check:spec` prints `spec loop not connected`
  and exits 0 before reading a credential, and every spec section of every
  skill is skipped (no skill reads its `CONNECTED.md`): `/code-review`'s Spec
  axis falls back to the tracker's spec issue, `/to-spec` writes a spec issue
  rather than proposals, `/feature` neither captures a change view nor
  retrieves. Naming a product wakes all of it.
- **`change-prefix`**: the registry-issued prefix every change key carries
  (`MYPR-7`, never `MYPR-007`), a cache of an immutable fact (`SPEC-LOOP.md`,
  "The change key"), verified when the line is written and never again,
  except that where `REGISTRY_URL` and `REGISTRY_TOKEN` are both set and
  `registry:` is not `off`, `/feature` re-checks it at Capture, refusing only
  on an answer (resolves to nothing, or to a different system), never on an
  outage. **Not switched by `spec_product`**: every `/feature` mints a key
  and opens a work item. Without the line, phase 0 stops and names it.
- **`system-key`**: the permanent key of the system `change-prefix` resolved
  to when `/setup` verified it. Never used to look anything up: an
  **assertion**, not a cache, so a later `/feature` can tell "still the same
  system" from "someone edited the prefix line". Public, never a credential.
  **Absent is normal and never blocks.** `/setup` writes it only where the
  human confirmed the system; `/feature` offers it and never writes it.
- **`gate-mode`**: how the preprod gate treats drift, `evaluate` or
  `enforce`. **Absent reads `evaluate`**: a scaffold has no recorded
  conformance yet, so `enforce` would block nothing, while `evaluate` still
  writes the ledger the decision to enforce is made from. Both compute
  identical rows; `evaluate` adds one line saying the merge proceeded. Only
  drift the branch INTRODUCED is ever a blocking row. A feature context may
  TIGHTEN this to `enforce` and never loosen it. `SPEC-LOOP.md` names the
  two things that stop in both modes.

**There is no `spec_url`, and there never will be.** The base URL travels with
the credential, `SPEC_UNIVERSE_URL` beside `SPEC_UNIVERSE_TOKEN`, so a session
and a CI job are configured identically and no checked-in file names a host;
`feature-branch-checks.yml` passes both from secrets unconditionally (an
unset secret is an empty string a dormant checker never reads). **CI checks
need no branch protection**: the merge gate polls the check run directly
(protection is unavailable on private free-plan repos anyway).

### Hooks

**A hook never sleeps; polling is a script the session runs on purpose.** A
hook does one fetch or check and returns; anything that waits is a script.

- **SessionStart**: `.claude/scripts/session-start.sh`. On a `claude/`
  branch it resolves the feature name and merges previous work from a
  matching `feature/<name>` branch. It sets a repo-local git identity
  (`Claude`, `noreply@anthropic.com`) when none is configured, pings the
  Product Cockpit once where one is configured (a 404 names the repository
  the cockpit does not know), and tells the session to read
  `getting-started` before anything else (it holds the closing block, the
  stand-down block and the rule that skills are mandatory), with the
  flavour line: `/chat`, `/brainstorm` or `/feature`. It pushes nothing: naming guidance only
  (skipped while `/setup` is present); the feature branch is created on the
  first push, ideally the slug commit. It also shows the Railway URL when
  `.railway-url` exists.
- **PostToolUse (git push)**: `.claude/hooks/post-push-railway-url.sh` does
  one fetch of `.railway-url` through `get-railway-url.sh` and prints it if
  present; it never waits. `bash .claude/scripts/get-railway-url.sh --wait`
  is the poll, run by the session on purpose (`/feature` phase 5 on the
  `/review` path when the user asks to wait), and
  `bash .claude/scripts/verify-deploy.sh` confirms the environment serves the
  pushed sha. The same check runs in Actions for every deploy
  (`verify-deploy.yml`, below), so a session rarely needs it.
- **PreToolUse (Write, Edit, Bash and the GitHub MCP write tools)**:
  `.claude/hooks/prevent-em-dash.sh` blocks any write containing a U+2014 em
  dash; for `Bash` only commands carrying a message or a heredoc are scanned,
  for the MCP tools every string in the tool input.
- **PreToolUse (Write, Edit)**: `.claude/hooks/protect-frozen-docs.sh`
  refuses to rewrite a doc whose `docs/README.md` row reads `Frozen: Yes`
  unless the new content only appends.

### Railway environments

`docs/architecture/railway-environments.md` owns the per-environment facts
(database, bucket, application variables, seed data, the preview URL); read
it before touching any of them. What every session must know:

- **Previews are opt-in.** `feature-branch-railway.yml` provisions an
  environment only when `.harness-feature` line 2 reads `preview: yes` (L
  tier, or an exit of `/review`); on `no` or no line it exits before forking.
  A provisioned environment is duplicated from `preprod`: its own PostgreSQL
  (`DATABASE_URL` wired by Railway, never built by you), its own bucket
  (`AWS_*` variables), the app deployed from `feature/<name>`, torn down when
  the feature merges.
- **A feature database starts empty**; preprod and production only run
  pending migrations, so use expand-and-contract for a breaking schema
  change. **Production is never seeded** (`SEED_DATA=false`; check
  `process.env.SEED_DATA === "false"` at the top of a seed script, not
  `!== "true"`). **Preprod and every preview are publicly loginable**
  (`SHOW_DEMO_LOGIN=true`, a seeded demo account, a public URL), so preprod
  must never hold real data. `BETTER_AUTH_SECRET` is generated per
  environment. Read these variables; never set them by hand.
- **One-time provisioning is GitHub Actions; every later deploy is Railway.**
  `feature-branch-railway.yml` runs once per provisioned branch (triggered by
  `workflow_run` off the bridge workflow, because a push made with
  `GITHUB_TOKEN` starts no workflow), creates the environment, points the
  deployment trigger at `feature/<name>`, wires the variables and publishes
  `.railway-url`. From then on Railway's own GitHub integration rebuilds on
  each commit, visible in the Railway dashboard and never as an Actions run.
  There is no deploy wait in the workflow; `verify-deploy.yml` checks each
  deploy afterwards: a preview after its provisioning run, `preprod` after
  every push to it, production after every push to `main`. It runs
  `verify-deploy.sh` and sets a `deploy/preview`, `deploy/preprod` or
  `deploy/production` commit status on the commit that should be serving.
  The status is information, never a merge gate.
- **Publishing is idempotent by content and self-healing.** The workflow
  rewrites `.railway-url` whenever it does not name the environment it
  resolved, repoints a trigger still aimed at `preprod`, and redeploys; a
  half-provisioned environment is repaired by pushing again, never by hand.
  Concurrent pushes to the same `claude/` branch queue rather than cancel.
- **`/to-preprod` never provisions**: its push is a teardown, skipped by the
  workflow. `/review` keeps the environment and its URL until the merge, when
  `feature-merge-cleanup.yml` deletes it (`feature-branch-cleanup.yml` is
  the fallback for a branch deleted by hand).
- **A variable for one preview only**: commit `.harness/env/<name>.env`
  holding `KEY=value` literals (never a secret; keys the harness or Railway
  own are refused by name). Provisioning sets them on the app service and
  Railway redeploys; removing a key does not unset it. Stripped on the merge
  path with `.railway-url`.
- **Region default: EU West (Amsterdam), every service, every environment.**
  App and Postgres are pinned through `SERVICE_REGION`
  (`europe-west4-drams3a`) by `harness-railway.yml` (production, preprod)
  and `feature-branch-railway.yml` (features, also re-pinned on an
  always-run step); the bucket is created in `ams` through `BUCKET_REGION`
  by `harness-railway.yml` alone, and a feature bucket inherits the preprod
  bucket's region because a bucket cannot be moved or re-pinned. To switch
  regions change both knobs in both workflows; existing services do not
  migrate. Re-check both after a `/harness-upgrade`.

## The feature flow

### The three-rung ladder

Every session starts by stating its flavor (the opening question in
`/getting-started`): **Talk** is `/chat`, which writes nothing; **Think** is
`/brainstorm`, which writes to the tracker only (an idea issue, if kept);
**Build** is `/feature`, which writes the repo through the gated phases its
size tier selects. `/brainstorm` runs `/feature` phase 1's interview engine
and ends by asking where the thinking lands: nowhere, an idea issue, or
`/feature #<issue>`, which grills only the remaining frontier
(`docs/agents/issue-tracker.md` has the tracker rules).

Every `/feature` is sized at the end of Capture (`S`, `M` or `L`; the rubric
is `### Size` in `/feature`), and the tier decides which phases run. Every
`/feature` is also a change on the journey the Product Cockpit draws: twelve
states alternating with eleven transitions, from `captured` to `evaluated`.
`.claude/JOURNEY.md` is the one home for what each position means, and
`/feature` writes its position into the touched-set record as it moves.

### The feature context

`.harness/feature-context/<feature-slug>.md`, committed on the feature
branch, is the feature's memory across sessions and colleagues: `/continue`
lands mid-flow with the reasoning intact. It is the feature's current
summary, not application documentation (`docs/`). One file per slug,
rewritten in place, never an append-only log: staleness, not length, is the
fault. Sections:

- **Phase and next step**: where the flow stands and the single next action.
- **The change**: key, work item, challenge and build verdicts with reasons.
- **Size**: the tier and its one-line reason.
- **Brief**: `brief.sh`'s output: the `CLAUDE.md` guardrails, glossary terms,
  decision records and architecture docs matching the change. Skills read it
  first and the full docs only when it names them.
- **Decisions settled**: each with the reasoning and the rejected
  alternatives; mark one-way ones as "ADR to follow", never a number before
  that file exists.
- **Open frontier**: the questions still unanswered. **Out of scope**: the
  boundary the grill settled.
- **Tracker**: spec issue, tickets and their state, the idea issue if any.
- **Exit route**: `/to-preprod`, `/review` or `/release`, once chosen
  ("awaiting human review" while a `/review` PR is open).
- **Autonomy granted**: whether grill autonomy, phase autopilot or `--ship`
  was used, so a reader knows why a phase carries no approvals. A record,
  not a setting: a resumed session never re-arms any of them.
- **Docs verdict**: phase 4's docs-updater verdict; `/to-preprod` reads it
  instead of auditing again.
- **Blocked**: only while a session has stood down: what blocks, since when,
  what would unblock it. Rewritten, never appended; deleted when the block
  clears, with the `blocked` label on the work item (`.claude/JOURNEY.md`).

Where the spec loop is connected (`spec_product:` above), and only then, it
also carries **The change view** (Spec Universe's, beside the key);
**Retrieved specification** (the block phase 1 wrote: interview context,
never a write's source, dying with this file; `SPEC-LOOP.md`, "The interview
retrieves"); **Conflict decisions** (every card answered with the option and
reason, plus a **strict pause waiting** line; `CONFLICT-PROTOCOL.md`); and
**Spec verdicts**, then **Suspect rows**, then **Tier disagreements**, the
three sections `/code-review` writes, whose order is load bearing because the
gate's parser stops at the next heading (`SPEC-LOOP.md`, "The preprod gate").

Link issues by `#number` or URL, never by relative markdown link.

**Lifecycle.** `/feature` phase 0 creates it; any agent that finishes work on
the feature refreshes it whenever the result changes what a fresh reader
would need. It is committed at every gate and pushed at three checkpoints
(after Capture, with the naming push; after the plan gate; at the end of
phase 4), at phase 5 and at every stand-down: only the pushed copy survives
the container. A pure context refresh carries the prefix `chore(context):`;
the workflows use both signals to skip busywork, and a push touching only
this file skips the CI checks, the Railway provisioning workflow skips a
head commit carrying the prefix, and the starter `railway.json`'s
`watchPatterns` keep `.harness/**` out of Railway's deploys (preserve that
when you edit them). `/to-preprod` drafts the PR description from
it, promotes anything permanent into `docs/`, and deletes it: it never
reaches `preprod`; `feature-merge-cleanup.yml`, `/continue` and `/to-preprod`
sweep a stray left by a bypassed merge.

### The touched set

`features/<feature-slug>.md` on the `coordination` branch is what this
feature declares it is going to touch: the feature context's opposite half,
public to every other session from phase 0, so a parallel feature sees a
collision before the merge rather than at it. **A declaration, never a mirror
of the diff**: what a branch has already changed is derivable from GitHub, and
the coordination branch never keeps a second copy of something GitHub owns.
Front matter and no body, the shape `claims/adr/NNNN.md` uses;
`.claude/scripts/touched-set.mjs` composes it, reads it and computes overlap.

| Field | Holds |
|---|---|
| `slug` | The feature slug, which is also the filename |
| `branch` | `feature/<slug>`, the handle a reader acts on |
| `key` | The change key, unpadded, where the repository mints one |
| `author` | Provenance, the same field a claim carries |
| `declared_at`, `updated_at` | ISO 8601 UTC. The pair is how stale a declaration is |
| `spec` | The `spec_product`, or the literal `none` |
| `phase` | The journey position, one of the 23 keys `touched-set.mjs` lists, spelled as the cockpit spells them. A state key means that state's artefact exists; a transition key means a session is working on it. Written at phase 0 as `captured` and at every phase boundary after: state writes always, transition writes where a cockpit is configured (`.claude/JOURNEY.md`). Front half only, through `built`: the record dies at the merge, and from `verified` on the evidence is on GitHub |
| `size` | The tier, `S`, `M` or `L`, set at Capture |
| `phases` | The append-only history of every position written, so a gap under S reads as a tier, not as missing states |
| `paths` | Repository-relative paths or prefixes. A `**` tail is compared by its literal segments |
| `nodes` | Specification node slugs, or the single `none`. Only where `spec` names a product |

**Two halves, one dormant.** `paths` is written everywhere; `nodes` only under
a `spec_product`, the absence declared (`spec: none`, or the node `none`).

**The beat is the feature context's beat.** Phase 0 declares it once the
branch is named; every refresh of the feature context refreshes it; every
phase boundary refreshes it through `journey.sh phase`; phase 5 reports the
overlap again with the diff in hand. `updated_at` moving is the signal that a
session is working: a reader (the cockpit above all) treats a record older
than four working hours as stalled and shows the change back at the last
state it completed, which is why there is no `blocked_since` field.

**One writer per file, which is why there is one file per feature**, and no
compare-and-swap. The session's copy is `.harness/journey/<slug>.md` on its
own branch: `journey.sh` refreshes it, commits it alone and pushes (the check
and merge workflows ignore the path). `journey-sync.yml`
(`.claude/scripts/journey-sync.sh`) mirrors it onto `coordination` under its
`GITHUB_TOKEN` 20 to 40 seconds later, then rings the cockpit from Actions
`BOARD_URL` (variable or secret) and the `BOARD_TOKEN` secret.

**It dies at the merge.** `/to-preprod` retires it with the feature context
(`journey.sh retire` stages the deletion; the signal commit's push has
`journey-sync.yml` delete the copy). A record whose branch is gone from the
remote **and** untouched for a day has no writer left, so the next reader
sweeps it, which covers a merge that went around `/to-preprod`; the day guards
the window in which phase 0 has written the record and the workflow has not
yet created `feature/<slug>`.

**Nothing here blocks anything.** An overlap is reported to a person, in the
closing block and in the feature context, never to a gate; a missing branch,
a dead network, an absent tool or a malformed record is one warning line.
Only the change-key mint fails closed: a guessed key welds two changes.

### The gate run record

`.harness/gate-runs/<KEY>-<n>.json` is the one thing under `.harness/` that
MUST reach `preprod`: `/to-preprod` writes one per gate run
(`scripts/gate-run.mjs`), with a `dispositionUrl` at the work-item comment
where a person writes `true-drift` or `false-drift`; committed, never
gitignored, never deleted at the merge (`SPEC-LOOP.md`, "The preprod gate").
Dormant repositories have none. `.harness/spec-coverage.json` is derived: gitignore it.

### The closing block

Every reply a session gives the user ends with one closing block: the same
three sections in the same order, whichever skill is running and whether or
not one is. The contract is `.claude/skills/getting-started/SKILL.md`, Step
3b, which the session start hook names on every start; a second copy here
is the thing that would drift.

### The two reviews

- **`/code-review` reviews code**: two axes (Standards, Spec) in parallel
  sub-agents for an M or L change, one merged prompt for S, at the end of
  `/feature` phase 4.
- **`/review` requests humans**: opens a non-auto-merged PR carrying the
  `/code-review` findings, the spec link and the Railway preview URL (the
  environment lives until the merge). Approved `/review` PRs land via
  `/to-preprod` (which reuses the open PR), never the GitHub merge button.

`/feature` phase 5 asks which exit the user wants (`/review` suggested when
`reviewers:` is configured); under `--ship` the exit is `/release`, unasked.

### What a session can finish alone

A session that builds for an hour and then finds it cannot merge tends to
report itself finished, so it must know first. One axis: **does this act
reach production?**

| Skill | A session alone | Why |
|---|---|---|
| `/to-preprod` | **Yes, always** | Auto-merged PR into `preprod`, the branch before production |
| `/review` | **Yes, always** | Opens a PR and merges nothing; it puts people in the loop |
| `/feature`, `/brainstorm`, `/chat`, `/continue`, the technique skills | **Yes** | They build, think and record. None of them ships |
| `/release` | **Under a grant, or under `--ship`** | Ships everything queued on `preprod` to `main`, tags it, publishes a Release |
| `/hotfix` | **Only under a grant** | Straight to `main`, no `preprod` gate in front of it |
| `/rollback` | **Only under a grant** | Moves production back, undoing work somebody shipped deliberately |

The grant is one line in `.harness-version`, the owner's to write:

```yaml
agent-authority: release rollback
```

Three things satisfy `/release`'s authority and nothing else does: that grant,
a user asking for the skill in the turn, or `--ship` in the invocation of the
`/feature` run that chained there (`/hotfix` and `/rollback` take the first
two only). `--ship` counts because a person typed it about this session, and
phase 0 says the run ends in a tagged release on `main`. A session still
cannot assert its own authority, so there is no `--autonomous` flag; and a
`reviewers:` line does not lower `--ship` (reviewers are requested on the PR
for the record; the merge is not withheld).

**The gate binds the act, not the command.** A session may reach a skill's
procedure by reading its `SKILL.md` and following the steps; that route stays
open and is not a way around the gate: writing a release's signal file,
committing and pushing it without authority is a release, whatever it is called.

**A blocked session says so in one shape and never claims success.** The
stand-down block is `.claude/skills/getting-started/SKILL.md`, Step 3c: what
was finished, what was not, the smallest thing that would unblock it; a reply
carrying it must not describe the work as complete, so a coordinator can tell
a stall from a success at a glance.

#### What a session cannot do at all

Environment limits, not fixable by a grant; name them rather than retry:

- **Delete a remote branch.** The harness git proxy accepts pushes only to
  the session's own `claude/<name>` ref, and no GitHub MCP tool deletes a
  branch, so `git push origin --delete` returns 403. `/release` automates
  one case (a `cleanup-branch:` key in `.release-description.md`, deleted by
  `release.yml` with the harness PAT). The rest is human work, most often a
  `feature/<name>` branch left behind when a release bypassed the chain:
  report `reason: capability-missing`, name the branch, never call it done.
- **Push to `preprod` or `main` with `git`.** Same proxy rule. `/release`
  uses `mcp__github__push_files`, which goes through api.github.com.
- **Write the contents API through the proxy.** It refuses every such write
  with 403; a journey write pushes its branch instead and the sweep uses MCP.

### The variants differ only in the Railway steps

Seven flow skills (`continue`, `feature`, `getting-started`, `hotfix`,
`release`, `review`, `status`) carry a Railway override whose delta is limited
to preview-URL and environment mentions (`feature`: phase 0's preview marker
and phase 5's URL report). Any other difference is a bug; report it upstream.

## How an upgrade decides what to change

`/harness-upgrade` compares two real trees, the tag you are moving to and
your repository, never a list of changes: so it stays correct when you edited
a managed file by hand, and a requested version gives exactly that version.
It reads only public data. Every path falls into one of five classes, decided
by the path itself, in this precedence (the first matching rule wins):

| Class | Paths | On upgrade |
|---|---|---|
| Blocked | `.claude/setup/**`, `.claude/skills/setup/**`, `.claude/scripts/setup.sh`, the `harness-preflight.yml` and `harness-railway.yml` workflows, `.harness-bootstrap`, `.harness-preflight` | Never written: one-shot machinery that must never re-arm |
| Blocked | `README.md` | Never written: the template's README is not your project's |
| Stamp | `.harness-version` | Only the `version:` line moves; every other field survives |
| Config | `.claude/settings.json`, `.github/dependabot.yml`, `railway.json`, `.env.example` | Merged, never copied over: new keys are added, values you set are kept, a differing list is put to you |
| Starter (app) | `server.js`, `package.json`, `.gitignore`, `LICENSE`, `NOTICE` | Created only when missing, per file; never overwritten, never recreated once you delete it |
| Starter (docs) | `docs/**`, `scripts/**` | Same write-once rule; a partial `docs/` tree gets only its missing pieces |
| Managed (named) | `scripts/check-spec.mjs`, `gate-run.mjs`, `judge-plan.mjs`, `retrieval.mjs`, `spec-test-claims.mjs` (the spec loop, inert while `spec_product` is unset) and `scripts/strip-em-dash.sh` (the em-dash hook's helper) | Named exceptions to the starter prefix: replaced, so a fix reaches you |
| Managed (workflows) | The `.github/workflows/*.yml` the harness ships, including `feature-branch-railway.yml`, `feature-branch-cleanup.yml` and the Railway overrides of the shared ones | Replaced with the target version's content |
| Managed (`.claude/`) | `hooks/` (including `post-push-railway-url.sh`), `skills/`, `scripts/` (including `get-railway-url.sh`, `verify-deploy.sh`), `agents/`, `HARNESS.md`, `JOURNEY.md`, `SPEC-LOOP.md`, `journey-bindings.json`, `harness-manifest.json` | Replaced. Do not edit; your changes are overwritten |
| Project-owned | Everything the harness never shipped: `CLAUDE.md`, your application code, skills and agents you added | Never touched |

Retired harness files are removed only inside the managed `.claude/` trees
and `.github/workflows/`, and only after you confirm.

## Harness-managed files

`.claude/harness-manifest.json` lists every file the harness ships at its
final path, with its class and the variant that receives it (`both` or
`railway`), plus the five classes above as data; `/harness-upgrade`
classifies from the same rules. A `managed` file is replaced on upgrade: do
not edit it. A file absent from the manifest is yours. The config files are
starting points: `.claude/settings.json` (add hooks and permissions beside
the harness ones; keep or raise its `env` block, `API_TIMEOUT_MS=600000` and
`CLAUDE_CODE_MAX_RETRIES=5`, the retry envelope against stream idle timeouts),
`.github/dependabot.yml` (add your package ecosystems) and `railway.json`
(build and start commands, restart policy, `watchPatterns`; to build with a
`Dockerfile`, set `build.builder` to `DOCKERFILE` and `build.dockerfilePath`).
This variant also ships a write-once Node + Express "it works" app
(`server.js`, `package.json`, `.gitignore`) so the pipeline has something to
deploy on the first push, plus one filled-in reference doc,
`docs/architecture/railway-environments.md`. Replace the app with yours, or
delete all three and update `railway.json` for another runtime: they are
never overwritten and never recreated. Keep the `x-harness` response headers
when you replace the starter, or deploy verification degrades.

**Materialized foundation and MCP files are user-owned.** A project that
chose the technical foundation (`src/`, `tests/`, `drizzle/`, `package.json`,
`CLAUDE.md`, the `docs/` content) or the MCP layer (`.claude/skills/mcp-tool/`
beside the harness's own skills) got them copied out of the `.claude/setup/`
quarantine by `/setup`, which then deleted it. They are absent from the
manifest and `/harness-upgrade` leaves them alone.

**`harness-railway.yml` is one-shot.** It bootstraps production and preprod,
fires from the Actions tab or from a two-line `.harness-bootstrap` on
`preprod` (line 1 a timestamp, any change re-fires it, which is the recovery
after a failed provision; line 2 `foundation: yes|no`, matched exactly), and
its final step deletes both the workflow and the file. Its cleanup commit,
`chore: remove harness bootstrap files (one-time use)`, carries
`production-url: https://...` and `preprod-url: https://...` in its body,
a contract tooling parses by line key (`list_commits` on `preprod`), and
deletes any stray `claude/*` and `feature/*` branch the bootstrap session
left; this can only ever run during first-repo bootstrap.

## Documentation standard

A documentation layout built for AI readers: nearly every reader is an agent
starting a fresh session with no memory, and `CLAUDE.md` is the only part
that loads automatically, so the layout minimizes auto-loaded context and
pushes detail into files retrieved on demand. `docs/README.md`, the index,
owns the layer table and its budgets (`CLAUDE.md` the router at 300 lines,
`docs/architecture/` the reference catalogs with `sources:` globs,
`docs/decisions/` the rationale, `docs/runbooks/` the procedures).

Four rules hold it together: one home per fact; code is truth for WHAT and
docs for WHY and WHERE; accepted decision records are superseded, never
rewritten; freshness is mechanical, enforced by `scripts/check-docs.mjs`,
which `check:` keeps at the front of the chain so broken docs block
auto-merge like a type error. `/document` writes decision records, audits the
diff against the manifest, and routes a fact to its owning doc; the
`docs-updater` agent runs the same taxonomy on the scope `check-docs.mjs
--diff` names, in `/feature` phase 4 (or in `/to-preprod` and `/review` when
phase 4 left no verdict). The rationale ships as the seed decision record in
`docs/decisions/`. Write-once scaffold: `docs/README.md` (your index), the
`GLOSSARY`, `SECURITY` and `TESTING` skeletons, the three `TEMPLATE.md` files
(copy, never edit in place), the seed record, `scripts/check-docs.mjs`.

## How to extend

- **A skill**: `.claude/skills/<name>/SKILL.md` with YAML frontmatter
  (`name`, `description`). **An agent**: `.claude/agents/<name>.md` (`name`,
  `description`, `allowed-tools`), run in its own context via the Agent tool.
  **A workflow**: a new file in `.github/workflows/`. Upgrades touch none.

## Variants and upgrading

One tree ships; `/setup` chooses the variant and records it in
`.harness-version`:

| Variant | What you get |
|---------|--------------|
| `harness-plain` | Feature branches + auto-merge, no deploy target |
| **`harness-railway`** *(this project)* | + Railway preview environments per feature with isolated PostgreSQL and S3-compatible bucket |

Switching variants after setup is not an automated migration: re-scaffold
from the template and port your application code over.

Run `/harness-upgrade` to move to a newer version within your variant. It
shows what changed and why, from the release notes rendered into the tree it
clones (so it works offline, behind a proxy and in a sandboxed session), with
breaking items above the confirmation prompt, then the exact list of files it
would write. Nothing changes until you approve. **An upgrade is a reviewed
commit, not an auto-push**: it rewrites the workflows, skills and hooks that
decide how every future session behaves, and no person wrote any of it, so
read `git diff`, check the workflows and hooks still run, and commit it
yourself. The version stamp is written last, only after the result verifies.
Versions are semver: PATCH for merged features, MINOR for significant
releases, MAJOR for breaking ones.

## License

The Harness Companion is licensed under the **Apache License 2.0** (`LICENSE`
and `NOTICE` in the repository root). The NOTICE file must be preserved in any
derivative work or fork; it attributes this project to its origin, [The
Harness Companion](https://www.harnesscompanion.com) by Evolutionary Leadership Coöperatie U.A.
