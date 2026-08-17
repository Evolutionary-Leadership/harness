---
sources:
  - src/lib/db/schema/*.ts
  - src/lib/db.ts
  - src/lib/db/sql.ts
  - src/lib/notes/view.ts
  - drizzle/*.sql
  - drizzle.config.ts
  - scripts/db-migrate.ts
  - scripts/seed.ts
---

# Data model

PostgreSQL through Drizzle ORM on the `postgres` (postgres-js) driver.
`drizzle-kit` generates migrations; `scripts/db-migrate.ts` applies them.

## Tables

<!-- surface-count: glob=src/lib/db/schema/*.ts pattern=export\sconst\s\w+\s=\spgTable -->

| Table | Owns | Notes |
|---|---|---|
| `user` | Identity | Better Auth core. Do not add application columns |
| `session` | Database-backed sessions | Deleting a row revokes immediately (no cookie cache) |
| `account` | Credentials | `password` holds an argon2id digest |
| `verification` | Email verification tokens | Unused while verification is off |
| `notebooks` | A note's scope | Unique on `(user_id, name)` |
| `notes` | The domain entity | See the column notes below |

### `notes` columns worth knowing

| Column | Note |
|---|---|
| `archived` | The SCOPE the note lives in. Flipping it is a scope transition the client must eject on |
| `position` | Sort order within `(user_id, notebook_id, archived)`. Sparse, gaps expected, step 1000 |
| `word_count` | DENORMALIZED from `body`. Written by the service on every create and update, never by hand |

`excerpt` is deliberately NOT a column: it is computed on read by `toNoteView`.
`wordCount` is stored because it is worth indexing and aggregating later; `excerpt`
is a presentation detail. Both are derived by `deriveNoteFields` in
`src/lib/notes/view.ts`, which the optimistic client calls too, so the client and
the server cannot disagree.

The `word_count` invariant (stored value always equals `countWords(body)`) is
checked by a fast-check property test against a compute-on-read oracle in
`tests/unit/note-view.test.ts`, and against real rows in
`tests/integration/notes-repository.test.ts`.

## Indexes

`notes_scope_idx` on `(user_id, notebook_id, archived, position)` covers the list
query exactly: every read is one user's one notebook, filtered by archived, ordered
by position.

## Migrations

| Rule | Detail |
|---|---|
| Change the schema, then generate | `pnpm db:generate` |
| Never edit an applied migration | Add a new one |
| Breaking changes use expand and contract | Add the new shape, migrate, then remove the old |
| Every environment migrates from scratch | Feature environments start with an EMPTY database |

`scripts/db-migrate.ts` is a plain `tsx` script with no Next imports, because it
runs in the deploy's start phase before the server exists. It reads `DATABASE_URL`
directly rather than through `src/lib/env.ts`, so migrating does not require
`BETTER_AUTH_SECRET`.

## Querying

Prefer the relational API (`db.query.notes.findMany` / `findFirst` with `with:`).
Drop to `select()` only where it cannot express the query, which here means the
aggregate counts.

### Two postgres-js traps, encoded as helpers

Both live in `src/lib/db/sql.ts`. Use them; do not hand-roll either.

**1. Never bind a JS array as one parameter.** `col = ANY(${arr})` compiles to a
single parameter carrying an array, which postgres-js sends as one value and
Postgres rejects with `malformed array literal`. `idList()` / `textList()` build N
placeholders joined with `sql.join`.

The empty list returns a bare `TRUE` fragment so a composed WHERE clause stays
valid, which means **an empty list matches EVERYTHING**. Any caller whose semantics
are "match nothing" MUST short circuit before calling. `findNotesByIds` and
`findNotesByIdsRaw` both do, and both branches are tested.

**2. Always cast counts.** `count(*)` is a bigint and postgres-js returns bigint as
a STRING to avoid precision loss. Assigning it to a `number` field typechecks and
then poisons arithmetic silently (`"12" + 1 === "121"`). Use `countAll`
(`count(*)::int`) or `countOverAll` (`(count(*) OVER ())::int`).

## Client lifecycle

`getDb()` creates the pool lazily. **Importing `src/lib/db.ts` must not open a
connection**: Next evaluates modules during `next build`, where `DATABASE_URL` is
unset, so a module-scope `drizzle(...)` breaks every build. The same applies to
`getAuth()`.

`createDb(url)` builds a client against an explicit URL, bypassing the singleton,
for scripts and for integration tests pointing at a throwaway database.

## Seeding

`scripts/seed.ts` is idempotent, gated on `SEED_DATA === "true"`, and refuses to run
when `RAILWAY_ENVIRONMENT_NAME` is `production` (ADR 0003 explains why that check
cannot use `NODE_ENV`).

Idempotency comes from deterministic ids: every row's id is a SHA-256 of its stable
inputs, so a re-run upserts rather than inserts. It always creates the demo account,
independent of `SHOW_DEMO_LOGIN`, so the demo button can never point at a missing
user.

One subtlety worth keeping: the notebook insert is keyed on `(user_id, name)`, so it
can no-op against a notebook created earlier by `ensureDefaultNotebook` under a
different (random) id. The seed re-reads the real id before seeding notes, or the
notes would reference a row that does not exist.
