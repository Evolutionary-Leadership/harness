---
sources:
  - src/lib/query-keys.ts
  - src/app/notes/cache.ts
  - src/app/notes/mutations.ts
  - src/app/notes/notes-view.tsx
  - src/app/notes/note-card.tsx
  - src/app/notes/page.tsx
  - src/components/toast.tsx
  - src/components/confirm-dialog.tsx
  - src/app/providers.tsx
---

# Optimistic UI

The app assumes the server will succeed. The frontend renders on the same frame as
the click; the server is a reconciler, not a gatekeeper. This is only safe because
no action throws: a failure is a value the client reconciles (see
[server-layers.md](./server-layers.md)).

## Where each piece lives

| Concern | File | Rule |
|---|---|---|
| Query key shapes | `src/lib/query-keys.ts` | The ONLY place a key is constructed |
| Cache writes | `src/app/notes/cache.ts` | Plain functions over a `QueryClient`, no hooks |
| Mutations | `src/app/notes/mutations.ts` | Every one a `useMutation` with three parts |
| Derived fields | `src/lib/notes/view.ts` | Shared by the server and the optimistic patch |
| Soft warnings | `src/components/toast.tsx` | Success path only, never an error state |
| Destructive confirm | `src/components/confirm-dialog.tsx` | In-app dialog, never `window.confirm()` |

## Query keys

Keys carry their scope, broad to specific:

| Key | Shape |
|---|---|
| Everything notes | `["notes"]` |
| One notebook's lists | `["notes", "list", notebookId]` |
| One list | `["notes", "list", notebookId, scope]` |
| One note | `["notes", "detail", noteId]` |

Two consequences follow, and both are why the single-file rule exists:

- `settleNotes()` invalidates the `["notes"]` PREFIX, so every cached variant
  refreshes, not just the visible one. An inline key at a call site would opt that
  entry out of every invalidation.
- A scoped key can be READ BACK (`parseNotesListKey`) to ask whether a note still
  belongs in that list. Ejection is impossible without this.

## The cache helpers

| Helper | Does |
|---|---|
| `patchNote(client, id, fn)` | Applies `fn` wherever the note is cached, and ejects it from any list whose scope it no longer matches |
| `upsertNote(client, note)` | Files the note into the lists it matches and ejects it from the ones it does not |
| `dropNoteEverywhere(client, id)` | Removes it from EVERY cached view, plus the detail entry |
| `replaceNotesList(client, ...)` | Replaces one list wholesale (reorder is a whole-list fact) |
| `withEditedText(note, input)` | The optimistic mirror of the server's derived fields |
| `snapshotNotes` / `restoreNotes` | Capture and restore, for the snapshot rollback strategy |
| `settleNotes(client)` | The one shared settle: prefix invalidation |

They take a `QueryClient` and return nothing, so `tests/unit/notes-cache.test.ts`
exercises all of them with no DOM, no React, and no server.

**Scope-aware rewrites iterate the cache's keys.** `setQueriesData` looks like the
right tool and is not: its updater is never told which key it is updating, so it
cannot answer "does this note still belong in THIS list?".

## The three parts of a mutation

| Part | Holds | Never holds |
|---|---|---|
| `onMutate` | A cache patch through a named helper | An inline `setQueryData` |
| `onSuccess` | Soft warnings, surfaced as toasts | Error handling |
| `onSettled` | The shared `settle()` | Anything mutation-specific |

## Rollback strategies

Two, chosen deliberately, and each mutation says which in a comment.

| Mutation | Strategy | Why |
|---|---|---|
| Create | Snapshot | A note that silently vanished is confusing |
| Delete | Snapshot | Destructive, and a reappearing row reads as a bug |
| Edit title/body | None | The user is watching the text; the settle refetch corrects it, and restoring an older body would clobber in-flight keystrokes |
| Archive toggle | None | Cheap and self correcting |
| Reorder | None | The user is watching the list, and `reorderNotes` is the same pure function the server uses |

## Two ids on a create

| Id | Minted by | Lives | Purpose |
|---|---|---|---|
| `newOptimisticId()` | `onMutate` | The cache only | Clearly temporary. Rows carrying it disable their actions, since the server has not acknowledged them |
| `newNoteId()` | The caller, before `mutate` | Persisted | Stable across `runSerializable`'s retries |

On success the temporary row is dropped and the server's row upserted.

## Derived fields need optimistic mirrors

`excerpt` is computed on read by the server; `wordCount` is denormalized onto the
row. Patching `body` alone would leave a card showing the OLD preview and the OLD
count until the refetch, which reads as "I typed and nothing happened".
`withEditedText` calls `deriveNoteFields`, the same function the service calls, so
the two cannot drift.

## Undo, not confirm

Reversible actions (archive) flip immediately with a five second countdown; only
the expiring timer talks to the server, and pending timers are cleared on unmount.
Irreversible actions (delete) use the in-app confirm dialog.

The undo banner renders at the VIEW level, not inside the row, because the archive
ejects the row and would take the button with it. The pending entry holds the whole
note so `cancel()` can re-insert it. Full reasoning in ADR 0004.

## No blocking spinners on the hot path

`src/app/notes/page.tsx` (a Server Component) fetches the first list and passes it
as `initialNotes`; `NotesView` seeds it under exactly the key the client would
otherwise fetch into. The archived list is secondary and fetches lazily. The list
polls every 20 seconds, which is the right cadence for a collaborative feed.
