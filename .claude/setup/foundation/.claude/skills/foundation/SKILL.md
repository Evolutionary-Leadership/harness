---
name: foundation
description: "Build the standard technical foundation (Next.js 16, Drizzle, Better Auth, TanStack Query, optimistic UI). Runs once and deletes itself."
---

# Bootstrap this project's technical foundation

You are setting up a new project to set up the technical foundation. Below are the specs. Follow them as
hard constraints unless you hit a genuine conflict, in which case say so and
implement an alternative.

The Claude Code harness is present (.claude/ skills, claude/ session
branches, feature/<name> branches, /mergedev, /review, /release,
.harness-version), and this repository is the harness-railway variant:
`/setup` stages this skill only when Railway was chosen, so the deploy
target below is a fact, not a conditional.

This build replaces the write-once Express starter (server.js,
package.json, .gitignore). That is intended, and this skill is the only
sanctioned way those files get replaced.

## 0. What to do first

1. Ask me what the product is and what the core domain objects are, if that is
   not obvious from the repo. Everything below is scaffolding; the domain model
   is mine to decide.
2. Name the feature branch early:
   bash .claude/scripts/set-feature-name.sh <slug>.
3. Scaffold in this order: package.json and tooling, db layer, auth, the three
   server layers, one vertical slice end to end (one entity, list + create +
   edit + delete, fully optimistic), tests for that slice, then docs.
4. Do NOT build the whole app. One working vertical slice that demonstrates
   every pattern below is the goal of the first session.

## 0a. The handover deliverable (do not skip this)

The last thing you produce, and the thing I will actually use, is a **short**
Railway setup manual. Requirements:

- Write it to docs/runbooks/railway-setup.md AND print it verbatim in your
  final chat message.
- Maximum 30 lines. Two tables: one for production, one for dev. No prose
  beyond one line per table. I should be able to work through it in Railway in
  two minutes without reading anything else.
- Every row is: variable, exact value to paste (or "reference variable", or
  "leave unset"), and nothing more.
- State explicitly that feature environments require **zero** manual setup, and
  say in one line why.
- Include the exact command to generate each secret.
- List only variables I must act on. Do not list variables Railway injects.

Design the environment variables so that this manual is genuinely short. If you
find yourself writing "and then unset X on each feature environment", that is a
design smell: fix the default so it self-configures instead.

**The rule that makes this work:** Railway clones dev's variables into every
feature environment. Reference variables (${{Postgres.DATABASE_URL}})
re-resolve per environment and clone safely. Literal values clone as literals.
Therefore any variable whose correct value differs per environment must be
either a reference variable or left unset on dev so the code falls back to
something environment derived.

## 1. Stack

- Next.js 16 (App Router, Server Components, Server Actions), React 19
- TypeScript strict. No any, no @ts-expect-error without a tracked issue
- PostgreSQL via Drizzle ORM (drizzle-orm) on the postgres (postgres-js)
  driver, drizzle-kit for migrations
- Tailwind 4 (@tailwindcss/postcss)
- Zod 4 for every external input
- Better Auth (database sessions, argon2id via @node-rs/argon2)
- TanStack Query v5 for all client state
- pino for logging, wrapped in src/lib/logger.ts
- Vitest 4 (+ Testcontainers for Postgres, fast-check for property tests),
  Playwright for e2e
- dnd-kit only if drag and drop is actually needed
- pnpm (pinned via packageManager), Node 22.11+
- Railway for hosting (Railpack, no Dockerfile)

**Version resolution is part of the job, not an afterthought.** latest for one
package can be incompatible with another's peer range, and the failure shows up
in tooling rather than at install time. Immediately after installing, before
writing any application code, run pnpm typecheck and pnpm lint on an empty
project and confirm both execute. If a package must be pinned below latest,
pin it, comment why at the pin, and list it in your deviations summary.

Never run npm install. Never commit a package-lock.json.

Scripts in package.json:

    dev, build, start, lint (eslint), typecheck (tsc --noEmit),
    test (vitest), test:run (vitest run), test:e2e (playwright test),
    db:generate (drizzle-kit generate), db:migrate (tsx scripts/db-migrate.ts),
    db:check, db:studio, seed (tsx scripts/seed.ts),
    check:docs (node scripts/check-docs.mjs),
    verify (typecheck && lint && check:docs && test:run)

## 2. Optimistic architecture (the most important section)

The app must feel instant. The frontend assumes the backend will succeed and
renders immediately; the server is a reconciler, not a gatekeeper.

- **Query key shapes live in exactly one file**: src/lib/query-keys.ts.
  Nowhere else constructs a key. Scoped keys carry their scope
  (["items", day, scopeId]) so prefix invalidation works.
- **Every mutation is a useMutation with three parts**:
  - onMutate: patch the cache through small named helpers next to the
    mutations (patchItem(id, fn), dropItemEverywhere(id), upsertItem),
    never an inline setQueryData at a call site. The UI updates on the same
    frame as the click.
  - onSuccess: only for soft warnings the server sends back (for example a
    duplicate that was kept anyway, or a third party sync that failed but must
    not block the local change). Surface as a toast, never as an error state.
  - onSettled: one shared settle() that invalidates by key **prefix**, so
    every cached variant refreshes, not just the visible one.
- **Two rollback strategies, pick deliberately and say which in a comment**:
  - Cheap, self correcting (toggles, reorder, text edits the user is looking
    at): patch and let the onSettled refetch correct any divergence. No
    snapshot.
  - Confusing if wrong (create with a server generated id, destructive
    removes): snapshot prev in onMutate, restore in onError. Use a
    clearly temporary optimistic id, and disable actions on rows carrying one.
- **A remove must drop the entity from every cached view it can appear in.**
  Model this as an explicit "drop everywhere" helper so it cannot be forgotten.
- **Scoped lists must eject entities that no longer match their scope.** An
  upsert that moves an item from draft to approved has to remove it from
  the draft list, not leave it there until the refetch. Note that a
  setQueriesData updater is not told which variant it is updating, so this
  needs iteration by key.
- **Derived server fields need optimistic mirrors.** If the server computes
  something onto a record while reading, the optimistic patch has to clear or
  recompute it, or the item keeps reading stale until the refetch. Write a
  comment at that spot explaining why.
- **Undo beats confirm for reversible actions.** The action flips immediately
  with a roughly five second countdown during which a second click undoes it
  locally; only the timer commits to the server. Nothing blocks on the network.
  Clear pending timers on unmount.
- **No blocking spinners on the hot path.** Initial page data comes from the
  Server Component and seeds the query cache under the same key the client
  would have fetched into. Secondary panes fetch lazily. Polling for
  collaborative feeds is fine at about 20 seconds.
- **Destructive actions use an in-app confirm dialog component**, never the
  browser confirm().

Make the cache helpers plain functions over a QueryClient so they are unit
testable with no DOM and no server. Test them.

## 3. Server architecture: three layers, one direction

1. src/server/repositories/ wrap Drizzle. Anything touching the database goes
   through a repository.
2. src/server/services/ hold domain logic over repositories. No service
   imports the Drizzle client directly.
3. src/app/**/actions.ts and src/app/api/**/route.ts are thin: Zod parse,
   require session, delegate to a service, shape the response. No business
   rules and no SQL outside layers 1 and 2.

src/lib/db.ts exports DbClient and DbExecutor. Repositories take a
DbExecutor so the same code runs against the pooled client and inside a
transaction. Service readers take a DbExecutor; service mutators take a
DbClient because a mutator owns its transaction boundary.

**Server Action return shape, no exceptions:**

    { ok: true, data } | { ok: false, error, fieldErrors? }

Never throw across the action boundary. Build every action through a single
shared wrapper that parses with Zod, requires a session, delegates, and maps
known domain errors to codes, logging unknown throws and flattening them to
unexpected so internals never reach the client. Unauthenticated maps to
{ ok: false, error: { code: "unauthenticated" } }, not a redirect. This is
what makes optimistic UI safe: failures are values the client reconciles.

**Transactions:** every mutator needing SERIALIZABLE goes through a single
runSerializable helper that retries on Postgres 40001 up to 5 times.
Because it retries, every transaction body must be idempotent: ON CONFLICT
inserts, exact key deletes, ids generated by the caller outside the retried
body, and no side effects outside the database.

## 4. Database rules

- Schema in src/lib/db/schema/. Change it, then run pnpm db:generate. Never
  edit an applied migration. Breaking changes use expand and contract.
- Migrations run automatically on deploy, so every environment must be able to
  migrate from scratch.
- Prefer Drizzle's relational API (db.query.<table>.findMany / findFirst with
  with:). Drop to select() only where it cannot express the query.
- Two postgres-js traps, encoded as shared helpers from day one:
  - Never bind a JS array as a single parameter (col = ANY(${arr}) throws
    "malformed array literal"). Build a parameterized IN (...) with
    sql.join via idList() / textList(), and keep the empty list branch a
    TRUE fragment. Document that callers needing "match nothing" must short
    circuit before calling, and prove it with a test.
  - Always cast counts: count(*)::int, (COUNT(*) OVER ())::int. bigint
    arrives as a string and silently poisons number typed fields.
- The db client must be created lazily (importing the module must not open a
  connection), because Next evaluates modules at build time when DATABASE_URL
  is not set. Same for the auth instance.
- scripts/seed.ts must be idempotent, gated on SEED_DATA === "true", and
  must refuse to run on the production environment. See section 6 for why that
  check cannot use NODE_ENV.

## 5. Auth rules

- Better Auth with database sessions and argon2id. No bcrypt, no PBKDF2.
  Disable the cookie cache explicitly so revocation is immediate.
- Put password hashing in its own module, not alongside the Better Auth
  instance, so the seed script can hash without pulling in auth and the db.
- Every signed in page, server action, and data route re-verifies the session
  itself via getSession() / requireSession() in src/lib/auth-server.ts.
  A layout level check is convenience, not security.
- Middleware / proxy (src/proxy.ts in Next 16) is rate limiting and redirect
  UX only. It is explicitly NOT the security boundary. Say so in a comment at
  the top of the file.
- Trusted origins are the union of the configured public URL and
  https://$RAILWAY_PUBLIC_DOMAIN, computed in src/lib/env.ts, so ephemeral
  environments self configure. See the trap in section 11 about passing an
  empty union.
- Signup is open unless ALLOW_SIGNUP is exactly "false", enforced server
  side, not just hidden in the UI.
- Never commit .env*. .env.example documents every variable with a comment
  saying what it does, which environments set it, and how to generate it.

## 5a. Demo login (non production environments only)

Seeded environments should offer a one click login so nobody stores credentials
to review a preview. Production must never show it.

- SHOW_DEMO_LOGIN activates it, only when exactly "true".
  DEMO_LOGIN_EMAIL / DEMO_LOGIN_PASSWORD are optional overrides with
  hardcoded fallbacks for a clearly fictional user.
- getDemoLogin() returns { email, password } | null, null whenever the flag
  is not exactly "true". It is the only accessor application code may use.
- **The login page is a Server Component.** It calls getDemoLogin() at render
  time and passes the result down as a prop. The client form must never read
  process.env or the flag. The goal is that on production the credentials
  never enter the client bundle at all, not that a button is hidden.
- The client form renders the button only when the prop is non null; clicking
  it fills the fields and submits through the normal credentialed sign in path.
  No bypass route, no magic token.
- **The seed must create this account whenever it runs**, independent of
  SHOW_DEMO_LOGIN, so the button always has a real user behind it. That is a
  different question from whether the button shows, so give the seed its own
  ungated accessor that shares one private reader with getDemoLogin() inside
  src/lib/env.ts. Those two variables are still read in exactly one file.

## 6. Environment variables, environments, and deploy (Railway)

**Env handling in code.** One Zod schema in src/lib/env.ts with a getEnv()
that parses once, caches, and throws a readable aggregated error listing every
invalid variable. Required variables are ONLY those the app cannot boot
without: DATABASE_URL and BETTER_AUTH_SECRET (min 32 chars). Everything
feature scoped is .optional() and checked at its point of use. The schema
fails fast, so a required but unused variable is a crash loop on every
environment that lacks it.

Auth origin helpers in the same file:

- getAuthBaseUrl(): BETTER_AUTH_URL if set, else
  https://$RAILWAY_PUBLIC_DOMAIN, else undefined (localhost).
- getTrustedOrigins(): the UNION of both.

**Environment topology.** production deploys from main, dev deploys from
dev, and one ephemeral environment per feature branch, duplicated from dev.
Each environment gets its own isolated Postgres wired as
${{Postgres.DATABASE_URL}}, so a feature branch can never touch production
data.

**Feature environments must require zero manual configuration.** Since they
clone dev, set on dev only what is correct for every clone. In particular do
not set BETTER_AUTH_URL on dev: leave it unset so dev and every feature
environment fall back to their own Railway domain. Set it only where the public
origin is a custom domain, which in practice means production only.

**NODE_ENV is a runtime switch, not an environment label.** Every deployed
environment, including dev and feature environments, runs
NODE_ENV=production. development is only correct locally under next dev.
Consequence: nothing may use NODE_ENV to answer "is this production". The
seed's production guard must key on RAILWAY_ENVIRONMENT_NAME instead, and
that reasoning belongs in an ADR.

**Deploy chain.** railway.json startCommand runs, in order:
npm run db:migrate, then npm run seed only when SEED_DATA is exactly
"true", then npm run start. Railpack builds, no Dockerfile.
scripts/db-migrate.ts is a plain tsx script running the Drizzle migrator over
./drizzle with no Next imports.

**Note on the harness default.** The harness sets SEED_DATA=false on
production and leaves dev and feature environments unset. Since seeding is
gated on exactly "true", dev must have SEED_DATA=true set explicitly. Call
this out in the handover manual.

**Variables the app owns.** Railway injects PORT and RAILWAY_PUBLIC_DOMAIN;
never set those by hand.

| Variable | Required | Purpose |
|---|---|---|
| DATABASE_URL | yes | Postgres connection, as a Railway reference |
| BETTER_AUTH_SECRET | yes | session cookie signing, 32+ chars, unique per environment |
| BETTER_AUTH_URL | no | explicit public origin; production only |
| NODE_ENV | no | production on every deployed environment |
| SEED_DATA | no | seed on deploy when exactly "true" |
| ALLOW_SIGNUP | no | signup closed only when exactly "false" |
| SHOW_DEMO_LOGIN | no | demo login button when exactly "true" |
| DEMO_LOGIN_EMAIL / DEMO_LOGIN_PASSWORD | no | overrides for the seeded demo account |
| LOG_LEVEL | no | pino level, defaults to info |

Add AWS_* object storage variables only if the project actually uploads
files, and say in .env.example that they are unused if it does not.

## 7. Testing

Three tiers; the file extension picks the runner, so naming is load bearing:

| Tier | Location | Runner | Needs |
|---|---|---|---|
| Unit | tests/unit/*.test.ts | Vitest | nothing |
| Integration | tests/integration/*.test.ts | Vitest | Docker (Testcontainers Postgres 16) or TEST_DATABASE_URL |
| E2E | tests/e2e/*.spec.ts | Playwright | a running server |

- Pull every piece of non-trivial logic that can be pure into a pure module
  (grouping, sorting, normalization, view models) and unit test it without a
  DOM. This is a big reason the codebase stays testable.
- Integration tests boot one container per file (fileParallelism: false),
  apply all migrations, seed auth users, and TRUNCATE between tests. Fixture
  rows reference seeded user ids; foreign keys are real. Support
  TEST_DATABASE_URL as an escape hatch.
- Use fast-check property tests for invariants that must hold over arbitrary
  data, checked against a compute-on-read oracle. Any denormalized or derived
  field is a natural candidate.
- Test the cross-user boundary explicitly: another user's row must be
  invisible, unupdatable, and undeletable.
- Default down a tier. E2E is for journeys, not coverage. One journey that
  exercises the whole optimistic loop is enough.
- CI runs NO tests (the runner has no Docker). CI runs
  pnpm typecheck && pnpm lint && pnpm check:docs, wired via the check: line
  in .harness-version. Never treat a green PR check as "tests passed", and
  say so in CLAUDE.md and the README.

## 8. Documentation standard

Most readers are AI agents in fresh sessions, so docs are persistent memory and
context is scarce.

- CLAUDE.md is a ROUTER, roughly 300 lines: stack, one-way decisions, layer
  rules, guardrails, and a table mapping "what you are doing" to "what to
  read". Catalogs never live in it.
- docs/README.md indexes every doc and the ADR list.
- docs/PROJECT.md owns product vision and behavior, and wins over CLAUDE.md
  for product questions. Include a "not built yet" section.
- docs/architecture/*.md, one per subsystem, 400 lines max, each with a
  sources: frontmatter block listing the globs it describes.
- docs/decisions/NNNN-*.md are append only ADRs for choices with non-obvious
  tradeoffs. Every contradiction you resolve in these specs becomes an ADR.
- docs/GLOSSARY.md, docs/SECURITY.md, docs/TESTING.md, and
  docs/runbooks/ for procedures that have bitten someone, including the
  Railway setup manual from section 0a.
- Rules: one home per fact, code is truth for WHAT and docs for WHY and WHERE,
  stale is worse than absent.
- scripts/check-docs.mjs enforces integrity in CI: every sources: glob
  resolves, every doc is indexed, CLAUDE.md is within its line budget, and
  any <!-- check:count ... --> markers still match. Make sure its file walk
  includes dotfiles like .env.example.

## 9. Definition of done

- pnpm typecheck, pnpm lint, pnpm test:run pass, and new behavior has at
  least one test
- Every external input (form data, request body, search params, env var) is
  validated with Zod at the boundary
- No console.* outside src/lib/logger.ts, enforced by eslint
- Docs updated and pnpm check:docs passes

## 10. Writing rule

Never use em dashes (U+2014) anywhere in code, comments, docs, or commit
messages. Use commas, colons, semicolons, or parentheses. The
prevent-em-dash.sh PreToolUse hook enforces this. Note that some tooling
generates text containing em dashes; if that happens, disable the generator
rather than fighting the hook.

## 11. Traps that have already cost a session

Check these before you hit them.

- **typescript-eslint and eslint-plugin-react lag the majors they depend on.**
  A latest TypeScript or ESLint can make pnpm lint impossible to run. Prove
  the toolchain works before writing app code, then pin and record why.
- **Better Auth: passing an empty trustedOrigins array replaces the default**
  and makes every sign in fail with INVALID_ORIGIN. Spread the key
  conditionally so an empty union omits it entirely.
- **Better Auth trusts localhost by default, not 127.0.0.1.** Point local
  and e2e base URLs at localhost.
- **Next 16 writes an agent rules block into CLAUDE.md on next dev.** Set
  agentRules: false in next.config.ts so your router file stays yours.
- **@node-rs/argon2 exports Algorithm as an ambient const enum**, which
  verbatimModuleSyntax cannot import. Use the numeric value with a comment
  naming it.
- **Commit next-env.d.ts.** CI typechecks without running a build.
- **Argon2 and pino must be in serverExternalPackages.**
- When stopping background servers you started, target the process precisely.
  A broad pkill -f pattern can match and kill your own session.

## 12. Deliverables

- A running app with one entity wired through all three server layers
- That entity's list/create/edit/delete fully optimistic per section 2, helpers
  named and commented
- Auth working, signup gated, demo login per section 5a
- Migrations generated and applied, seed idempotent and creating the demo
  account
- pnpm verify green
- CLAUDE.md and docs/ populated per section 8, .env.example complete
- **The Railway setup manual from section 0a, printed in your final message**
- A short summary of anything you deliberately deviated from, and why

## 13. Prove it, do not claim it

Before reporting done, actually run these and report the real output:

1. pnpm verify
2. The literal startCommand from railway.json against an **empty** database,
   proving migrate then seed then start works from scratch
3. The seed twice in a row, showing row counts are unchanged
4. The e2e journey against a running server
5. With SHOW_DEMO_LOGIN unset: confirm the demo email and password appear
   nowhere in the page payload and nowhere in the built client chunks
6. With ALLOW_SIGNUP=false: confirm the signup endpoint itself rejects, not
   just the UI
7. The exact CI command from a clean clone with a frozen lockfile, no build
   artifacts, no Docker

If something cannot be verified in this environment, say so plainly rather than
implying it passed.

## 14. Self-delete

After pnpm verify is green and the Railway setup manual has been printed,
run:

    git rm -r .claude/skills/foundation

Fold that deletion into the closing docs commit, so the skill disappears
the same way `/setup` did. This skill runs once; the foundation it builds
is the durable artifact, not the instructions.
