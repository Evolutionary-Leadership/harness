# Notes

A notes and knowledge base app that never makes you wait. Next.js 16 App Router,
PostgreSQL via Drizzle, Better Auth, and a fully optimistic TanStack Query UI.

Product vision and the explicit "not built yet" list: [`docs/PROJECT.md`](docs/PROJECT.md).

## Running it locally

Needs Node 22.11+, pnpm, and a PostgreSQL 16 you can reach.

```bash
pnpm install
cp .env.example .env.local        # then edit DATABASE_URL and BETTER_AUTH_SECRET
openssl rand -base64 32           # a value for BETTER_AUTH_SECRET

pnpm db:migrate                   # works against a completely empty database
pnpm seed                         # needs SEED_DATA=true; creates the demo account
pnpm dev                          # http://localhost:3000
```

With `SHOW_DEMO_LOGIN=true` the login page offers a one click sign in as the seeded
demo user, so you never need to invent credentials to look around.

Point the browser at `localhost`, not `127.0.0.1`: Better Auth trusts the former by
default and treats the latter as a foreign origin.

## Scripts

| Script | Does |
|---|---|
| `pnpm dev` / `build` / `start` | Next.js dev server, production build, production server |
| `pnpm verify` | **The real gate.** `typecheck && lint && check:docs && test:run` |
| `pnpm typecheck` / `lint` | `tsc --noEmit`, eslint |
| `pnpm test` / `test:run` | Vitest (unit + integration), watch and once |
| `pnpm test:e2e` | Playwright. Builds and boots a server itself |
| `pnpm db:generate` / `db:migrate` / `db:check` / `db:studio` | Drizzle schema and migrations |
| `pnpm seed` | Idempotent seed, gated on `SEED_DATA=true`, refuses to run on production |
| `pnpm check:docs` | Mechanical documentation freshness checks |

This is a pnpm project (pinned via `packageManager`). Never run `npm install`, and
never commit a `package-lock.json`.

## Tests

Three tiers, and **the file extension picks the runner**: Vitest claims `*.test.ts`,
Playwright claims `*.spec.ts`.

| Tier | Location | Needs |
|---|---|---|
| Unit | `tests/unit/*.test.ts` | nothing |
| Integration | `tests/integration/*.test.ts` | Docker, or `TEST_DATABASE_URL` pointing at a throwaway Postgres 16 |
| E2E | `tests/e2e/*.spec.ts` | nothing; the config builds and starts the app |

## CI runs no tests

Worth knowing before you trust a green checkmark. The CI runner has no Docker
daemon, so the pull request check is:

```
pnpm install --frozen-lockfile && pnpm typecheck && pnpm lint && pnpm check:docs
```

**A green PR check means the code typechecks, lints, and the docs are consistent. It
does not mean any test ran.** Run `pnpm verify` before pushing. Reasoning and
rejected alternatives: [ADR 0005](docs/decisions/0005-ci-runs-no-tests.md).

## Deployment

Railway, built by Railpack with no Dockerfile. `production` deploys from `main`,
`preprod` from `preprod`, and every feature branch gets its own ephemeral environment with
its own isolated Postgres. Migrations run automatically on deploy.

Wiring the environment variables takes about two minutes:
[`docs/runbooks/railway-setup.md`](docs/runbooks/railway-setup.md). Feature
environments need zero configuration.

## Documentation

Most readers here are AI agents in fresh sessions, so the docs are structured as
persistent memory rather than as a linear read.

Start at [`docs/README.md`](docs/README.md), the index naming every doc and what it
owns. [`CLAUDE.md`](CLAUDE.md) is a router: conventions, one-way decisions,
guardrails, and a table mapping "what you are doing" to "what to read".

## License

Apache 2.0. See [`LICENSE`](LICENSE) and [`NOTICE`](NOTICE).
