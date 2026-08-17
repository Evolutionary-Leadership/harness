# Glossary

Domain and architecture terms, each pointing at the file or ADR that defines it. If
a term in the code is not here, either add it or rename the code to a term that is.

## Domain

| Term | Means | Defined in |
|---|---|---|
| **Note** | The domain entity: a title, a plain text body, and a place in an ordered list | `src/lib/db/schema/notes.ts` |
| **Notebook** | The scope a note lives in. Every user has at least one, named `Inbox` | `src/lib/db/schema/notes.ts` |
| **Scope** | Which list a note belongs to: `active` or `archived`. Mirrors the `archived` column | `src/lib/notes/view.ts` (`NoteScope`) |
| **Scope transition** | A write that moves a note between scopes, so the client must EJECT it from the list it left | `src/app/notes/cache.ts` |
| **Archived** | Reversible removal from the active list. Undoable, and undo costs no request | `src/app/notes/mutations.ts` |
| **Excerpt** | A one-line preview of the body, capped at 140 characters. COMPUTED ON READ, never stored | `src/lib/notes/view.ts` (`buildExcerpt`) |
| **Word count** | Words in the body. DENORMALIZED onto the row, written by the service | `src/lib/db/schema/notes.ts` |
| **Position** | Manual sort order within `(user, notebook, scope)`. Sparse, step 1000 | `src/lib/notes/view.ts` (`POSITION_STEP`) |
| **Demo login** | One click sign in as a seeded fictional user. Non-production only | `src/lib/env.ts` (`getDemoLogin`) |

## Architecture

| Term | Means | Defined in |
|---|---|---|
| **Optimistic** | The UI renders the expected result immediately and reconciles afterwards | `docs/architecture/optimistic-ui.md` |
| **Optimistic id** | A clearly temporary id for a row that exists only in the cache. Rows carrying one disable their actions | `src/app/notes/cache.ts` (`newOptimisticId`) |
| **Optimistic mirror** | A client-side recomputation of a field the SERVER derives, so an edit does not read stale | `src/app/notes/cache.ts` (`withEditedText`) |
| **Ejection** | Removing an entity from a cached list whose scope it no longer matches | `src/app/notes/cache.ts` (`patchNote`, `upsertNote`) |
| **Settle** | The one shared `onSettled`: invalidate by key PREFIX so every cached variant refreshes | `src/app/notes/cache.ts` (`settleNotes`) |
| **Soft warning** | A caveat returned on the SUCCESS path and shown as a toast, never an error state | `src/lib/action.ts` (`Warning`) |
| **Rollback strategy** | Snapshot-and-restore, or nothing and let the settle refetch correct it. Chosen per mutation | `docs/architecture/optimistic-ui.md` |
| **Action wrapper** | The single builder every Server Action goes through: parse, require session, delegate, map errors | `src/lib/action.ts` (`defineAction`) |
| **DbExecutor** | Anything that can run a query. Repositories and service readers take it, so one code path serves the pool and a transaction | `src/lib/db.ts` |
| **DbClient** | The pooled client, which owns transaction boundaries. Service mutators take it | `src/lib/db.ts` |
| **Repository** | Layer 1. The only code that touches a table | `src/server/repositories/` |
| **Service** | Layer 2. Domain logic over repositories, never over the Drizzle client | `src/server/services/` |
| **Expand and contract** | Ship the new schema shape, migrate, then remove the old, so no deploy needs both at once | `docs/architecture/data-model.md` |
| **Feature environment** | An ephemeral Railway environment per feature branch, cloned from dev, with its own Postgres | `docs/architecture/railway-environments.md` |
| **Reference variable** | A Railway variable like `${{Postgres.DATABASE_URL}}` that RE-RESOLVES per environment, so it clones safely | `docs/architecture/configuration.md` |
