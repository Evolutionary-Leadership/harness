# CLAUDE.md Snippet: Feature Development Workflow

Add the following to your project's `CLAUDE.md`. Adapt project-specific details.

---

## Harness infrastructure

This project's CI/CD was set up by the
[Harness Companion](https://www.harnesscompanion.com). Consult
`.claude/HARNESS.md` for the managed-file classes and the coordination
contract; `.claude/harness-manifest.json` lists every harness-managed file
(replaced on upgrade, so never edited here).

## Documentation model

**`CLAUDE.md` is a router, not an encyclopedia.** Nearly every reader of this
repo's docs is an AI agent starting a fresh session with no memory, and this
file is the only part that loads automatically, on every session, whether or
not the session needs it. Its budget is **300 lines**. It holds only:
conventions, one-way decisions, the definition of done, the don't-touch list,
writing rules, and the map below. **A catalog section (routes, tools, tables,
env vars, components) belongs in `docs/architecture/`, not here.** Detail is
retrieved on demand, not preloaded.

### Map: which doc to read for which work

| Working on | Read |
|---|---|
| Anything, first | `docs/README.md` (the index-manifest: every doc, what it owns) |
| A subsystem's routes, tools, tables, or jobs | `docs/architecture/<subsystem>.md` |
| Why something is built this way | `docs/decisions/` (numbered decision records) |
| An operational procedure or incident | `docs/runbooks/` |
| What a domain term means | `docs/GLOSSARY.md` |
| Auth, secrets, limits, untrusted input | `docs/SECURITY.md` |
| Where a new test goes, what CI skips | `docs/TESTING.md` |

Rules that hold it together:

- **One home per fact.** When a fact moves, delete the old copy in the same
  pull request. Two plausible answers to the same question is the failure
  this layout exists to prevent.
- **Code is truth for WHAT, docs for WHY and WHERE.** Restating code is a
  defect, not thoroughness.
- **Accepted decision records are append-only.** Supersede, never rewrite.
  Leave an `ADR NNNN` comment in the module a decision governs so grep
  reaches the rationale from the code.
- **Historical docs are frozen.** Corrections to a retrospective or handoff
  go in as bracketed dated additions; a hook refuses any other edit to a doc
  whose index row says `Frozen: Yes`. A fully superseded doc is deleted, not
  archived: git history is the archive.
- **Freshness is mechanical.** `node scripts/check-docs.mjs` fails on broken
  links, unindexed docs, `sources:` globs matching nothing, dangling decision
  references, and surface tables whose row count no longer matches the code
  (a warning locally, an error on the PR run). `--diff <ref>` prints which
  docs a diff implicates; the docs-updater agent works that scope.

Run `/document` to write a decision record, audit the diff, or find where a
fact goes.

## Definition of done

A change is done when the code works **and** its owning doc is updated in the
same pull request:

| You changed | Update |
|---|---|
| A migration or schema | The data-model doc in `docs/architecture/` |
| A route, tool, command, or event | That subsystem's surface table |
| An environment variable | `.env.example`, with a comment |
| An invariant others must respect | `CLAUDE.md`, plus a decision record when the tradeoff is not obvious |
| A domain term | `docs/GLOSSARY.md` |
| Auth, secrets, limits, input trust | `docs/SECURITY.md` |
| A test tier, runner, or convention | `docs/TESTING.md` |
| Any new doc file | A row in `docs/README.md` |

A cosmetic refactor (rename, extract, reformat) needs **no** doc change:
documenting it would restate what the code already says.

## Writing rules

For prose aimed at agent readers:
- Lead with the invariant or the trap, not with narrative
- Never restate what the code says
- Name files and exports in backticks with every claim
- Prefer short tables to paragraphs
- Keep grep anchors stable (decision ids, glossary terms, headings).
  Renaming a heading breaks a future session's search
- When a fact moves, leave no copy behind
- Never use em dashes (U+2014): commas, colons, semicolons or parentheses
  instead. A PreToolUse hook blocks any write containing one (`Write`,
  `Edit`, a `Bash` command carrying a message or heredoc, the GitHub MCP
  write tools); `scripts/strip-em-dash.sh` cleans generated text on stdin

## Avoiding stream timeouts

The "API Error: Stream idle timeout, partial response received" error
fires when the API stream stays silent for too long mid-response. The
harness sets `API_TIMEOUT_MS=600000` and `CLAUDE_CODE_MAX_RETRIES=5` in
`.claude/settings.json` (the retry envelope: ten minutes of headroom per
response, five retries for transient blips). Claude cannot detect a pending
timeout from inside a turn, so the rest is habits that keep a turn from
going quiet: cap noisy commands with `| head` or narrow paths, prefer `Read`
with `offset`/`limit` over whole large files, break large writes into
several `Edit` calls, run `/compact` at natural seams rather than under
context pressure, and prefer parallel small tool calls to one huge
sequential one. If a timeout still fires, the next prompt usually completes
the work; check status.claude.com if it persists across sessions.

## The three branches

`main` and `preprod` carry code. `coordination` is an orphan branch that
carries none, is never merged, and holds only what exists nowhere else yet:
reserved decision-record numbers (`/document adr` claims one before writing
the file, as `max(numbers on preprod, numbers claimed) + 1`, so `preprod`
stays the source of truth), the change-key counter, and each in-flight
feature's touched-set record, which `journey.sh` writes as the feature
moves (`.claude/HARNESS.md`, "The touched set"). Everything there is
advisory except the change-key mint: missing or unreachable, a session
carries on with a warning, and CI's docs checker still fails a duplicated
number. `harness-bootstrap.yml` creates whatever is missing; never touch
the branch by hand.

## Feature development workflow

The full lifecycle from idea to merged feature is automated via GitHub Actions.

### 0. Say what kind of session this is

Every session starts by stating its flavor explicitly; if you do not,
Claude asks before doing anything else:

- **`/chat`**: talk it through, nothing is written.
- **`/brainstorm <topic>`**: a relentless interview to stress-test an
  idea. Writes to the issue tracker only, never the repo; ends in
  nothing, an idea issue, or straight into `/feature`.
- **`/feature <description>`** (or `/feature #<idea-issue>`): build it,
  through the gated flow below.

Describing something buildable is the input to `/feature`, not a request
to start building.

### 1. Building a feature: size it, then grill before you build

`/feature` does NOT start coding on invocation. Phase 0 captures the change
(title, description, why), mints its change key from `change-prefix:` in
`.harness-version` (required: without the line `/feature` stops here and
says so; `registry: off` skips the registry lookup), opens its work item,
names the branch (`set-feature-name.sh`), creates the feature context and
**sizes the change**: `S`, `M` or `L` against the rubric in `/feature`
(`### Size`), stated with its reason in the phase 0 closing block, on the
work item and in the touched-set record. The tier decides which phases run:
S goes from a plan-and-go paragraph straight to phase 4; M takes one grill
and one plan (spec and tickets together); L takes the full flow (1a
challenge the why, 1b `/grilling` + `/domain-modeling` until the frontier is
empty, 1c assess the impact, 1d decide, 2 `/to-spec`, 3 `/to-tickets`). One
word from the user overrides the tier; it may go up mid-run, never down;
`--quick` means "force S". Phase 4 is `/implement`: build the frontier ticket
by ticket, `/tdd` at agreed seams, then the full check and `/code-review`
(one merged reviewer for S, two axes for M and L), with the docs-updater
dispatched in the same turn on the scope `check-docs.mjs --diff` names.
Phase 5 pushes and chooses the exit: `/to-preprod`, `/review` or `/release`.

**Two ways to say "stop asking me".** In a grilling round, the standing
option grants **grill autonomy**: take the recommended answer on every
remaining question of that grill, breaking out only for a one-way decision
or a guess. At the decide gate, "go all the way to implement" grants **phase
autopilot**: advance the later gates without stopping, and stop at phase 5.
Separate switches; neither survives the session, neither ever runs an exit.

**`/feature --ship <description>` runs unattended to a tagged release on
`main`.** A person typed the flag about this session, so it is release
authority; the run answers its own gates, records every verdict as a
supervised run would, and chains `/to-preprod` then `/release`, reporting
the blast radius. A block still stands the session down. Without the flag,
never advance a gate on silence, and never skip a phase the tier runs.

Every phase writes the feature's journey position into its touched-set
record in one call (`bash .claude/scripts/journey.sh phase <position>
"<sentence>"`, pushed with the branch; `journey-sync.yml` mirrors it onto
`coordination`), so a person or the Product Cockpit can see where it is;
`.claude/JOURNEY.md` is the one home for what each position means.

Throughout, the **feature context** (`.harness/feature-context/<slug>.md`,
contract in `.claude/HARNESS.md`) is kept current: it is how a colleague
picks this feature up tomorrow with `/continue` and lands mid-flow with the
reasoning intact. A resumed session re-enters the flow from the tracker
artifacts plus the feature context, not from memory.

### 2. Pushing code

Push to the `claude/` branch; the GitHub Action merges it into the feature
branch.

### 3. Merging to preprod

Use `/to-preprod` or say "merge to preprod". This writes `.pr-description.md`,
commits, and pushes. The GitHub Action creates a PR and merges it once the
PR's `check` run (and `tests` run, when configured) is green.
`/to-preprod` also retires the feature context and the touched-set record;
neither reaches `preprod`.

### 3b. Submitting for review (instead of auto-merge)

Use `/review` to create a PR without auto-merge. The PR stays open for
team review, carrying the `/code-review` findings and the spec link.
Reviewers are assigned from `.harness-version` if configured. When the
review is approved, land it with `/to-preprod` (it reuses the open PR);
merges go through `/to-preprod`, not the GitHub merge button.

Two things are called review: `/code-review` is the agent review of the
diff (end of `/feature` phase 4); `/review` is the step that requests humans.

### 4. Automatic cleanup

When auto-merge succeeds, `claude-to-feature-branch.yml` deletes the source
`claude/` branch. The PR merge then triggers `feature-merge-cleanup.yml`,
which deletes the feature branch.

**Gotcha:** Don't push to a merged branch. After `/to-preprod`, both branches
are deleted remotely; pushing again re-creates everything from scratch. To
continue a change after its merge, start from `origin/preprod` and name a new
slug under the same key (`/feature`). To recover from a failed to-preprod run,
the push must change `.pr-description.md` (`/to-preprod`, "Recovery").
**`/release` after `/to-preprod` in the same chat is fine**: it works on
`preprod` and never pushes the `claude/` branch. Run from an unmerged
`claude/` branch it does both: one confirmation, the merge, a wait for
`preprod` to settle, then the release.

## Releasing to production

Use `/release` (with optional `major`, `minor`, or `patch` argument) to ship
preprod to production: the workflow merges `preprod` into `main` directly,
tags the version, and generates a GitHub Release with notes (a PR only when
the direct push is refused). Its authority is one of three things:
`release` in `agent-authority:`, a user asking in the turn, or `--ship` on
the `/feature` run that chained here. `/hotfix` and `/rollback` take the
first two only.

**Every release reports its blast radius**, on any branch and under
`--quick` and `--ship` too: everything in the range from the last tag to
`preprod`, split into your commits and the ones riding along. Releasing
ships all of `preprod`, not just your feature, and that is the number one way
a colleague's half-finished work reaches production. For emergencies, use
`/hotfix` to go directly from main with a fast-track patch release.

## CI checks

The gate is the `check:` and `tests:` lines in `.harness-version`;
`/implement` runs both.

```
check: node scripts/check-docs.mjs && npm run lint
tests: npm test
```

Keep `node scripts/check-docs.mjs` in the chain: it makes broken docs block
auto-merge exactly like a type error, which is the only reason docs stay
fresh, with no dependencies, in under a second. `check:` runs on every
`claude/**` code push and on the PR; `tests:` runs in its own job with a
Postgres service beside it; the PR run is the gate (`.claude/HARNESS.md`).

## Team configuration

Optional `.harness-version` fields:

```
reviewers: teammate1, teammate2
registry: off
agent-authority: release
```

`reviewers:` is who `/review` asks. `registry: off` skips the registry lookup
at Capture. `agent-authority:` grants a session the production-reaching exits
(`release`, `hotfix`, `rollback`) for an unattended run without `--ship`; the
owner's line, never written by a session.

## Available skills

Run `/getting-started` for orientation, or use these directly: `/feature`
(the tiered, gated flow; `--ship` runs it unattended to a release),
`/brainstorm` (stress-test an idea; tracker only), `/to-preprod` (merge to
preprod), `/review` (PR for team review), `/code-review` (agent review of
the diff), `/release` (ship preprod to production, or merge and ship in one
go), `/hotfix`, `/rollback`, `/status`, `/changelog`, `/deps`, `/continue`
(resume a feature, context intact), `/document` (a decision record, a docs
audit, or the one home for a fact), `/chat` (think without modifying the
repo; a pure chat session pushes nothing) and `/endchat` (delete the
`feature/<name>` branch a `/chat` session that pushed left behind). The
technique skills the flow chains (`/grilling`, `/domain-modeling`,
`/to-spec`, `/to-tickets`, `/implement`, `/tdd`, `/diagnosing-bugs`,
`/codebase-design`, `/writing-for-agents`) are also usable directly; each
skill's `SKILL.md` under `.claude/skills/` is its full description.

## Dependency management

Dependabot (`.github/dependabot.yml`) opens PRs for outdated dependencies.
When you add a package ecosystem (npm, pip, Docker, Bundler), add its entry
there so Dependabot monitors it.
