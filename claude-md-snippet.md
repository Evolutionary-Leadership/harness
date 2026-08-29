# CLAUDE.md Snippet: Feature Development Workflow

Add the following to your project's `CLAUDE.md`. Adapt project-specific details.

---

## Harness infrastructure

This project's CI/CD was set up by the
[harness-forge](https://github.com/Evolutionary-Leadership/harness-forge)
harness. Read `.claude/HARNESS.md` for details on which files are
harness-managed (don't edit; they get overwritten on upgrade) and how to
extend the setup.

## Documentation model

**`CLAUDE.md` is a router, not an encyclopedia.** Nearly every reader of this
repo's docs is an AI agent starting a fresh session with no memory, and this
file is the only part that loads automatically, on every session, whether or
not the session needs it. Its budget is **300 lines**.

This file holds only: conventions, one-way decisions, the definition of done,
the don't-touch list, writing rules, and the map below. **If you are adding a
catalog section here (a list of routes, tools, tables, env vars, or
components), it belongs in `docs/architecture/`, not here.** Detail is
retrieved on demand, not preloaded.

### Map: which doc to read for which work

| Working on | Read |
|---|---|
| Anything, first | `docs/README.md` (the index-manifest: every doc, what it owns) |
| A subsystem's routes, tools, tables, or jobs | `docs/architecture/<subsystem>.md` |
| Why something is built this way | `docs/decisions/` (numbered ADRs) |
| An operational procedure or incident | `docs/runbooks/` |
| What a domain term means | `docs/GLOSSARY.md` |
| Auth, secrets, limits, untrusted input | `docs/SECURITY.md` |
| Where a new test goes, what CI skips | `docs/TESTING.md` |

Rules that hold it together:

- **One home per fact.** When a fact moves, delete the old copy in the same
  commit. Two plausible answers to the same question is the failure this
  layout exists to prevent.
- **Code is truth for WHAT, docs for WHY and WHERE.** Restating code is a
  defect, not thoroughness.
- **Accepted ADRs are append-only.** Supersede, never rewrite. Leave an
  `ADR NNNN` comment in the module a decision governs so grep reaches the
  rationale from the code.
- **Historical docs are frozen.** Corrections to a retrospective or handoff
  go in as bracketed dated additions. A fully superseded doc is deleted, not
  archived: git history is the archive.
- **Freshness is mechanical.** `node scripts/check-docs.mjs` fails on broken
  links, unindexed docs, `sources:` globs matching nothing, dangling ADR
  references, and surface tables whose row count no longer matches the code.

Run `/document` to write an ADR, audit the diff, or find where a fact goes.

## Definition of done

A change is done when the code works **and** its owning doc is updated in the
same commit:

| You changed | Update |
|---|---|
| A migration or schema | The data-model doc in `docs/architecture/` |
| A route, tool, command, or event | That subsystem's surface table |
| An environment variable | `.env.example`, with a comment |
| An invariant others must respect | `CLAUDE.md`, plus an ADR when the tradeoff is not obvious |
| A domain term | `docs/GLOSSARY.md` |
| Auth, secrets, limits, input trust | `docs/SECURITY.md` |
| A test tier, runner, or convention | `docs/TESTING.md` |
| Any new doc file | A row in `docs/README.md` |

A cosmetic refactor (rename, extract, reformat) needs **no** doc change.
Documenting it would restate what the code already says.

## Writing rules

For prose aimed at agent readers:

- Lead with the invariant or the trap, not with narrative
- Never restate what the code says
- Name files and exports in backticks with every claim
- Prefer short tables to paragraphs
- Keep grep anchors stable (ADR ids, glossary terms, headings). Renaming a
  heading breaks a future session's search
- When a fact moves, leave no copy behind
- Never use em dashes (U+2014). Use commas, colons, semicolons, or parentheses instead. A PreToolUse hook will block any write containing an em dash

## Avoiding stream timeouts

The "API Error: Stream idle timeout, partial response received" error
fires when the API stream stays silent for too long mid-response. The
harness sets `API_TIMEOUT_MS=900000` and `CLAUDE_CODE_MAX_RETRIES=15` in
`.claude/settings.json` so long responses have headroom and transient
network blips get retried. Claude cannot detect a pending timeout from
inside a turn (the stall happens in the API layer), so the rest is
habits that keep any single turn from going quiet for too long:

- Avoid single tool calls that produce huge output. Cap noisy commands
  with `| head` or narrow paths, and prefer `Read` with `offset`/`limit`
  over reading whole large files.
- Break large file writes into multiple `Edit` calls instead of one
  mega `Write`.
- Run `/compact` proactively at natural seams (after finishing a
  sub-task, before starting a long multi-tool sequence) rather than
  waiting for context pressure.
- Prefer parallel small tool calls over a single huge sequential one.

If a timeout still fires, the next prompt usually completes the work;
check status.claude.com if it persists across sessions.

## The three branches

This repository runs on three branches. `main` and `dev` carry code.
`coordination` is an orphan branch that carries none, is never merged, and
shares no history with the other two.

It holds only what exists nowhere else yet. Today that is one thing:
reserved ADR numbers. `/document adr` claims a number there before writing
the file, so two sessions cut from the same `dev` tip cannot pick the same
one; the candidate is always `max(numbers on dev, numbers claimed) + 1`, so
`dev` stays the source of truth and the branch is a cache over it.

Everything on the branch is advisory and nothing blocks on it. If it is
missing or unreachable, a session carries on with a warning. The guarantee
lives in CI, where the docs checker fails on a duplicated number.

You do not need to touch this branch by hand. `harness-bootstrap.yml`
creates whatever is missing and is safe to re-run.

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

Describing something buildable is not a request to start building; it is
the input to `/feature`.

### 1. Building a feature: grill before you build

`/feature` does NOT start coding on invocation. It drives five phases
with a stop-and-ask gate between each one:

0. name and resume (`set-feature-name.sh` slugs the branch, feature
   context created)
1. `/grilling` + `/domain-modeling`: interview until the frontier is
   empty, glossary and ADRs written
2. `/to-spec`: publish the spec to the tracker
   (`docs/agents/issue-tracker.md`)
3. `/to-tickets`: tracer-bullet tickets with blocking edges
4. `/implement`: build the frontier ticket by ticket, `/tdd` at agreed
   seams, full check and `/code-review` at the end
5. push, then choose the exit: `/mergedev`, `/review` or `/release`

**Two ways to say "stop asking me".** In a grilling round, the standing
option grants **grill autonomy**: take the recommended answer on every
remaining question of that grill, breaking out only for a one-way decision
or where the recommendation would be a guess. At the phase 1 gate, the
"go all the way to implement" option grants **phase autopilot**: advance
the phase 2, 3 and 4 gates without stopping, and stop at phase 5. They are
separate switches, neither survives the session, and neither ever runs an
exit.

Never advance a gate on silence, and never skip phases 1 to 3 on your own
judgement. Quick mode (straight to phase 4) requires an explicit
`--quick` or the user saying so in words; you may propose it for a typo
or a config tweak, never take it.

Throughout, the **feature context**
(`.harness/feature-context/<slug>.md`, contract in `.claude/HARNESS.md`)
is kept current: it is how a colleague picks this feature up tomorrow
with `/continue` and lands mid-flow with the reasoning intact. A resumed
session re-enters the flow from the tracker artifacts plus the feature
context, not from memory.

### 2. Pushing code

Push to the `claude/` branch. The GitHub Action merges it into the feature
branch and deletes the source claude/ branch.

### 3. Merging to dev

Use `/mergedev` or say "merge to dev". This writes `.pr-description.md`,
commits, and pushes. The GitHub Action creates a PR and auto-merges it.
`/mergedev` also retires the feature context; it never reaches `dev`.

### 3b. Submitting for review (instead of auto-merge)

Use `/review` to create a PR without auto-merge. The PR stays open for
team review, carrying the `/code-review` findings and the spec link.
Reviewers are assigned from `.harness-version` if configured. When the
review is approved, land it with `/mergedev` (it reuses the open PR);
merges go through `/mergedev`, not the GitHub merge button.

Two different things both called review: `/code-review` is the agent
review of the diff (Standards and Spec axes, runs at the end of `/feature`
phase 4); `/review` is the process step that requests humans.

### 4. Automatic cleanup

When auto-merge succeeds, `claude-to-feature-branch.yml` deletes the source
`claude/` branch. The PR merge then triggers `feature-merge-cleanup.yml`,
which deletes the feature branch.

**Gotcha:** Don't push to a merged branch. After `/mergedev`, both branches
are deleted remotely. Pushing again re-creates everything from scratch.

**`/release` after `/mergedev` in the same chat is fine.** The release skill
works on `dev` (stash, switch, commit, push, return) and never pushes the
`claude/` branch, so it does not re-trigger feature branch creation. No
need to start a new chat for a release.

**Or skip the pair.** `/release` run from an unmerged `claude/` branch does
both: it asks one confirmation, merges to `dev`, waits for `dev` to settle,
then ships. See "Releasing to production" below.

## Releasing to production

Use `/release` (with optional `major`, `minor`, or `patch` argument) to ship
dev to production. This creates a release PR from `dev` → `main`, tags the
version, and generates a GitHub Release with notes.

**`/release` knows where you ran it from.** On an unmerged `claude/` branch
it runs the whole chain: merge to `dev`, wait until `dev` settles, then
release. It asks one confirmation first, because taking a feature straight
to production is not the same act as releasing reviewed work. `--quick`
skips that question when you have already decided.

**Every release reports its blast radius**, on any branch and under
`--quick` too: everything in the range from the last tag to `dev`, split
into your commits and the ones riding along. Releasing ships all of `dev`,
not just your feature, and that is the number one way a colleague's
half-finished work reaches production. For emergencies, use
`/hotfix` to go directly from main with a fast-track patch release.

## CI checks

Configure CI checks by adding a `check:` field to `.harness-version`:

```
check: node scripts/check-docs.mjs && npm test && npm run lint
```

Keep `node scripts/check-docs.mjs` in the chain: it makes broken docs block
auto-merge exactly like a type error, which is the only reason docs stay
fresh. It has no dependencies and runs in under a second.

When set, PRs to dev (and main) run the check command, and merges wait for
checks to pass. See `.claude/HARNESS.md` for prerequisites.

## Team configuration

Optional `.harness-version` fields:

```
reviewers: teammate1, teammate2
check: node scripts/check-docs.mjs && npm test && npm run lint
```

## Available skills

Run `/getting-started` to see all skills, or use these directly:
- `/feature`: build a feature through the five-phase gated flow
- `/brainstorm`: stress-test an idea; writes to the tracker only
- `/mergedev`: merge to dev (auto-merge)
- `/review`: submit PR for team review
- `/code-review`: two-axis agent review of the diff (Standards, Spec)
- `/release`: ship dev to production, or merge and ship in one go from an
  unmerged feature branch
- `/hotfix`: emergency production fix
- `/status`: team dashboard
- `/changelog`: generate changelog
- `/deps`: handle Dependabot PRs
- `/continue`: resume an in-progress feature, feature context intact
- `/rollback`: revert bad deploy
- `/document`: write an ADR, audit docs against the diff, or find the one
  home for a fact (`/document adr <title>`, `/document check`,
  `/document <topic>`)
- `/chat`: think and brainstorm without modifying the repo (a pure chat
  session pushes nothing, so it usually leaves no `feature/<name>` branch to
  clean up; only run `/endchat` if the session pushed at some point)
- `/endchat`: clean up after `/chat` (deletes the orphaned `feature/<name>`
  branch left behind by a session that pushed, and switches local back to
  `dev`)

The technique skills the flow chains (`/grilling`, `/domain-modeling`,
`/to-spec`, `/to-tickets`, `/implement`, `/tdd`, `/diagnosing-bugs`,
`/codebase-design`, `/writing-for-agents`) are also usable directly; see
`/getting-started` for the full catalog.

## Dependency management

Dependabot is configured in `.github/dependabot.yml` to automatically check
for outdated dependencies and open PRs to update them. When you add a new
package ecosystem to the project (e.g., npm, pip, Docker, Bundler), add a
corresponding entry to `.github/dependabot.yml` so Dependabot monitors it.


## Stack best practices

If you have installed managed traits via the harness, add this line:

```
Read `.claude/traits/` for stack-specific best practices before writing code.
```

Trait files in `.claude/traits/` are managed by the harness and updated via
`/harness-upgrade`. Configure which traits to track in `.harness-version`:

```
traits: nodejs, typescript, express, vitest, eslint, pnpm
```
