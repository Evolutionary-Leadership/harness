# Harness Context

This project was scaffolded from the
[`evolutionary-leadership/harness`](https://github.com/evolutionary-leadership/harness)
template repo using GitHub's "Use this template" button, then configured
by the one-shot `/setup` skill (variant: **harness-plain**). The template
added automated CI/CD infrastructure (feature branches, auto-merge,
releases), not application code. Understanding what it set up helps you
work with it instead of against it.

The template content itself is authored in
[`evolutionary-leadership/harness-forge`](https://github.com/evolutionary-leadership/harness-forge)
and synced from there into this template repo on every harness release.

## Architecture

### Branch naming drives everything

```
claude/<codename>-<sessionId>  ← you work here (random codename)
       ↓ first push: slug commit from set-feature-name.sh, or any code push
       ↓ (GitHub Action)
feature/<name>                 ← created automatically from dev
       ↓ (/mergedev)
dev                            ← PR auto-merged
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
  present and valid (`^[a-z0-9][a-z0-9-]{0,40}$`, and not `dev` or `main`),
  otherwise fall back to the codename. The shared resolver is
  `.claude/scripts/resolve-feature-name.sh`; the workflows
  (`claude-to-feature-branch.yml`, `claude-mergedev.yml`) apply the
  identical check.
- **Set it before the first push** so the feature branch is created with the
  good name from the start.
- **Graceful fallback:** if `set-feature-name.sh` is never called, the first
  code push still creates `feature/<codename>`. Naming is an improvement,
  never a requirement.
- **No leak to dev:** `.harness-feature` is removed by the mergedev workflow
  before the merge, so a future session cloned from dev never inherits a
  stale name. For this reason it must stay out of `.gitignore` (the
  workflows read it from the commit).

**Where do I look for X:**

| What | Where |
|------|-------|
| Provisioning trigger | A `claude/` push (the slug commit, or first code push) |
| Feature branch | `feature/<name>` |
| CI checks | Only on the PR to `dev`/`main` |
| Current feature name | `bash .claude/scripts/resolve-feature-name.sh` |

### Signal files

- **`.pr-description.md`**: Committing this file to the repo root triggers
  the GitHub Action to create a PR from `feature/<name>` → `dev` and
  auto-merge it. The `/mergedev` skill writes this file for you. If the
  frontmatter contains `review: true`, the PR is created but NOT auto-merged
  (used by the `/review` skill). If `hotfix: true`, the hotfix workflow
  handles it instead.
- **`.release-description.md`**: Committing this file triggers the release
  workflow to create a PR from `dev` → `main`, tag a version, and create a
  GitHub Release. The `/release` skill writes this file.
- **`.harness-feature`**: A committed one-line kebab-case slug naming this
  feature, written by `set-feature-name.sh`. The workflows and shell
  scripts resolve the feature name from it (with a codename fallback). It
  is removed before the merge to dev (by `claude-mergedev.yml`) so the name
  never leaks onto dev and into the next session. Unlike the other signal
  files it must stay tracked (not in `.gitignore`), because the workflows
  read it from the commit.

### `.harness-version` configuration

The `.harness-version` file supports these fields:

```yaml
harness: harness-plain
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
- **`check`**: CI command to run on PRs to dev. Keep
  `node scripts/check-docs.mjs` at the front of the chain so documentation
  drift fails the merge gate like any other error. When configured, the
  `feature-branch-checks.yml` workflow runs this command (also on every
  push to a `claude/**` branch, for feedback before the merge PR exists),
  and mergedev polls the run's conclusion on the PR head, merging only on
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
  matching `feature/<name>` branch already exists, merges previous work. It
  no longer pushes an init commit: a fresh session just prints naming
  guidance. The feature branch is created on Claude's first push, ideally
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
- **Exit route**: `/mergedev` or `/review`, once chosen; "awaiting human
  review" while a `/review` PR is open.

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
`/mergedev` uses it to draft the PR
description, promotes anything permanent into `docs/`, and deletes it: it
never reaches `dev`. If a merge bypasses `/mergedev` (the GitHub merge
button), `feature-merge-cleanup.yml` removes the leftover from dev, and
`/continue` and `/mergedev` also sweep strays as a safety net.

### The two reviews

- **`/code-review` reviews code**: two axes (Standards, Spec) in parallel
  sub-agents, run automatically at the end of `/feature` phase 4.
- **`/review` requests humans**: opens a non-auto-merged PR carrying the
  `/code-review` findings and the spec link. Approved `/review` PRs land
  via `/mergedev` (which reuses the open PR), never the GitHub merge
  button.

`/feature` phase 5 always asks which exit the user wants, suggesting
`/review` when `.harness-version` configures `reviewers:` and `/mergedev`
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

Stack-specific best practices live in `.claude/traits/` as separate managed
files (e.g. `.claude/traits/nodejs.md`, `.claude/traits/typescript.md`).
These are fetched from the forge repo's `stacks/traits/` directory and
can be auto-updated via `/harness-upgrade`.

To install traits, add the trait names to `.harness-version`:

```
traits: nodejs, typescript, express, vitest, eslint, pnpm
```

Then run `/harness-upgrade`. It will fetch the matching trait files from
the forge and install them in `.claude/traits/`. On future upgrades, it will
show diffs and let you update to the latest best practices.

Add this line to your project's `CLAUDE.md` so the AI reads them:

```
Read `.claude/traits/` for stack-specific best practices before writing code.
```

Available traits and presets are listed in the forge repo's `stacks/` directory.

## Migration system

Each harness version has a structured migration file
(`migrations/X.Y.Z.yaml` in the forge repo) describing what changed. The
`/harness-upgrade` skill uses these to:

- **Filter by relevance**: only show changes that affect your variant and traits
- **Categorize by priority**: REQUIRED (infrastructure), RECOMMENDED (traits),
  INFORMATIONAL (other)
- **Show context**: what changed and why, not just raw diffs

Migration files are auto-generated by the `harness-version-bump.yml`
workflow in the forge whenever a feature merges to `dev`. They are never
manually authored.

## Harness-managed files

These files are maintained by the harness and replaced on
`/harness-upgrade`. Do not edit them; your changes will be overwritten.

| File | Purpose |
|------|---------|
| `.github/workflows/claude-to-feature-branch.yml` | Merges `claude/` branches into `feature/` branches |
| `.github/workflows/claude-mergedev.yml` | Creates PR from `feature/` to `dev` and auto-merges (or opens for review) |
| `.github/workflows/feature-branch-checks.yml` | Runs CI checks on PRs to dev (reads `check:` from `.harness-version`) |
| `.github/workflows/release.yml` | Creates release PR dev → main, tags version, creates GitHub Release |
| `.github/workflows/hotfix.yml` | Handles hotfix PRs to main, tags patch release, back-merges to dev |
| `.github/workflows/feature-merge-cleanup.yml` | Deletes feature branch after merge to dev, and removes a leftover feature-context file if the merge bypassed `/mergedev` |
| `.claude/scripts/session-start.sh` | Session startup hook |
| `.claude/scripts/list-skills.sh` | Skill discovery script |
| `.claude/scripts/resolve-feature-name.sh` | Resolves the feature name (slug from `.harness-feature`, else session codename); shared by the hooks, scripts, and workflows |
| `.claude/scripts/set-feature-name.sh` | Names the session's feature: sanitizes a slug, writes `.harness-feature`, commits, and pushes to trigger branch creation |
| `.claude/hooks/prevent-em-dash.sh` | Blocks writes containing U+2014 em dashes |
| `.claude/skills/getting-started/SKILL.md` | Orientation skill: the session-opening flavor question, the skill catalog, the two-review pair |
| `.claude/skills/feature/SKILL.md` | `/feature` skill: the five-phase gated flow (name, grill, spec, tickets, implement, hand over) |
| `.claude/skills/brainstorm/SKILL.md` | `/brainstorm` skill: standalone grilling that writes to the tracker only |
| `.claude/skills/mergedev/SKILL.md` | `/mergedev` skill: merge to dev; owns the merge-conflict discipline and retires the feature context |
| `.claude/skills/review/SKILL.md` | `/review` skill: submit PR for team review, with `/code-review` findings in the body |
| `.claude/skills/release/SKILL.md` | `/release` skill: ship dev to production |
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
| `.claude/agents/docs-updater.md` | Documentation auditor agent (runs during `/mergedev` and `/review`) |
| `.claude/HARNESS.md` | This file |
| `.harness-version` | Version tracking |
| `.claude/traits/*.md` | Stack best practices (managed per `traits:` in `.harness-version`) |

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
automatically during `/mergedev` and `/review`.

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

One template repo ships from the forge
([evolutionary-leadership/harness](https://github.com/evolutionary-leadership/harness));
the variant is chosen by the one-shot `/setup` skill on first run and
recorded in `.harness-version`:

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
variant. The skill uses structured migration files from the forge
(`evolutionary-leadership/harness-forge`) to show you exactly what
changed, filtered by your variant and installed traits. See
`.harness-version` for current version info.

### Version numbering

Harness versions use semver (`MAJOR.MINOR.PATCH`):
- **PATCH** bumps automatically on each feature merge to the forge's
  `dev` branch
- **MINOR** bumps are a developer decision for significant releases
- **MAJOR** is reserved for breaking architecture changes

## License

The Harness Companion is licensed under the **Apache License 2.0**.
See the `LICENSE` and `NOTICE` files in the root of this repository.

The NOTICE file must be preserved in any derivative works or forks.
It attributes this project to its origin:
[The Harness Companion](https://www.harnesscompanion.com)
by Evolutionary Leadership Coöperatie U.A.
