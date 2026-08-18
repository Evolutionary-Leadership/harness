---
sources:
  - src/lib/env.ts
  - .env.example
  - railway.json
  - next.config.ts
---

# Configuration

Every environment variable is parsed by one Zod schema in `src/lib/env.ts`.
`getEnv()` parses once, caches, and throws a single aggregated error listing every
invalid variable. Nothing may call it at module scope: `next build` evaluates
modules with no `DATABASE_URL` set.

## What is required, and why so little

<!-- surface-count: glob=src/lib/env.ts pattern=export function \w+ -->

| Accessor | Answers |
|---|---|
| `getEnv()` | The parsed, cached environment |
| `resetEnvCache()` | Test-only: re-parse a mutated `process.env` |
| `getAuthBaseUrl()` | This environment's public origin, or undefined for localhost |
| `getTrustedOrigins()` | The union of the configured URL and the Railway domain |
| `isProductionEnvironment()` | Is this the environment named `production` (ADR 0003) |
| `shouldSeed()` | Is `SEED_DATA` exactly `"true"` |
| `isSignupAllowed()` | Is `ALLOW_SIGNUP` anything other than exactly `"false"` |
| `getLogLevel()` | pino level, default `info` |
| `getDemoLogin()` | Demo credentials, or null. The ONLY accessor app code may use |
| `getSeedDemoLogin()` | Demo credentials, ungated. Seed only |

Only `DATABASE_URL` and `BETTER_AUTH_SECRET` are required. The schema fails fast,
so **a variable that is required but not actually needed to boot turns every
environment lacking it into a crash loop.** Everything feature scoped is
`.optional()` and checked at its point of use.

## The per-environment matrix

The operational walkthrough is [../runbooks/railway-setup.md](../runbooks/railway-setup.md).
This table is the reasoning behind it.

| Variable | production | dev | feature envs | local |
|---|---|---|---|---|
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` | `${{Postgres.DATABASE_URL}}` | cloned reference, re-resolves | `.env.local` |
| `BETTER_AUTH_SECRET` | unique literal | unique literal | cloned from dev | `.env.local` |
| `BETTER_AUTH_URL` | custom domain | **UNSET** | **UNSET** | unset |
| `NODE_ENV` | `production` | `production` | `production` | `development` |
| `SEED_DATA` | `false` | `true` | inherits `true` | `true` |
| `ALLOW_SIGNUP` | optional `false` | unset | unset | unset |
| `SHOW_DEMO_LOGIN` | **never** | `true` | inherits `true` | `true` |

## The rule that makes feature environments free

Railway clones dev's variables into every feature environment.

| Value kind | On clone |
|---|---|
| Reference (`${{Postgres.DATABASE_URL}}`) | Re-resolves per environment. Safe |
| Literal | Copied verbatim. Correct only if it is correct everywhere |

Therefore **any variable whose correct value differs per environment must be either
a reference variable, or left UNSET on dev so the code derives it.**

`BETTER_AUTH_URL` is the case that matters. Setting it on dev would clone dev's
hostname into every feature environment, and sign in there would fail with
`INVALID_ORIGIN`. Left unset, `getAuthBaseUrl()` falls back to
`https://$RAILWAY_PUBLIC_DOMAIN`, which Railway injects per environment. That single
choice is why feature environments need zero manual setup.

## Trusted origins

`getTrustedOrigins()` returns the UNION of `BETTER_AUTH_URL` and
`https://$RAILWAY_PUBLIC_DOMAIN`, so a custom domain and the railway.app hostname
both work on production.

It can be EMPTY locally, and the caller must then omit the key entirely.
**Passing `trustedOrigins: []` to Better Auth REPLACES its defaults with an empty
allow list and makes every sign in fail with `INVALID_ORIGIN`.** `src/lib/auth.ts`
spreads the key conditionally for exactly this reason.

Better Auth trusts `localhost` by default, not `127.0.0.1`. Local and e2e base URLs
point at `localhost`.

## The deploy chain

`railway.json`'s `startCommand`, in order:

```
npm run db:migrate && if [ "$SEED_DATA" = "true" ]; then npm run seed; fi && npm run start
```

Railpack builds it; there is no Dockerfile. The shell gate and the seed's own
`shouldSeed()` check are both present on purpose: the gate keeps the seed out of the
deploy entirely on production, and the in-script check means nothing can seed by
accident when invoked another way. A failing seed stops the chain rather than being
swallowed.

## Variables Railway injects

`PORT`, `RAILWAY_PUBLIC_DOMAIN`, and `RAILWAY_ENVIRONMENT_NAME`. Never set them by
hand.

This project uploads no files, so the `AWS_*` bucket variables Railway's plugin
provides are unused and undeclared. `.env.example` says so.

## Next config

| Setting | Why |
|---|---|
| `agentRules: false` | Next 16 otherwise writes its own agent-rules block into `CLAUDE.md` on `next dev`, and that file is hand written under a 300-line budget |
| `serverExternalPackages: ["@node-rs/argon2", "pino", "pino-pretty"]` | argon2 is a native addon and pino resolves transports at runtime; both break if the server bundler traces and inlines them |
| `headers()` sending `x-harness: live` and `x-harness-sha` | Harness markers on every route: `/setup`'s one-time check polls the first to tell the app from a placeholder page that also answers 200, and `/feature`'s `verify-deploy.sh` matches the second (`RAILWAY_GIT_COMMIT_SHA`, baked at build time) against the feature branch tip to confirm the deploy serves the pushed code. Dropping them only disables those checks |
| `typescript.ignoreBuildErrors: false` | A type error must fail the build |

Next 16 removed the `eslint` config key along with `next lint`. Linting is
`pnpm lint` against `eslint.config.mjs`.
