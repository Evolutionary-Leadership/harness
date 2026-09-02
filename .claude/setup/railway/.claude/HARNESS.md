# Harness Context

This project was scaffolded from the
[`evolutionary-leadership/harness`](https://github.com/evolutionary-leadership/harness)
template repo using GitHub's "Use this template" button, then configured
by the one-shot `/setup` skill (variant: **harness-railway**). The
template added automated CI/CD infrastructure with Railway preview
environments, PostgreSQL, and S3-compatible object storage, not
application code. Understanding what it set up helps you work with it
instead of against it.

The template content itself is authored in
[`evolutionary-leadership/harness-forge`](https://github.com/evolutionary-leadership/harness-forge)
and synced from there into this template repo on every harness release.

## Architecture

### Branch naming drives everything

```
claude/<codename>-<sessionId>  ← you work here (random codename)
       ↓ first push: slug commit from set-feature-name.sh, or any code push
       ↓ (GitHub Action)
feature/<name>                 ← created automatically from preprod
       ↓                         + Railway env + Postgres + Bucket provisioned
       ↓ (/to-preprod)
preprod                        ← PR auto-merged
                                 Railway env + Postgres + Bucket cleaned up
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
- Each feature branch gets its own isolated Railway environment with a
  dedicated PostgreSQL instance and S3-compatible bucket, duplicated from
  preprod.

### Feature naming

Feature branches and Railway environments are named after the work, not the
random session codename. The mechanism:

- **Source of truth:** a committed file `.harness-feature` holding a
  kebab-case slug. Claude sets it early via
  `bash .claude/scripts/set-feature-name.sh <slug>`, which sanitizes the
  input, writes the file, commits, and pushes.
- **Resolution (everywhere):** use the slug if `.harness-feature` is
  present and valid (`^[a-z0-9][a-z0-9-]{0,40}$`, and not `preprod` or `main`),
  otherwise fall back to the codename. The shared resolver is
  `.claude/scripts/resolve-feature-name.sh`; the three workflows
  (`claude-to-feature-branch.yml`, `claude-to-preprod.yml`,
  `feature-branch-railway.yml`) apply the identical check.
- **Slug-first, not rename-later:** the slug is set BEFORE the first push,
  so the feature branch and Railway environment are created with the good
  name from the start (Railway has no clean environment rename). The early
  build head start is preserved because the slug commit IS the first push.
- **Graceful fallback:** if `set-feature-name.sh` is never called, the first
  code push still creates `feature/<codename>` and provisions Railway under
  the codename. Naming is an improvement, never a requirement.
- **No leak to preprod:** `.harness-feature` is removed by the to-preprod workflow
  before the merge, so a future session cloned from preprod never inherits a
  stale name. For this reason `.harness-feature` must stay out of
  `.gitignore` (the workflows read it from the commit).

**Where do I look for X:**

| What | Where |
|------|-------|
| Provisioning trigger | A `claude/` push (the slug commit, or first code push) |
| Deploy branch | `feature/<name>` |
| Ongoing deploys | Railway dashboard (Railway-native, not GitHub Actions) |
| CI checks | Only on the PR to `preprod`/`main` |
| Current feature name | `bash .claude/scripts/resolve-feature-name.sh` |

### Signal files

- **`.pr-description.md`**: Committing this file to the repo root triggers
  the GitHub Action to create a PR from `feature/<name>` → `preprod` and
  auto-merge it. The `/to-preprod` skill writes this file for you. If the
  frontmatter contains `review: true`, the PR is created but NOT
  auto-merged (used by the `/review` skill). If `hotfix: true`, the hotfix
  workflow handles it instead.
- **`.release-description.md`**: Committing this file triggers the release
  workflow to create a PR from `preprod` → `main`, tag a version, and create
  a GitHub Release. The `/release` skill writes this file.
- **`.railway-url`**: Written by the GitHub Action to the feature branch.
  Contains the Railway preview URL for this feature's environment.
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
harness: harness-railway
version: 0.3.38
repo: evolutionary-leadership/harness-forge
traits: nodejs, typescript, express
check: node scripts/check-docs.mjs && npm test && npm run lint
reviewers: teammate1, teammate2
```

- **`harness`**: variant identifier, written by `/setup` on first run
  (`harness-plain` or `harness-railway`).
- **`version`**: harness version installed; used by `/harness-upgrade` to
  diff against the latest release.
- **`repo`**: the upstream forge repo (`evolutionary-leadership/harness-forge`),
  which hosts `VERSION`, `migrations/`, and `stacks/traits/`.
- **`check`**: CI command to run on PRs to preprod. Keep
  `node scripts/check-docs.mjs` at the front of the chain so documentation
  drift fails the merge gate like any other error. When configured, the
  `feature-branch-checks.yml` workflow runs this command (also on every
  push to a `claude/**` branch, for feedback before the merge PR exists),
  and to-preprod polls the run's conclusion on the PR head, merging only on
  success. The check chain must finish within the gate's 12-minute budget.
- **`reviewers`**: Default reviewers assigned when using `/review`.
- **`traits`**: stack-specific best-practice files installed under
  `.claude/traits/` and managed by `/harness-upgrade`.

**Prerequisites for CI checks:**
- None: the merge gate polls the check run directly, so it works without
  branch protection (unavailable on private free-plan repos, where
  auto-merge would silently degrade to an immediate merge)
- Optionally add a branch protection rule for `main` with required status
  checks to gate releases and hotfixes

### Hooks

- **SessionStart**: Runs `.claude/scripts/session-start.sh` on every new
  session. On a `claude/` branch, it resolves the feature name and, if a
  matching `feature/<name>` branch already exists, merges previous work and
  shows the Railway URL. It no longer pushes an init commit: a fresh
  session just prints naming guidance (skipped while the one-shot
  `/setup` skill is still present, since the only sane first move then
  is `/setup`, which pushes to `preprod`, never to this branch).
  Provisioning happens on Claude's first push, ideally the
  `set-feature-name.sh` slug commit (see "Feature naming"). You do not need `/feature` to start; just describe what you
  want to build and Claude names the session before its first push.
- **PreToolUse (Write/Edit/Bash)**: Runs
  `.claude/hooks/prevent-em-dash.sh`, which blocks any write that contains
  a U+2014 em dash.
- **PostToolUse (git push)**: Runs
  `.claude/hooks/post-push-railway-url.sh` after every `git push`, which
  fetches and displays the Railway preview URL. The hook delegates its
  fetch/poll loop to `.claude/scripts/get-railway-url.sh`, so any time
  the URL is not yet available (provisioning runs longer than the hook's
  ~80s budget, or hook output was not visible in context) you can re-run
  the helper directly: `bash .claude/scripts/get-railway-url.sh`.

### Railway environments

Each feature gets a fully isolated Railway environment:
- Duplicated from the `preprod` environment (same services and config)
- Includes its own PostgreSQL instance and S3-compatible bucket
- `DATABASE_URL` is auto-wired via Railway reference variable
  (`${{Postgres.DATABASE_URL}}`), so your app just reads `DATABASE_URL`
- Bucket credentials are auto-wired as environment variables (see below)
- Deployed automatically when the feature branch is pushed
- Cleaned up automatically (including Postgres and bucket) when the
  feature is merged
- Preview URL stored in `.railway-url` on the feature branch. The
  publishing step in `feature-branch-railway.yml` is idempotent by
  **content**: it resolves this environment's domain and rewrites the
  file whenever the file does not name it, so a branch that inherited a
  stale URL from `preprod` corrects itself on its first run rather than
  pointing at a destroyed environment. A run that cannot resolve the
  domain leaves the file alone and warns. Concurrent pushes to the same
  `claude/...` branch *queue* instead of cancelling, so a new push never
  interrupts a Railway GraphQL mutation in flight.
- `/to-preprod` does not provision. Its push is skipped by
  `feature-branch-railway.yml`, because that push tears the environment
  down. `/review` is not skipped: a PR opened for review keeps its
  environment and its preview URL until it is merged.
- Deployment triggers are self-healing too: every provisioning run
  re-checks the environment's deployment triggers and repoints any that
  still target `preprod` at `feature/<name>`, then redeploys the app service
  so the running code matches the connected branch. This repairs
  half-provisioned environments (e.g. when `environmentCreate` returned
  a malformed response mid-fork) that would otherwise silently serve preprod
  code on the preview URL.

**Why no GitHub Actions run shows up on the `feature/` branch.** This
trips up almost everyone the first time, so it's worth stating plainly:
the `feature/` branch is wired to Railway, but it does **not** run
GitHub Actions on every deploy. There are two distinct actors, and only
one of them is GitHub Actions:

1. **One-time provisioning (GitHub Actions).**
   `feature-branch-railway.yml` runs **once**, triggered indirectly off
   the `claude/` push (via `workflow_run: completed` of the
   "Create feature branch & merge claude/ into it" bridge workflow,
   gated on `startsWith(head_branch, 'claude/')`). It checks out
   `feature/<name>`, creates the Railway environment (duplicated from
   `preprod`), points the Railway **deployment trigger** at the
   `feature/<name>` branch, wires `DATABASE_URL` and bucket credentials,
   and publishes `.railway-url`. That is the *entire* GitHub Actions
   involvement in feature deploys.
2. **Every ongoing build and deploy (Railway, not Actions).** Once the
   trigger points at `feature/<name>`, **Railway's own GitHub
   integration** watches that branch and rebuilds/redeploys on each new
   commit. These deploys run inside Railway and show up in the **Railway
   dashboard** (project → the feature's environment → Deployments). They
   never appear as GitHub Actions runs, because GitHub Actions is not
   what triggers them.

Two consequences that look like bugs but are expected:

- **No `workflow_run` on `feature/` pushes.** The bridge workflow pushes
  to `feature/**` using the default `GITHUB_TOKEN`. GitHub deliberately
  does **not** trigger downstream workflows from `GITHUB_TOKEN` pushes
  (this prevents recursive workflow loops), so even if a workflow were
  listening on `push: feature/**`, it would not fire. The Railway
  provisioning is reached via `workflow_run` off the bridge precisely to
  work around this.
- **An empty "Check status" on the feature branch is normal.**
  `feature-branch-checks.yml` runs only on `pull_request` to `preprod`/`main`.
  A `feature/` branch with no open PR has nothing to report, so a blank
  or "expected" check status there is not a misconfiguration; CI runs
  when you open the PR (via `/to-preprod` or `/review`), not before.

**Where do I look for X:**

| What | Where it happens |
|------|------------------|
| Provisioning trigger | A `claude/` push (bridge workflow, then `workflow_run`); GitHub Actions tab |
| Deploy branch | `feature/<name>` (the Railway deployment trigger points here) |
| Ongoing builds/deploys | **Railway dashboard**, the feature's environment (Railway-native, not Actions) |
| Preview URL | `.railway-url` on the `feature/` branch, or `bash .claude/scripts/get-railway-url.sh` |
| CI checks | Only on the PR to `preprod`/`main` (`feature-branch-checks.yml`), not on the feature branch itself |

**Region default:** Every service in every environment (production, preprod,
and every feature branch) defaults to **EU West (Amsterdam)**; nothing
lands in a US region. All three services are covered:

- **App + Postgres** are pinned to `europe-west4-drams3a` via the
  `SERVICE_REGION` env var. Without this pin, Railway places new services
  in US East (Virginia), on the opposite side of the Atlantic from the
  bucket. The pin is applied by the one-time `harness-railway.yml` (for
  production and preprod) and by `feature-branch-railway.yml`, which pins both
  on first provision *and* in an always-run "Pin service region to Europe
  and redeploy" step so an environment that already existed (older
  harness, or a create run that died early) still gets corrected.
- **The object-storage bucket** is created in the `ams` region via the
  `BUCKET_REGION` env var. Only `harness-railway.yml` creates buckets
  (for production and preprod). Feature environments fork the preprod environment,
  so every feature bucket *inherits* the preprod bucket's `ams` region. The
  bucket is **not** addressable through `project.services`, so
  `feature-branch-railway.yml` cannot read or re-pin a feature bucket's
  region; the preprod bucket is the durable control. A bucket also cannot be
  moved after creation, so a preprod bucket in `ams` is what guarantees every
  feature bucket is in `ams`.

To switch regions, change **both** knobs in **both** workflows so they
stay in sync: `SERVICE_REGION` (app + Postgres) and `BUCKET_REGION`
(bucket). Valid `SERVICE_REGION` values come from Railway's
`serviceInstanceUpdate` GraphQL docs (e.g. `us-east4-eqdc4a`,
`asia-southeast1-eqsg3a`). Existing services do **not** migrate
automatically; changing either value only affects services created after
the change, and a bucket already created cannot be moved at all.
**After a `/harness-upgrade`, re-check both values**: an upgrade can
overwrite these harness-managed workflows and reset the region defaults.

**Database migrations:** Each feature environment starts with an empty
database. Your migration tooling must handle creating tables from scratch.

**Application variables:** A scaffold that took the standard technical
foundation gets `BETTER_AUTH_SECRET` (generated separately per
environment), `SEED_DATA`, and `SHOW_DEMO_LOGIN` provisioned during
bootstrap, so a fresh repo needs no Railway dashboard visit. Production
gets a secret and `SEED_DATA=false` and never `SHOW_DEMO_LOGIN`; preprod gets
its own secret plus `SEED_DATA=true` and `SHOW_DEMO_LOGIN=true`; each
feature preview gets its own secret on first provision and inherits the
rest from preprod. Secrets are masked in the workflow, so read them from the
Railway dashboard, not the run log. Because preprod and previews carry a
seeded demo account and a public URL, **preprod must never hold real data**.
See `docs/architecture/railway-environments.md`.

**Seed data:** Production has `SEED_DATA=false` set automatically by the
harness setup workflow, so it is never seeded. Preprod gets `SEED_DATA=true`
on a foundation scaffold, and feature environments inherit from preprod, so
they seed normally. Projects should check
`process.env.SEED_DATA === "false"` at the top of their seed script to
bail out early on production. Prefer that form over `!== "true"`: a repo
provisioned before the harness set the preprod value has it unset there, and
the strict form would silently stop seeding preprod.

**Bucket environment variables:**

| Variable | Purpose |
|----------|---------|
| `AWS_S3_BUCKET_NAME` | Globally unique S3 bucket name |
| `AWS_ENDPOINT_URL` | S3 endpoint |
| `AWS_ACCESS_KEY_ID` | S3 access key |
| `AWS_SECRET_ACCESS_KEY` | S3 secret key |
| `AWS_DEFAULT_REGION` | S3 region (e.g., `auto`) |

Use any S3-compatible client library. Each environment's bucket is
completely isolated, with no cross-contamination between feature, preprod,
and production. Buckets are created in the `ams` (Amsterdam) region by
default (the `BUCKET_REGION` knob), matching the EU West service region
pin (`SERVICE_REGION`) described above. Production and preprod buckets are
created directly; feature buckets inherit `ams` from the forked preprod
bucket and cannot be re-pinned per feature (see "Region default").

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
busywork: pushes that touch only this file skip the CI checks
(`feature-branch-checks.yml` ignores the path), the Railway provisioning
workflow skips runs whose head commit carries the prefix, and the starter
`railway.json`'s `watchPatterns` allowlist means a context-only push
triggers no Railway deploy (keep `.harness/**` out of your watch patterns
to preserve that). At merge time `/to-preprod` uses it to draft the PR
description, promotes anything permanent into `docs/`, and deletes it: it
never reaches `preprod`. If a merge bypasses `/to-preprod` (the GitHub merge
button), `feature-merge-cleanup.yml` removes the leftover from preprod, and
`/continue` and `/to-preprod` also sweep strays as a safety net.

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
  `/code-review` findings, the spec link, and the Railway preview URL.
  Approved `/review` PRs land via `/to-preprod` (which reuses the open PR),
  never the GitHub merge button.

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

## Managed trait files

Stack-specific best practices live in `.claude/traits/` as separate
managed files (e.g. `.claude/traits/nodejs.md`,
`.claude/traits/typescript.md`). These are fetched from the forge repo's
`stacks/traits/` directory and can be auto-updated via `/harness-upgrade`.

To install traits, add the trait names to `.harness-version`:

```
traits: nodejs, typescript, express, vitest, eslint, pnpm
```

Then run `/harness-upgrade`. It will fetch the matching trait files from
the forge and install them in `.claude/traits/`. On future upgrades, it
will show diffs and let you update to the latest best practices.

Add this line to your project's `CLAUDE.md` so the AI reads them:

```
Read `.claude/traits/` for stack-specific best practices before writing code.
```

Available traits and presets are listed in the forge repo's `stacks/`
directory.

## Migration system

Each harness version has a structured migration file
(`migrations/X.Y.Z.yaml` in the forge repo) describing what changed. The
`/harness-upgrade` skill uses these to:

- **Filter by relevance**: only show changes that affect your variant and
  traits
- **Categorize by priority**: REQUIRED (infrastructure), RECOMMENDED
  (traits), INFORMATIONAL (other)
- **Show context**: what changed and why, not just raw diffs

Migration files are auto-generated by the `harness-version-bump.yml`
workflow in the forge whenever a feature merges to `preprod`. They are never
manually authored.

## Harness-managed files

These files are maintained by the harness and replaced on
`/harness-upgrade`. Do not edit them; your changes will be overwritten.

| File | Purpose |
|------|---------|
| `.github/workflows/harness-bootstrap.yml` | Guarantees the three branches (`main`, `preprod`, and the orphan `coordination`). Idempotent; dispatch it if a branch goes missing |
| `.github/workflows/claude-to-feature-branch.yml` | Merges `claude/` branches into `feature/` branches |
| `.github/workflows/claude-to-preprod.yml` | Deletes Railway environment, creates PR from `feature/` to `preprod`, and auto-merges (or opens for review) |
| `.github/workflows/feature-branch-checks.yml` | Runs CI checks on PRs to preprod (reads `check:` from `.harness-version`) |
| `.github/workflows/release.yml` | Creates release PR preprod → main, tags version, creates GitHub Release |
| `.github/workflows/hotfix.yml` | Handles hotfix PRs to main, tags patch release, back-merges to preprod |
| `.github/workflows/feature-branch-railway.yml` | Creates Railway environment with Postgres and bucket when a new feature branch is created |
| `.github/workflows/feature-merge-cleanup.yml` | Deletes Railway environment (including Postgres and bucket) and feature branch after merge to preprod, and removes a leftover feature-context file if the merge bypassed `/to-preprod` |
| `.github/workflows/feature-branch-cleanup.yml` | Fallback cleanup if a feature branch is deleted manually |
| `.claude/scripts/session-start.sh` | Session startup hook |
| `.claude/scripts/list-skills.sh` | Skill discovery script |
| `.claude/scripts/resolve-feature-name.sh` | Resolves the feature name (slug from `.harness-feature`, else session codename); shared by the hooks, scripts, and workflows |
| `.claude/scripts/set-feature-name.sh` | Names the session's feature: sanitizes a slug, writes `.harness-feature`, commits, and pushes to trigger provisioning |
| `.claude/scripts/get-railway-url.sh` | On-demand Railway preview URL fetcher (polls; usable both from the post-push hook and as a manual recovery command) |
| `.claude/scripts/verify-deploy.sh` | Confirms an environment serves the pushed code: polls the URL for the `x-harness-sha` header and matches it against the `feature/<name>` tip |
| `.claude/hooks/post-push-railway-url.sh` | Runs after `git push`; delegates to `get-railway-url.sh` to fetch the Railway preview URL |
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
| `.claude/traits/*.md` | Stack best practices (managed per `traits:` in `.harness-version`) |

**Materialized foundation files are user-owned.** A project that chose
the technical foundation got its application tree (`src/`, `tests/`,
`drizzle/`, `package.json`, `CLAUDE.md`, the `docs/` content, and the
rest of the payload) copied out of the `.claude/setup/foundation/`
quarantine by `/setup`, which then deleted the quarantine. Those files
belong to this project from that moment on: `/harness-upgrade` never
touches them, and they must never be added to the harness-managed list
above.

**So are the MCP layer's files**, if `/setup` was answered `mcp=yes`:
they were copied out of `.claude/setup/mcp/` on top of the foundation
and are user-owned on the same terms. The one that looks out of place is
`.claude/skills/mcp-tool/`, since the harness's own skills sit beside
it. It is not one of them: it arrived with the payload, it
is absent from the list above, and `/harness-upgrade` leaves it alone.

**Note:** `harness-railway.yml` is a one-time setup workflow that
self-destructs after its first run. It is not part of ongoing upgrades.
It can be triggered two ways: manually via the Actions tab ("Run
workflow"), or by writing a two-line `.harness-bootstrap` file to the
`preprod` branch (used by the harnesscompanion.com wizard via the GitHub
MCP server, which can write files but not dispatch workflows). Line 1 is
a timestamp, and any change to it re-fires the workflow, which is the
documented recovery after a failed provision. Line 2 is `foundation: yes`
or `foundation: no`, recording whether the project took the standard
technical foundation; the workflow matches that line exactly to decide
whether to provision application variables, and treats anything else as
no. The final cleanup step removes both
`.github/workflows/harness-railway.yml` and `.harness-bootstrap`, so the
trigger can never re-fire.

The cleanup commit (titled `chore: remove harness bootstrap files
(one-time use)`) carries the provisioned Railway URLs in its body in a
stable, grep-friendly shape:

```
production-url: https://<prod-domain>
preprod-url: https://<preprod-domain>
```

A bootstrapping Claude Code session (or the harnesscompanion.com setup
wizard) can fetch those URLs via `list_commits` on `preprod` instead of
asking the user to copy them out of the workflow's Job Summary. Treat
this commit body shape as a contract: tooling parses it by line key.

After pushing the cleanup commit, the same step also deletes any stray
`claude/*` and `feature/*` branches left over from the bootstrap
session. The bootstrap session does not run `/to-preprod`,
so if it named a feature (via `set-feature-name.sh`) or pushed any
code, the resulting `feature/<name>` branch would leak with nothing
else to clean it up; doing it here keeps a freshly bootstrapped repo
tidy. Because the workflow self-deletes
beforehand, this branch cleanup can only ever run during first-repo
bootstrap, never against an established repo where those branches
would represent real work.

## Harness-provided starting points

The harness created these files as a starting point. You own them, so
edit freely to match your project. On `/harness-upgrade`, these are
diffed and you choose whether to accept upstream changes.

| File | What to customize |
|------|-------------------|
| `.claude/settings.json` | Add your own hooks and tool permissions alongside the harness-provided ones |
| `.github/dependabot.yml` | Add entries for your package ecosystems (npm, pip, Docker, etc.) |
| `railway.json` | Customize build commands, start commands, restart policy for your app |

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

This variant also ships one filled-in reference doc,
`docs/architecture/railway-environments.md`, which owns the per-environment
Postgres, bucket, app-service, region, and preview-URL facts. `CLAUDE.md`
keeps only the invariants and a pointer to it, which is the shape every
other subsystem doc should copy.

## Starter scaffold (write-once)

The harness ships a minimal Node + Express "it works" app so the Railway
pipeline has something to deploy on the very first push. These files are
**created once on init and never touched again** by `/harness-upgrade`:

| File | What to do |
|------|------------|
| `server.js` | Replace with your real app, or delete entirely if not using Node |
| `package.json` | Replace with your real manifest, or delete entirely if not using Node |
| `.gitignore` | Extend for your stack |
| `docs/README.md` | Your index. Add a row per doc; the harness never clobbers your rows |
| `docs/GLOSSARY.md`, `docs/SECURITY.md`, `docs/TESTING.md` | Fill in with project facts |
| `docs/architecture/TEMPLATE.md`, `docs/decisions/TEMPLATE.md`, `docs/runbooks/TEMPLATE.md` | Copy them, do not edit in place |
| `docs/architecture/railway-environments.md` | Yours to extend as you build on the Railway environment |
| `docs/decisions/0001-adopt-the-ai-native-documentation-standard.md` | A dated record; supersede it rather than editing it |
| `scripts/check-docs.mjs` | Extend with project-specific checks |

Concretely:
- If you edit any of these files, `/harness-upgrade` will **never overwrite
  your changes**.
- If you delete any of these files, `/harness-upgrade` will **never
  recreate them**. You can safely move to Python, Go, Rust, or any other
  stack: delete `server.js`, `package.json`, `.gitignore`, and update
  `railway.json`'s `startCommand` and `watchPatterns` to match your
  runtime.
- If a starter file is missing on a fresh scaffold (partial install), the
  next `/harness-upgrade` run will offer to create it from upstream.
- Skip-if-exists applies **per file**, not per directory. A project with
  `docs/README.md` but no `docs/SECURITY.md` gets exactly the missing file.

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
run in their own context via the Agent tool. Custom agents are not
touched by `/harness-upgrade`.

### Adding workflows

Prefer adding new workflow files in `.github/workflows/` over modifying
harness-managed ones. New files won't be touched by upgrades.

### Switching to Docker builds

Railway defaults to Railpack, which auto-detects your framework and
handles builds with zero config. If you need custom build steps (system
dependencies, multi-stage builds, binary compilation), create a
`Dockerfile` and update `railway.json`:

```json
{
  "build": {
    "builder": "DOCKERFILE",
    "dockerfilePath": "Dockerfile"
  }
}
```

## Variants

One template repo ships from the forge
([evolutionary-leadership/harness](https://github.com/evolutionary-leadership/harness));
the variant is chosen by the one-shot `/setup` skill on first run and
recorded in `.harness-version`:

| Variant | What you get |
|---------|--------------|
| `harness-plain` | Feature branches + auto-merge, no deploy target |
| **`harness-railway`** *(this project)* | + Railway preview environments per feature with isolated PostgreSQL and S3-compatible bucket |

Switching between variants after setup is not an automated migration; it
requires re-scaffolding from the template (answering the Railway
question differently) and porting your application code over.

## Upgrading (same variant)

Run `/harness-upgrade` to check for version updates within your current
variant. The skill uses structured migration files from the forge
(`evolutionary-leadership/harness-forge`) to show you exactly what
changed, filtered by your variant and installed traits. See
`.harness-version` for current version info.

### Version numbering

Harness versions use semver (`MAJOR.MINOR.PATCH`):
- **PATCH** bumps automatically on each feature merge to the forge's
  `preprod` branch
- **MINOR** bumps are a developer decision for significant releases
- **MAJOR** is reserved for breaking architecture changes

## License

The Harness Companion is licensed under the **Apache License 2.0**.
See the `LICENSE` and `NOTICE` files in the root of this repository.

The NOTICE file must be preserved in any derivative works or forks.
It attributes this project to its origin:
[The Harness Companion](https://www.harnesscompanion.com)
by Evolutionary Leadership Coöperatie U.A.
