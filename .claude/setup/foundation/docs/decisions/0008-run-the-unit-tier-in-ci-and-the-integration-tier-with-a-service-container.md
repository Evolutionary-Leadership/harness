# 8. Run the unit tier in CI, the integration tier with a service container, the e2e tier by hand

- **Status**: Accepted. Supersedes "CI runs no tests, and a green PR check does not mean tests passed" ([0005](./0005-ci-runs-no-tests.md))
- **Date**: 2026-09-24

## Context

The superseded record kept every test out of CI on one premise: the GitHub
Actions runner has no Docker daemon, so the integration tier (then one
Testcontainers Postgres per file) could not run there, and running only the unit
tier would let "tests passed" be misread as the whole suite having passed.

Neither half holds now.

- The harness runs the `tests:` line of `.harness-version` in a CI job of its
  own, with a Postgres 16 **service container** started for that job alone and
  `TEST_DATABASE_URL` exported to it. A service container is hermetic (created
  with the job, discarded with it), which removes the shared-database hazard the
  old record rejected. `ubuntu-latest` runs Docker besides, but nothing depends
  on that.
- The integration tier boots one Postgres per run, not per file, and each file
  clones a migrated template database (`tests/integration/helpers/global-setup.ts`,
  `tests/integration/helpers/database.ts`). Against a service container that is
  seconds, not minutes.
- The gate is two lines, `check:` and `tests:`, run as two named jobs, so which
  tier ran is visible on the PR rather than inferred from one green tick.

## Decision

| Tier | Runs |
|---|---|
| Unit | in CI on every PR, through `tests: pnpm test:unit`; locally in `pnpm verify` |
| Integration | locally in `pnpm verify`; in CI when the project widens `tests:` to `pnpm test:unit && pnpm test:int`, against the job's service container |
| E2E | by hand, `pnpm test:e2e`, before a change to the journey is pushed; never in the gate |

`/setup` writes `check: pnpm typecheck && pnpm lint && pnpm check:docs` and
`tests: pnpm test:unit`. `pnpm verify` runs the same checks in fast-fail order
(`check:docs && typecheck && lint && test:unit && test:int`), so a local run fails
on the cheapest broken thing first.

The default `tests:` line is the unit tier only. A scaffold's first PR is green in
under a minute, and widening it is a one-line, per-project choice rather than a
harness default that charges every project a container start on every push.

## Consequences

- A green PR check means the unit tier passed. It still does not mean the
  integration or e2e tiers did; `docs/TESTING.md` says which tier runs where, and
  `pnpm verify` before pushing stays in the definition of done.
- A test that fails in CI for infrastructural reasons is a harness bug, not a
  reason to remove the tier: the service container is the harness's to keep
  working.
- `TEST_DATABASE_URL` changed meaning: the role needs `CREATEDB`, and the
  database named in the URL is never migrated or truncated. `scripts/test-db.sh`
  prints a fitting URL on any machine with `initdb`.
- `CLAUDE.md`, `README.md` and `docs/TESTING.md` stated the old rule in three
  places; they now state this one.

## Alternatives considered

- **Keep CI test-free** (the superseded record). Its premise was the runner, and
  the runner changed.
- **Run every tier in CI by default.** Integration adds a container start to every
  push and e2e adds a build and a browser. Both are a per-project choice, made by
  editing `tests:`, not a harness default.
- **Skip integration tests when no database is reachable.** Rejected again for the
  reason the old record gave: a silent skip reports green while testing nothing.
  The tier still raises a clear error naming the two ways to get a database.
