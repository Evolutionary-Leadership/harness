# CLAUDE.md

**This file is a ROUTER, not an encyclopedia.** It is the only doc that loads on
every session, so its budget is 300 lines. Catalogs (routes, tables, variables,
components) belong in `docs/architecture/`. If you are adding a list here, it is in
the wrong file.

Read `docs/README.md` before writing any documentation, and before assuming a fact
is undocumented.

## What this is

A notes and knowledge base app. Next.js 16 App Router, Drizzle on Postgres, Better
Auth, TanStack Query with a fully optimistic UI. Product vision and behaviour live in
`docs/PROJECT.md`, which wins over this file for product questions.

## Map: what you are doing, what to read

| Working on | Read |
|---|---|
| Anything, first | [`docs/README.md`](docs/README.md) (the index: every doc, what it owns) |
| What the product is or should do | [`docs/PROJECT.md`](docs/PROJECT.md) (includes "not built yet") |
| Optimistic cache, query keys, mutations, rollback | [`docs/architecture/optimistic-ui.md`](docs/architecture/optimistic-ui.md) |
| Actions, services, repositories, transactions | [`docs/architecture/server-layers.md`](docs/architecture/server-layers.md) |
| Schema, migrations, seeding, postgres-js traps | [`docs/architecture/data-model.md`](docs/architecture/data-model.md) |
| Environment variables, deploy chain, Next config | [`docs/architecture/configuration.md`](docs/architecture/configuration.md) |
| Preview URLs, per-environment Postgres | [`docs/architecture/railway-environments.md`](docs/architecture/railway-environments.md) |
| Auth, sessions, ownership, input trust, limits | [`docs/SECURITY.md`](docs/SECURITY.md) |
| Where a new test goes, what CI skips | [`docs/TESTING.md`](docs/TESTING.md) |
| Setting up Railway by hand | [`docs/runbooks/railway-setup.md`](docs/runbooks/railway-setup.md) |
| Why something is built this way | `docs/decisions/` (numbered ADRs) |
| What a domain term means | [`docs/GLOSSARY.md`](docs/GLOSSARY.md) |

## Stack

Next.js 16 (App Router, Server Components, Server Actions), React 19, TypeScript
strict, PostgreSQL via Drizzle on the postgres-js driver, Tailwind 4, Zod 4, Better
Auth (database sessions, argon2id), TanStack Query v5, pino, Vitest 4 with
Testcontainers and fast-check, Playwright, dnd-kit. pnpm, Node 22.11+. Railway via
Railpack, no Dockerfile.

`typescript` and `eslint` are pinned BELOW latest. This is deliberate and load
bearing: see the `pins` object in `package.json` and ADR 0002. Do not "fix" them.

## One-way decisions

Changing any of these is a project-wide migration, not a refactor.

| Decision | Consequence |
|---|---|
| The UI is optimistic, and the server is a reconciler | Nothing may block the interaction path on the network |
| Actions never throw; failures are values | `{ ok: true, data } \| { ok: false, error }`, no exceptions |
| Unauthenticated is a VALUE, never a redirect | An optimistic client needs something to reconcile |
| Query key shapes live only in `src/lib/query-keys.ts` | Prefix invalidation and scope ejection both depend on it |
| Repositories are the only code that touches a table | Services take repositories, never the Drizzle client |
| argon2id, database sessions, no cookie cache | Revocation is immediate |
| `NODE_ENV` is a runtime switch, NOT an environment label | "Is this production" reads `RAILWAY_ENVIRONMENT_NAME` (ADR 0003) |
| CI runs no tests | A green PR check is not a passing test suite (ADR 0005) |

## Layer rules

Three layers, dependencies pointing one way only.

| Layer | Path | Must not |
|---|---|---|
| Boundary | `src/app/**/actions.ts`, `src/app/api/**/route.ts` | Contain business rules or SQL |
| Domain | `src/server/services/` | Import the Drizzle client or a schema table |
| Data | `src/server/repositories/` | Know about sessions, Zod, or HTTP |

Every action is built by `defineAction` (`src/lib/action.ts`). There is no second
way. It parses with Zod, requires a session, delegates to a service, and maps errors
to codes.

Executor types state transaction ownership: repositories and service READERS take
`DbExecutor` (so one code path serves the pool and a transaction); service MUTATORS
take `DbClient` (because a mutator owns its transaction boundary).

## Guardrails

Things that have already cost someone a session.

| Guardrail | Why |
|---|---|
| `getDb()` and `getAuth()` are LAZY | `next build` evaluates modules with no `DATABASE_URL`. A module-scope client breaks every build |
| Never bind a JS array as one SQL parameter | postgres-js sends it as a single value: `malformed array literal`. Use `idList()` / `textList()` |
| `idList([])` is `TRUE`, so it matches EVERYTHING | A caller meaning "match nothing" MUST short circuit first |
| Always cast counts: `count(*)::int` | A bigint arrives as a STRING and silently poisons number fields |
| `trustedOrigins: []` REPLACES Better Auth's defaults | Every sign in then fails with `INVALID_ORIGIN`. Spread the key conditionally |
| Better Auth trusts `localhost`, not `127.0.0.1` | Point local and e2e base URLs at `localhost` |
| `agentRules: false` in `next.config.ts` | Next 16 otherwise writes its own block into this file |
| argon2 and pino are in `serverExternalPackages` | Both break if the server bundler traces and inlines them |
| `Algorithm.Argon2id` is written as the number `2` | It is an ambient `const enum`, which `verbatimModuleSyntax` cannot import |
| `next-env.d.ts` is COMMITTED | CI typechecks without building, so nothing regenerates it there |
| Schema files use RELATIVE imports | drizzle-kit bundles them with esbuild and does not resolve the `@/*` alias |
| `runSerializable` retries, so its bodies must be IDEMPOTENT | `ON CONFLICT` inserts, exact-key deletes, caller-generated ids, no side effects outside the database |
| Never `pkill -f <pattern>` to stop a server | A broad pattern matches and kills your own session. Target the pid holding the port |
| Never run `npm install`, never commit `package-lock.json` | This is a pnpm project, pinned via `packageManager` |

## Definition of done

A change is done when all of these hold:

- `pnpm verify` passes (`typecheck && lint && check:docs && test:run`)
- New behaviour has at least one test, at the LOWEST tier that can hold it
- Every external input (form data, request body, search params, env var) is
  validated with Zod at the boundary
- No `console.*` outside `src/lib/logger.ts` (eslint enforces it; scripts and tests
  are exempt)
- No `any`, and no `@ts-expect-error` without a tracked issue
- The owning doc is updated in the same commit (see the table in `docs/README.md`)

**`pnpm verify` is the real gate, not CI.** CI runs
`typecheck && lint && check:docs` only, because the runner has no Docker. A green PR
check does not mean tests passed.

## Schema changes

Edit `src/lib/db/schema/`, then run `pnpm db:generate`. Never edit an applied
migration. Breaking changes use expand and contract. Every environment must be able
to migrate from scratch, because every feature environment starts empty.

## Writing rules

- **Never use em dashes (U+2014).** Use commas, colons, semicolons, or parentheses.
  A PreToolUse hook blocks any write containing one. If a generator emits them,
  disable the generator rather than fighting the hook
- Lead with the invariant or the trap, not with narrative
- Never restate what the code says
- Name files and exports in backticks with every claim
- Prefer short tables to paragraphs
- Keep grep anchors stable (ADR ids, glossary terms, headings)
- When a fact moves, delete the old copy in the same commit

## Harness

This project's CI/CD came from the
[harness-forge](https://github.com/Evolutionary-Leadership/harness-forge) harness.
Read `.claude/HARNESS.md` for which files are harness-managed (they get overwritten
on upgrade) and how to extend them.

Session flavours: `/chat` (nothing is written), `/brainstorm` (the tracker only),
`/feature` (the repo, through five gated phases). Describing something buildable is
the INPUT to `/feature`, not a request to start coding. Run `/getting-started` for
the full skill catalog. Every issue-tracker operation goes through the contract in
[`docs/agents/issue-tracker.md`](docs/agents/issue-tracker.md).

The flow: push to the `claude/` branch, which a GitHub Action merges into
`feature/<name>`; `/to-preprod` opens an auto-merged PR to `preprod`; `/review` opens one
that waits for humans; `/release` ships `preprod` to `main`. After a final push, report
the preview URL with `bash .claude/scripts/get-railway-url.sh`, then confirm
the deploy is serving that push with `bash .claude/scripts/verify-deploy.sh`
(say first that the session stays open to watch the deploy and will report
here when the changes are live).
