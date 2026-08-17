import type { QueryClient } from "@tanstack/react-query";
import { parseNotesListKey, queryKeys } from "@/lib/query-keys";
import {
  deriveNoteFields,
  matchesScope,
  sortNotes,
  type NoteScope,
  type NoteView,
} from "@/lib/notes/view";

/**
 * The optimistic cache helpers.
 *
 * PLAIN FUNCTIONS OVER A QueryClient, deliberately: no hooks, no React, no DOM,
 * no server. That is what makes them unit testable in
 * tests/unit/notes-cache.test.ts, and it is the reason no mutation call site is
 * allowed an inline setQueryData. Every cache write in this app goes through a
 * named helper here.
 */

type NotesListEntry = {
  key: readonly unknown[];
  notebookId: string;
  scope: NoteScope;
  notes: NoteView[];
};

/**
 * Every cached notes list, with its scope decoded from its key.
 *
 * This iteration is not incidental. `setQueriesData` would be the obvious tool,
 * but its updater is NOT told which key it is updating, so it cannot answer
 * "does this note still belong in THIS list?". Scope-aware rewrites have to walk
 * the keys, which is exactly why queryKeys.notes.list carries the scope.
 */
function notesListEntries(client: QueryClient): NotesListEntry[] {
  return client
    .getQueryCache()
    .findAll({ queryKey: queryKeys.notes.all() })
    .flatMap((entry) => {
      const parsed = parseNotesListKey(entry.queryKey);
      if (!parsed) return [];
      const data = entry.state.data;
      if (!Array.isArray(data)) return [];
      return [{ key: entry.queryKey, ...parsed, notes: data as NoteView[] }];
    });
}

function writeList(client: QueryClient, key: readonly unknown[], notes: NoteView[]): void {
  client.setQueryData(key, sortNotes(notes));
}

/**
 * Apply `patch` to one note wherever it is cached.
 *
 * Also ENFORCES SCOPE: if the patched note no longer matches a list's scope (an
 * archive flips `archived`), it is removed from that list rather than left
 * sitting in a list it no longer belongs to until the refetch lands.
 */
export function patchNote(
  client: QueryClient,
  noteId: string,
  patch: (note: NoteView) => NoteView,
): void {
  for (const entry of notesListEntries(client)) {
    let touched = false;
    const next: NoteView[] = [];

    for (const note of entry.notes) {
      if (note.id !== noteId) {
        next.push(note);
        continue;
      }
      touched = true;
      const patched = patch(note);
      if (matchesScope(patched, entry.notebookId, entry.scope)) next.push(patched);
      // else: ejected from this scope on purpose.
    }

    if (touched) writeList(client, entry.key, next);
  }

  const detailKey = queryKeys.notes.detail(noteId);
  const detail = client.getQueryData<NoteView>(detailKey);
  if (detail) client.setQueryData(detailKey, patch(detail));
}

/**
 * Insert or replace a note, filing it into the lists it belongs to and EJECTING
 * it from the ones it no longer matches.
 *
 * The ejection half is the part that is easy to forget: an upsert that moves a
 * note from active to archived has to remove it from the active list, not just
 * add it to the archived one.
 */
export function upsertNote(client: QueryClient, note: NoteView): void {
  for (const entry of notesListEntries(client)) {
    const without = entry.notes.filter((n) => n.id !== note.id);
    const wasPresent = without.length !== entry.notes.length;

    if (matchesScope(note, entry.notebookId, entry.scope)) {
      writeList(client, entry.key, [...without, note]);
    } else if (wasPresent) {
      writeList(client, entry.key, without);
    }
  }

  client.setQueryData(queryKeys.notes.detail(note.id), note);
}

/**
 * Remove a note from EVERY cached view it can appear in.
 *
 * Modelled as one explicit helper precisely so a remove cannot half-happen. A
 * delete that clears the visible list but leaves the note in the archived list
 * reappears the moment the user switches tabs.
 */
export function dropNoteEverywhere(client: QueryClient, noteId: string): void {
  for (const entry of notesListEntries(client)) {
    const without = entry.notes.filter((n) => n.id !== noteId);
    if (without.length !== entry.notes.length) writeList(client, entry.key, without);
  }
  client.removeQueries({ queryKey: queryKeys.notes.detail(noteId), exact: true });
}

/** Replace one list wholesale. For reorder, which is a whole-list fact. */
export function replaceNotesList(
  client: QueryClient,
  params: { notebookId: string; scope: NoteScope; notes: NoteView[] },
): void {
  writeList(client, queryKeys.notes.list(params.notebookId, params.scope), params.notes);
}

/**
 * Build the optimistic version of a note after a title/body edit.
 *
 * THIS IS THE OPTIMISTIC MIRROR OF THE SERVER'S DERIVED FIELDS. `excerpt` is
 * computed on read by the server and `wordCount` is denormalized onto the row by
 * the service, so patching only `body` would leave the card showing the OLD
 * excerpt and the OLD word count until the refetch corrected it, which reads as
 * a bug ("I typed but the preview did not change"). deriveNoteFields is the same
 * function the service uses, so the two cannot drift.
 */
export function withEditedText(
  note: NoteView,
  input: { title: string; body: string },
): NoteView {
  const derived = deriveNoteFields(input);
  return {
    ...note,
    title: derived.title,
    body: derived.body,
    wordCount: derived.wordCount,
    excerpt: derived.excerpt,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Invalidate by PREFIX, so every cached variant refreshes and not only the list
 * the user happens to be looking at. One shared settle for every notes mutation.
 */
export function settleNotes(client: QueryClient): Promise<void> {
  return client.invalidateQueries({ queryKey: queryKeys.notes.all() });
}

// ------------------------------------------------------------------- snapshots

export type NotesSnapshot = {
  lists: { key: readonly unknown[]; notes: NoteView[] }[];
  detail: { key: readonly unknown[]; note: NoteView | undefined }[];
};

/**
 * Snapshot every cached notes list.
 *
 * Only for the mutations whose failure would be CONFUSING if left uncorrected
 * (create with a server round trip, destructive delete). Cheap self-correcting
 * mutations (toggles, reorder, text edits the user is watching) deliberately do
 * NOT snapshot: the onSettled refetch fixes any divergence, and a snapshot there
 * would fight with the user's subsequent keystrokes.
 */
export function snapshotNotes(client: QueryClient, noteId?: string): NotesSnapshot {
  const lists = notesListEntries(client).map((entry) => ({
    key: entry.key,
    notes: entry.notes,
  }));

  const detail = noteId
    ? [
        {
          key: queryKeys.notes.detail(noteId),
          note: client.getQueryData<NoteView>(queryKeys.notes.detail(noteId)),
        },
      ]
    : [];

  return { lists, detail };
}

export function restoreNotes(client: QueryClient, snapshot: NotesSnapshot): void {
  for (const list of snapshot.lists) client.setQueryData(list.key, list.notes);
  for (const entry of snapshot.detail) {
    if (entry.note) client.setQueryData(entry.key, entry.note);
    else client.removeQueries({ queryKey: entry.key, exact: true });
  }
}

// -------------------------------------------------------------- optimistic ids

/**
 * A create involves TWO ids, and keeping them separate is deliberate.
 *
 * `newOptimisticId()` is the CLEARLY TEMPORARY one. It only ever exists in the
 * cache, it is visibly not a uuid, and rows carrying it disable their own actions
 * (see NoteCard): the server has not acknowledged the row, so an edit or a delete
 * would address a note that does not exist yet.
 *
 * `newNoteId()` is the REAL id, minted by the caller and sent to the server. It
 * is generated outside the service's retried transaction body on purpose: an id
 * minted inside a body that runSerializable replays would produce a second row on
 * the second attempt.
 *
 * On success the optimistic row is dropped and the server's row is upserted.
 */
export const OPTIMISTIC_ID_PREFIX = "optimistic-";

export function newOptimisticId(): string {
  return `${OPTIMISTIC_ID_PREFIX}${crypto.randomUUID()}`;
}

/** The id that will be persisted. Caller generated, stable across retries. */
export function newNoteId(): string {
  return crypto.randomUUID();
}

export function isOptimisticId(id: string): boolean {
  return id.startsWith(OPTIMISTIC_ID_PREFIX);
}
