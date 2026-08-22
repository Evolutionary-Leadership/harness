# Testing

## The three tiers

**The file extension picks the runner, so naming is load bearing.** Vitest claims
`*.test.ts`; Playwright claims `*.spec.ts`. A test in the wrong file name is a test
nothing runs.

| Tier | Location | Runner | Needs |
|---|---|---|---|
| Unit | `tests/unit/*.test.ts` | Vitest | nothing |
| Integration | `tests/integration/*.test.ts` | Vitest | Docker (Testcontainers Postgres 16) or `TEST_DATABASE_URL` |
| E2E | `tests/e2e/*.spec.ts` | Playwright | a running server (the config builds and starts one) |

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
| That a Better Auth model has a table | Unit | The adapter resolves models lazily, so a missing one is invisible until a request hits it. `tests/unit/auth-schema.test.ts` |
| An MCP tool's output, or the endpoint's auth gate | Integration | The gate is HTTP behaviour: status, challenge headers, discovery documents |
| The OAuth authorization chain | E2E | Only a browser carries the signed authorization query across redirects |

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

`tests/integration/helpers/database.ts`. One container per file
(`fileParallelism: false` in `vitest.config.ts`, so N files do not mean N
simultaneous containers), all migrations applied from scratch, and a
`TRUNCATE ... RESTART IDENTITY CASCADE` between tests followed by re-seeding the
fixture users. Fixture rows reference real user ids and the foreign keys are real.

`TEST_DATABASE_URL` is a documented escape hatch: point it at any reachable
Postgres 16 and Testcontainers is skipped entirely, which is what makes this tier
runnable with no Docker daemon. **Never point it at a database holding real data:
the harness truncates every table.**

`tests/integration/seed.test.ts` REQUIRES `TEST_DATABASE_URL`, because it runs
`pnpm seed` as a subprocess and a subprocess cannot reach a container URL held only
in the test process. It says so in its own error message.

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

## Testing the MCP endpoint

Both MCP tiers build requests with `tests/helpers/mcp-request.ts` rather than
by hand, and that is not a convenience.

The endpoint serves protocol revision 2026-07-28 only, and a conforming
request needs the per-request `_meta` envelope AND the `Mcp-Method` /
`Mcp-Name` routing headers. A request missing them is classified as
2025-era. Under the SDK's default that request is quietly served by the
legacy fallback, so a hand-rolled test can pass while exercising a path the
endpoint does not actually serve. That happened here, and the shared helper
plus `legacy: "reject"` in the tests is the fix.

`tests/e2e/mcp-oauth.spec.ts` registers a client, walks authorize and
consent in the browser, exchanges the code with PKCE, and calls a tool with
the resulting token. It registers as `application_type: "native"`, because a
`web` client is held to https redirect URIs that a loopback test cannot
provide.

## What CI does NOT run

**CI runs no tests.** The runner has no Docker daemon, so `.harness-version`'s
`check:` line is:

```
pnpm install --frozen-lockfile && pnpm typecheck && pnpm lint && pnpm check:docs
```

**A green PR check means the code typechecks, lints, and the docs are consistent. It
does not mean any test ran.** Full reasoning and the alternatives in ADR 0005.

`pnpm verify` is the real gate, run before pushing:

```
pnpm typecheck && pnpm lint && pnpm check:docs && pnpm test:run
```

`pnpm test:e2e` is separate, because it builds and boots a server.
