# Railway setup

Set by hand, once per environment. Generate every secret with `openssl rand -base64 32`. Variables Railway injects (`PORT`, `RAILWAY_PUBLIC_DOMAIN`, `RAILWAY_ENVIRONMENT_NAME`) are not listed: leave them alone.

## production (deploys from `main`)

| Variable | Value to paste |
|---|---|
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` |
| `BETTER_AUTH_SECRET` | output of `openssl rand -base64 32` |
| `BETTER_AUTH_URL` | `https://your-custom-domain.com`, or leave unset if you have no custom domain |
| `NODE_ENV` | `production` |
| `SEED_DATA` | `false` |
| `ALLOW_SIGNUP` | `false` to close signup, otherwise leave unset |
| `SHOW_DEMO_LOGIN` | leave unset |

## preprod (deploys from `preprod`)

| Variable | Value to paste |
|---|---|
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` |
| `BETTER_AUTH_SECRET` | a DIFFERENT `openssl rand -base64 32` |
| `NODE_ENV` | `production` |
| `SEED_DATA` | `true` (the harness leaves it unset, and seeding needs exactly `"true"`) |
| `SHOW_DEMO_LOGIN` | `true` |
| `BETTER_AUTH_URL` | leave unset (a literal here clones into every feature environment and breaks its sign in) |

**Feature environments need ZERO setup**: they clone preprod, where every value is either a reference variable that re-resolves against their own Postgres or a literal correct everywhere, and `BETTER_AUTH_URL` is unset so each falls back to its own Railway domain. Reasoning: [../architecture/configuration.md](../architecture/configuration.md).
