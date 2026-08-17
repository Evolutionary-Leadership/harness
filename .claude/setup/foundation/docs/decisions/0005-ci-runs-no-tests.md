# 5. CI runs no tests, and a green PR check does not mean tests passed

- **Status**: Accepted
- **Date**: 2026-08-17

## Context

The harness runs the command in `.harness-version`'s `check:` field on pull
requests to `dev` and `main`, and auto-merge waits for it. The obvious thing to put
there is the full verify chain, including tests.

The GitHub Actions runner this harness uses **has no Docker daemon**. The
integration tier boots a Postgres 16 container per file through Testcontainers, so
`pnpm test:run` on that runner fails for want of a database rather than for want of
correct code. A test suite that fails for infrastructural reasons is worse than no
suite in CI: it trains everyone to ignore red, and the first genuine failure is
ignored with it.

`TEST_DATABASE_URL` is a real escape hatch, and a hosted Postgres could be wired
into CI. That trades a fast, hermetic check for a shared mutable database that the
integration harness `TRUNCATE`s between tests, which is a footgun pointed at
whatever else might use it.

## Decision

CI runs the checks that need nothing but the repository:

```
check: pnpm typecheck && pnpm lint && pnpm check:docs
```

Tests run locally, and `pnpm verify` is the full chain
(`typecheck && lint && check:docs && test:run`) that a developer or agent runs
before pushing.

Because this is genuinely surprising, it is stated in three places a reader will
actually hit: `CLAUDE.md`, `README.md`, and `docs/TESTING.md`. **A green PR check
means the code typechecks, lints, and the docs are consistent. It does not mean any
test ran.**

## Consequences

- CI is fast and never flaky, and it still blocks a merge on the things it does
  check. Broken docs block auto-merge exactly like a type error, which is the only
  reason docs stay fresh.
- Nothing mechanically prevents a merge that breaks the tests. `pnpm verify`
  before pushing is a discipline, not an enforcement, and it is named in the
  definition of done for that reason.
- The unit tier needs no Docker at all and could run in CI today. It is left out
  deliberately: a `check:` line that runs some tests is the worst of the options,
  because "tests ran and passed" becomes true enough to be misread as the whole
  suite having passed.
- If the runner ever gains Docker, or the project adds a CI service container,
  this ADR should be superseded rather than edited, and `check:` extended to
  `pnpm verify`.

## Alternatives considered

- **Run only the unit tier in CI.** See above. The ambiguity it creates about what
  green means costs more than the coverage it buys, given `pnpm verify` already
  covers it locally.
- **A hosted Postgres for CI.** A shared database that gets truncated between test
  files, reachable from CI, is a hazard, and it makes CI depend on a third party's
  uptime for every merge.
- **Skip integration tests when Docker is absent.** Silent skips report green while
  testing nothing, which is the failure mode this ADR is most concerned with. The
  harness raises a clear error instead when it can reach neither Docker nor
  `TEST_DATABASE_URL`.
