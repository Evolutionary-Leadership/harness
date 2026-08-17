import type { NoteScope } from "@/lib/notes/view";

/**
 * EVERY TanStack Query key in this app is constructed here. Nowhere else.
 *
 * Two reasons this is a hard rule:
 *
 * 1. Prefix invalidation only works if the prefixes are consistent. `settle()`
 *    invalidates by PREFIX so every cached variant refreshes, not just the one
 *    on screen. An inline `["notes", id]` at a call site silently opts that
 *    entry out of every invalidation.
 * 2. A scoped key must CARRY its scope, so a cache helper can look at a key and
 *    decide whether a given entity still belongs in it. Ejection from a scoped
 *    list is impossible otherwise.
 *
 * Read: a key is a tuple whose first element names the entity, and whose
 * remaining elements narrow the scope from broad to specific.
 */
export const queryKeys = {
  notes: {
    /** Prefix for everything notes related. Invalidating this refreshes all of it. */
    all: () => ["notes"] as const,

    /** Every list within one notebook, regardless of scope. */
    byNotebook: (notebookId: string) => ["notes", "list", notebookId] as const,

    /**
     * One list: the notes of `notebookId` in `scope`.
     *
     * The scope is IN the key, which is what lets ejectFromForeignScopes read a
     * key and ask "does this note still match?". Note that a setQueriesData
     * updater is not told which variant it is updating, so any scope-aware
     * rewrite has to iterate the cache's keys rather than use setQueriesData.
     */
    list: (notebookId: string, scope: NoteScope) =>
      ["notes", "list", notebookId, scope] as const,

    /** A single note's detail entry. */
    detail: (noteId: string) => ["notes", "detail", noteId] as const,
  },

  notebooks: {
    all: () => ["notebooks"] as const,
    list: () => ["notebooks", "list"] as const,
  },
} as const;

export type NotesListKey = ReturnType<typeof queryKeys.notes.list>;
export type NotebooksListKey = ReturnType<typeof queryKeys.notebooks.list>;

/**
 * Parse a notes list key back into its scope parts, or null if the key is not a
 * notes list key.
 *
 * This is the inverse of `queryKeys.notes.list` and the reason scoped keys carry
 * their scope: cache helpers iterate `queryCache.findAll({ queryKey: ["notes"] })`
 * and use this to decide which entries a given note belongs in.
 */
export function parseNotesListKey(
  key: readonly unknown[],
): { notebookId: string; scope: NoteScope } | null {
  if (key.length !== 4) return null;
  const [entity, kind, notebookId, scope] = key;
  if (entity !== "notes" || kind !== "list") return null;
  if (typeof notebookId !== "string") return null;
  if (scope !== "active" && scope !== "archived") return null;
  return { notebookId, scope };
}
