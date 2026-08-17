# 3. NODE_ENV is a runtime switch, not an environment label

- **Status**: Accepted
- **Date**: 2026-08-17

## Context

Three environments deploy from this repository: `production` (from `main`), `dev`
(from `dev`), and one ephemeral environment per feature branch, duplicated from
`dev`.

All three run **`NODE_ENV=production`**, and must. `NODE_ENV` is what React, Next,
and much of npm read to decide whether to strip development warnings, enable
production optimizations, and pick minified builds. A preview environment running
`NODE_ENV=development` would be a different artifact to the one production runs,
which defeats the point of having a preview. `development` is correct only locally
under `next dev`.

The consequence is easy to state and easy to forget: **`NODE_ENV` cannot answer
"is this production"**, because it says `production` on dev and on every feature
environment too. Any guard written as `if (process.env.NODE_ENV === "production")`
is not a production guard, it is a "not running locally" guard, and the two differ
in exactly the case that matters.

This is not hypothetical. The seed script must refuse to run on production and
must run happily on dev and on feature environments. A `NODE_ENV` check would
refuse everywhere and the previews would arrive empty, or, if inverted, would run
against production data.

## Decision

`NODE_ENV` is used for nothing but its intended purpose: a runtime switch that
frameworks read. No application code branches on it.

"Which environment is this" is answered by **`RAILWAY_ENVIRONMENT_NAME`**, which
Railway injects with the environment's actual name. `src/lib/env.ts` exposes the
single accessor:

```ts
export function isProductionEnvironment(): boolean {
  return getEnv().RAILWAY_ENVIRONMENT_NAME === "production";
}
```

`scripts/seed.ts` calls it, and nothing else may re-derive the answer. Locally,
where the variable is absent, it returns `false`, which is the safe direction: a
developer's machine is not production.

## Consequences

- The seed's guard is correct on all four environments (local, feature, dev,
  production), and `tests/integration/seed.test.ts` asserts both halves,
  including the case `NODE_ENV=production` with
  `RAILWAY_ENVIRONMENT_NAME=dev`, which is the one a `NODE_ENV` check gets wrong.
- A grep for `NODE_ENV` in `src/` and `scripts/` should return only the Zod schema
  entry in `src/lib/env.ts`. Anything else is a bug.
- The check is Railway specific. Moving hosts means introducing an equivalent
  variable, and the single accessor is the only thing that changes.
- An environment renamed away from `production` in the Railway dashboard would
  silently make the seed willing to run there. The name is load bearing.

## Alternatives considered

- **A dedicated `APP_ENV` variable.** Explicit and portable, but it has to be set
  by hand on every environment, and a feature environment cloned from dev would
  inherit dev's literal value. The whole design goal is that feature environments
  need zero manual configuration, and a variable Railway already injects
  correctly per environment beats one a human has to remember.
- **Keying on `RAILWAY_PUBLIC_DOMAIN` matching the custom domain.** Works, but
  couples an operational guard to a DNS detail, and breaks the moment the domain
  changes.
