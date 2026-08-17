# 2. Pin TypeScript and ESLint below latest

- **Status**: Accepted
- **Date**: 2026-08-17

## Context

The stack specification says "TypeScript strict" and lists ESLint as the linter
without naming versions, and the project's default is to take the latest release
of everything. At scaffolding time the latest releases were TypeScript 7.0.2 and
ESLint 10.8.1.

Neither is usable yet, for reasons that surface in tooling rather than at install
time:

| Package | Peer range | Consequence |
|---|---|---|
| `typescript-eslint@8.67.0` | `typescript >=4.8.4 <6.1.0` | TypeScript 7 makes `pnpm lint` crash rather than lint |
| `eslint-plugin-react@7.37.5` | `eslint ^3 \|\| ... \|\| ^9.7` | ESLint 10 is outside every published range |

Both packages are transitive dependencies of `eslint-config-next@16.3.1`, so
neither can be dropped without giving up the Next lint config. There is no
stable `typescript-eslint@9`; only `8.67.1-alpha.*` prereleases exist.

`pnpm install` reports these as peer warnings and exits 0, so the failure only
appears when the linter is first run, which is why the foundation spec requires
proving `pnpm typecheck` and `pnpm lint` both execute before any application
code is written.

## Decision

Pin two devDependencies below latest:

- `typescript` at **6.0.3**. Within `typescript-eslint`'s range, and the version
  `eslint-config-next@16.3.1` itself develops against (its own devDependency is
  `typescript@6.0.2`).
- `eslint` at **9.39.5**, the last 9.x, which satisfies `eslint-plugin-react`.

The reasoning is recorded in a `pins` object in `package.json`, because JSON
admits no comments and the constraint has to be visible at the pin rather than
only here.

Every other dependency is taken at latest and pinned exactly, so an upgrade is a
deliberate edit rather than a silent resolution change.

## Consequences

- `pnpm typecheck` and `pnpm lint` both run clean. Verified on an empty project
  before any application code existed.
- TypeScript 7 language features are unavailable. Nothing in the specification
  needs them.
- Two pins to revisit. `typescript` unblocks when `typescript-eslint@9` ships
  stable; `eslint` unblocks when `eslint-plugin-react` supports ESLint 10.
  Dependabot will keep proposing both upgrades, and both should be rejected until
  the peer ranges move. `/deps` should treat a `typescript` or `eslint` major PR
  as blocked-by-upstream rather than as a routine bump.

## Alternatives considered

- **TypeScript 5.9.3 instead of 6.0.3.** Also inside the peer range, but strictly
  older with no compensating benefit, and further from what
  `eslint-config-next` tests against.
- **`typescript-eslint@8.67.1-alpha.4`.** Might widen the range, but taking an
  alpha of the package that gates the entire lint step trades a known constraint
  for an unknown one.
- **Drop `eslint-config-next` and hand-assemble the flat config.** Removes the
  transitive constraint, at the cost of losing the Next-specific rules
  (`@next/next/*`) that catch real App Router mistakes, and leaving nobody
  upstream maintaining the rule set.
