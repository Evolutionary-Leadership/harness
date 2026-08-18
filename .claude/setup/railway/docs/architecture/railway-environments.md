---
# Per-environment infrastructure is created and destroyed by these files.
# A diff touching them implicates this doc. harness-railway.yml also shaped
# production and dev, but it self-deletes after the one bootstrap run, so
# naming it here would fail check-docs in every bootstrapped project.
sources:
  - .github/workflows/feature-branch-railway.yml
  - .github/workflows/feature-merge-cleanup.yml
  - railway.json
---

# Railway environments

Reference for the per-environment infrastructure the harness provisions:
one PostgreSQL instance, one S3-compatible bucket, and one app service per
environment, all isolated.

## Invariants

- **Every environment is isolated.** A feature branch never touches dev or
  production data. Its database starts empty and its bucket is a fresh fork.
- **`DATABASE_URL` is wired by Railway**, not by you. Read the variable; do
  not build a connection string.
- **Production is never seeded.** `SEED_DATA=false` is set on production by
  the harness setup workflow, and seed scripts must honour it.
- **Non-production environments are publicly loginable.** Dev and every
  feature preview ship `SHOW_DEMO_LOGIN=true` and a seeded demo account,
  and Railway domains are public and unauthenticated. Anyone with the URL
  can sign in. That is deliberate, so a reviewer needs no credentials, and
  it makes **dev must never hold real data** a rule rather than a
  suggestion.
- **Every environment has its own signing key.** `BETTER_AUTH_SECRET` is
  generated per environment, so a leak in a preview cannot forge sessions
  anywhere else.
- **Buckets cannot be moved after creation.** A feature bucket inherits its
  region from the dev bucket it forked. Region is a create-time decision.
- **Preview-URL publishing is idempotent and self-healing.** A cancelled or
  half-provisioned run recovers on the next trigger for the same branch; do
  not hand-repair a Railway environment before re-triggering.

## Database

Every Railway environment (production, dev, and each feature branch) gets
its own isolated PostgreSQL instance. The `DATABASE_URL` environment variable
is automatically wired to the app service via a Railway reference variable
(`${{Postgres.DATABASE_URL}}`). Your app just reads `DATABASE_URL`, so no
manual connection string configuration needed.

**Migrations:** Database migrations run automatically on deploy via the
`railway.json` startCommand. It detects your ORM (Drizzle or Prisma) and
runs the appropriate migration command before starting the app. Each feature
environment starts with an empty database, so all migrations run from
scratch. Dev and production only run new (pending) migrations.

**How migrations flow through branches:**

| Environment | DB state | What happens on deploy |
|---|---|---|
| Feature branch | Empty (fresh) | All migrations run from first to latest |
| Dev | Persistent | Only new migrations from merged feature run |
| Main/Production | Persistent | Only new migrations from release run |

**Safe schema changes:** For breaking changes (renaming columns, changing
types), use the expand-and-contract pattern: add the new column alongside
the old one, migrate data, update code, then drop the old column in a
separate migration. See your database trait (`.claude/traits/`) for details.

**Migration conflicts:** When two feature branches both modify the schema,
merging them will produce a git conflict in the migration journal file.
This is intentional; resolve it manually and verify with your ORM's
generate command.

## Object Storage (Bucket)

Every Railway environment gets its own isolated S3-compatible bucket. Bucket
credentials are available as environment variables in your app service:

| Variable | Purpose |
|---|---|
| `AWS_S3_BUCKET_NAME` | Globally unique S3 bucket name |
| `AWS_ENDPOINT_URL` | S3 endpoint |
| `AWS_ACCESS_KEY_ID` | S3 access key |
| `AWS_SECRET_ACCESS_KEY` | S3 secret key |
| `AWS_DEFAULT_REGION` | S3 region (e.g., `auto`) |

Use any S3-compatible client library (AWS SDK, Bun S3, boto3, etc.) to
interact with the bucket. Railway uses virtual-hosted-style URLs, and most
libraries handle this automatically when given the base endpoint.

**Environment isolation:** Each environment's bucket is completely separate.
Feature branch environments get their own bucket with isolated credentials,
so you won't accidentally touch production data.

**Region:** Every service in every environment (production, dev, and
every feature branch) defaults to **EU West (Amsterdam)**; none land in a
US region. The app service and Postgres are pinned to
`europe-west4-drams3a` via the `SERVICE_REGION` env var, and the bucket
is created in `ams` via the `BUCKET_REGION` env var. Both knobs live at
the top of `.github/workflows/harness-railway.yml` (production and dev)
and `.github/workflows/feature-branch-railway.yml` (per-feature envs).
Feature environments fork dev, so their bucket inherits `ams` from the
dev bucket and cannot be re-pinned per feature (a bucket cannot be moved
after creation). To use a different region, change **both** values in
**both** workflows. Existing services do not migrate automatically, and
after a `/harness-upgrade` re-check the values, since an upgrade can
reset these harness-managed workflows back to the defaults.

## Application variables set by the harness

A project scaffolded with the standard technical foundation gets these set
during bootstrap, so a fresh repository needs no Railway dashboard visit.
Which variables you get depends on the `foundation:` answer recorded in
`.harness-bootstrap` during `/setup`: a project that declined the
foundation gets only `SEED_DATA=false` on production, since the minimal
Express starter has neither Better Auth nor a seed script.

| Variable | production | dev | feature |
|---|---|---|---|
| `BETTER_AUTH_SECRET` | generated | generated, a different value | generated on first provision |
| `SEED_DATA` | `false` | `true` | inherited from dev, so `true` |
| `SHOW_DEMO_LOGIN` | unset | `true` | inherited from dev, so `true` |

Secrets are generated inside GitHub Actions and masked, so they never
appear in a workflow log. To read one, open the Railway dashboard.

**These are set once, at provision time.** The bootstrap workflow deletes
itself after a successful run, so re-running it is not a way to rotate a
key, and a project provisioned before this behaviour existed keeps
whatever was set by hand. Changing a value later is a dashboard edit.

A feature environment is forked from dev and therefore inherits dev's
values, except for `BETTER_AUTH_SECRET`, which is replaced with a fresh
one the first time the environment is provisioned. Later pushes to the
same branch leave it alone, so a reviewer's session survives your pushes.

### Seed data

Production is the only environment where the harness sets `false`. Guard
the seed script on that value:

```js
if (process.env.SEED_DATA === "false") {
  console.log("SEED_DATA=false, skipping seed");
  process.exit(0);
}
```

The stricter `!== "true"` form looks equivalent and is not. A project
provisioned before the harness started setting `SEED_DATA=true` on dev has
that variable unset there, and the strict form would silently stop seeding
its dev environment. If you prefer the strict form, set `SEED_DATA=true`
on dev in the Railway dashboard first.

## Railway preview URL

A PostToolUse hook (`.claude/hooks/post-push-railway-url.sh`) tries to
fetch the Railway preview URL after every `git push`. However, hook output
is not always visible in your context. **After your final push, always
manually fetch and include the Railway URL in your summary:**

```
bash .claude/scripts/get-railway-url.sh
```

That helper polls the matching `feature/<name>` branch for `.railway-url`
and prints it to stdout. The post-push hook delegates to the same script,
so re-running it is the canonical recovery path when provisioning takes
longer than the hook's ~80s budget. If you need the lower-level form
(for example from a script that already knows the feature branch name):

```
git fetch origin feature/<name> && git show origin/feature/<name>:.railway-url
```

Having the URL does not mean the deploy is live yet. To confirm the
environment is serving the pushed code, run:

```
bash .claude/scripts/verify-deploy.sh
```

It polls the URL for the `x-harness: live` and `x-harness-sha` response
headers and matches the sha against the tip of `feature/<name>` (the
Action's merge commit is what deploys, never your local HEAD), for up
to 8 minutes. It prints `deploy-verified:` or `deploy-pending:` and
always exits 0. The headers come from the app itself (starter:
`server.js` middleware; foundation: `next.config.ts` `headers()`);
**keep them when you replace the starter with your real app**, or
deploy verification degrades to "could not confirm".

The publishing step is idempotent and self-healing: even if an earlier
run was cancelled mid-mutation, a later workflow trigger on the same
branch will look up the existing Railway environment and commit the
missing `.railway-url`. The deployment trigger is healed the same way:
every provisioning run repoints any trigger still targeting `dev` at
`feature/<name>` and redeploys the app service, so a half-provisioned
environment never silently serves dev code on the preview URL.
Concurrent pushes to the same `claude/...` branch queue instead of
cancelling, so a fresh push never interrupts in-flight provisioning.
