# Testing

## The three tiers

**The file extension picks the runner, so naming is load bearing.** Vitest claims
`*.test.ts`; Playwright claims `*.spec.ts`. A test in the wrong file name is a test
nothing runs.

| Tier | Location | Runner | Needs |
|---|---|---|---|
| Unit | `tests/unit/*.test.ts` | Vitest, project `unit` | nothing |
| Integration | `tests/integration/*.test.ts` | Vitest, project `integration` | one Postgres 16 per run: Docker (Testcontainers), or `TEST_DATABASE_URL` (`scripts/test-db.sh` prints one) |
| E2E | `tests/e2e/*.spec.ts` | Playwright | a running server (the config builds and starts one) |

## Running them

| Command | Runs |
|---|---|
| `pnpm test` | the unit project, in watch mode |
| `pnpm test:unit` | the unit project, once |
| `pnpm test:int` | the integration project, once |
| `pnpm test:run` | both Vitest projects, once |
| `pnpm test:e2e` | Playwright; it builds and boots the app itself |
| `pnpm verify` | `check:docs && typecheck && lint && test:unit && test:int`, in fast-fail order: the cheapest check that can fail runs first |

`vitest.config.ts` declares the two projects; `--project unit` or
`--project integration` selects one on any Vitest command.

## Where a new test goes

| You are testing | Tier | Because |
|---|---|---|
| Grouping, sorting, normalization, a view model, a derived field | Unit | It should already be a pure function. If it is not, extract one |
| A cache helper | Unit | They are plain functions over a `QueryClient`: no DOM, no server |
| A key shape, or a SQL fragment | Unit | `PgDialect.sqlToQuery` compiles a fragment without a database |
| An env accessor or a flag gate | Unit | `resetEnvCache()` lets a test re-parse a mutated `process.env` |
| A query, a constraint, a cast, a transaction | Integration | Only a real Postgres answers these honestly |
| The cross-user boundary | Integration | Foreign keys and WHERE clauses are the thing under test |
| The seed's gating or idempotency | Integration | It runs as a SUBPROCESS, so its own env gating is part of the test |
| A whole user journey | E2E | And only one. See below |

**Default down a tier.** If a test can be a unit test, it must be. This is why so
much of the domain lives in `src/lib/notes/view.ts` as pure functions.

## Property tests

`fast-check` covers invariants that must hold over arbitrary data, checked against a
compute-on-read **oracle** that derives the answer by a DIFFERENT mechanism. Two
independent derivations agreeing is the property; asserting an implementation against
itself is not.

| Invariant | Where |
|---|---|
| Stored `word_count` equals `countWords(body)` | `tests/unit/note-view.test.ts` (pure), `tests/integration/notes-repository.test.ts` (persisted) |
| An excerpt never exceeds its budget and never contains a newline | `tests/unit/note-view.test.ts` |
| A reorder preserves the id set and yields strictly increasing positions | `tests/unit/note-view.test.ts` |
| A normalized title is never empty | `tests/unit/note-view.test.ts` |

## The integration harness

One Postgres per run, one database per file.

`tests/integration/helpers/global-setup.ts` runs once, before the project's files:
it adopts the server at `TEST_DATABASE_URL` or starts one Testcontainers Postgres
16, applies every migration from scratch into a template database
(`template_app`), and exports the server URL to the workers, through `process.env`
(the workers fork after it runs, so they and any subprocess a test spawns inherit
it) and through Vitest's `provide()`.

`tests/integration/helpers/database.ts` is what each file calls in `beforeAll`:
`CREATE DATABASE test_<id> TEMPLATE template_app`, dropped again in `afterAll`.
Files never share a database, which is why the project runs them in parallel
(`fileParallelism: true`). Between tests, `TRUNCATE ... RESTART IDENTITY CASCADE`
and a re-seed of the fixture users. Fixture rows reference real user ids and the
foreign keys are real. `ctx.url` is the file's own database, for anything that runs
as a subprocess: `tests/integration/seed.test.ts` hands it to `pnpm seed` as
`DATABASE_URL`.

`TEST_DATABASE_URL` skips Testcontainers entirely, which is what makes the tier
runnable with no Docker daemon. Its role needs `CREATEDB`; the database named in
the URL is only ever connected to, never migrated or truncated. Two runs against
one server at the same time collide on the template name. `scripts/test-db.sh`
prints a fitting URL when `initdb` is installed: it starts one throwaway cluster
under `${TMPDIR:-/tmp}` (trust auth on `127.0.0.1` only, fsync off), adopts it on
the next call, runs it as an unprivileged user when invoked as root, and
`bash scripts/test-db.sh stop` removes it:

```
export TEST_DATABASE_URL=$(bash scripts/test-db.sh)
pnpm test:int
```

## Fakes for third parties

The foundation calls no third party over the network (Postgres is real in the
integration tier; Better Auth is a library). When the first one arrives, its client
gets an interface in `src/` and one stateful fake in
`tests/integration/helpers/fakes/<name>.ts`, one file per third party, built on
`recordingFake` from `tests/integration/helpers/fakes/recording.ts`: the fake holds
the state the real service would and records every call in order, across fakes, so
a test asserts on effects and sequence rather than on mocks. A new client method is
a one-file edit: add it to the fake. `tests/unit/recording-fake.test.ts` pins the
pattern.

## E2E scope

One journey covers the whole optimistic loop: demo sign in, create, edit with its
derived fields updating, archive, undo, commit, scope ejection, and delete through
the confirm dialog. Plus two short guards (cancelling the dialog, redirect when
signed out).

E2E is for journeys, not coverage. It earns its cost by catching wiring the other
tiers cannot see: it found both bugs fixed in ADR 0004, where the unit tests for the
cache helpers and for the undo hook were each correct in isolation.

Cards carry `data-note-id` because a `hasText: title` filter stops matching once a
card enters edit mode (the title moves into an input's *value*, which is not text
content).

`PLAYWRIGHT_CHROMIUM_PATH` points Playwright at an existing Chromium binary, for
images that ship browsers whose build number does not match the pinned
`@playwright/test`. Unset locally, where `pnpm exec playwright install` is normal.

`E2E_PORT` defaults to 3210, not 3000, so a run does not collide with a `pnpm dev`
server. `playwright.config.ts` derives both the base URL and the `webServer` PORT
from it, so it moves them together.

**In a sandbox, confirm the app can fetch its own origin before the Playwright
tier.** A server-side fetch from the app to its own origin (Next and Better Auth
both make them) can hang rather than fail where an outbound proxy captures loopback
traffic. The run then times out on `webServer`'s readiness `url` or on the first
page, and looks like a broken app. With the built app running, from the same shell:

```
curl -sS --max-time 5 http://localhost:3210/login
```

When that hangs, the environment is the problem, not the code: run the tier
elsewhere (locally, or against a deployed preview).

## What runs where

| Tier | Where |
|---|---|
| Unit | Every PR: the `tests:` line in `.harness-version` (`pnpm test:unit`) runs in its own CI job, next to the `check:` line's job; `/implement` runs both; `pnpm verify` locally |
| Integration | `pnpm verify` locally, and `/implement`'s full check. The CI job that runs `tests:` has a Postgres 16 service and exports `TEST_DATABASE_URL`, so widening the line to `pnpm test:unit && pnpm test:int` is a one-line edit of `.harness-version` |
| E2E | By hand, `pnpm test:e2e`, before a change to the journey is pushed. Never in the gate |

**A green PR check means the code typechecks, lints, the docs are consistent, and
the unit tier passed.** It does not mean the integration or e2e tiers ran. Why the
line is drawn there, and why the earlier "CI runs no tests" rule was retired:
[run the unit tier in CI, the integration tier with a service container, the e2e tier by hand](./decisions/0008-run-the-unit-tier-in-ci-and-the-integration-tier-with-a-service-container.md).
