"use client";

import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ActionResult } from "@/lib/action";
import { queryKeys } from "@/lib/query-keys";
import { reorderNotes, type NoteScope, type NoteView } from "@/lib/notes/view";
import { useToast } from "@/components/toast";
import {
  dropNoteEverywhere,
  newOptimisticId,
  patchNote,
  replaceNotesList,
  restoreNotes,
  settleNotes,
  snapshotNotes,
  upsertNote,
  withEditedText,
  type NotesSnapshot,
} from "@/app/notes/cache";
import {
  createNoteAction,
  deleteNoteAction,
  moveNoteAction,
  setNoteArchivedAction,
  updateNoteAction,
} from "@/app/notes/actions";

/**
 * Every notes mutation. Each one is a useMutation with the same three parts:
 *
 *   onMutate   patch the cache through a named helper from ./cache.ts, so the UI
 *              updates on the same frame as the click. Never an inline
 *              setQueryData here.
 *   onSuccess  soft warnings only. A warning is a toast, never an error state.
 *   onSettled  the one shared settle(), which invalidates by key PREFIX.
 *
 * Each mutation states its ROLLBACK STRATEGY in a comment, and there are only
 * two: snapshot-and-restore for anything confusing if it silently diverges, or
 * no snapshot at all where the settle refetch is a good enough correction.
 */

const settle = (client: QueryClient) => settleNotes(client);

/**
 * Actions return `{ ok: false, error }` rather than throwing, so a mutationFn has
 * to convert a failed result into a rejection for TanStack Query to run onError.
 * This is the only place that conversion happens.
 */
async function unwrap<T>(result: ActionResult<T>): Promise<T> {
  if (result.ok) return result.data;
  throw new ActionError(result.error.code, result.error.message);
}

export class ActionError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "ActionError";
    this.code = code;
  }
}

export type NotesScopeParams = { notebookId: string; scope: NoteScope };

// ------------------------------------------------------------------ create

/**
 * Create.
 *
 * ROLLBACK: SNAPSHOT. A create that vanishes silently is the confusing case, so
 * the previous cache is captured in onMutate and restored in onError. The
 * optimistic row carries a temporary id and rows with one disable their actions
 * (see NoteCard), because editing a row the server has not acknowledged would
 * address a note that does not exist.
 */
export function useCreateNote(params: NotesScopeParams) {
  const client = useQueryClient();
  const toast = useToast();

  return useMutation<
    { note: NoteView; warnings: { code: string; message: string }[] },
    Error,
    /** `id` is the REAL id, minted by the caller. See newNoteId in ./cache.ts. */
    { id: string; title: string; body: string },
    { snapshot: NotesSnapshot; optimisticId: string }
  >({
    mutationFn: async (input) =>
      unwrap(
        await createNoteAction({
          id: input.id,
          notebookId: params.notebookId,
          title: input.title,
          body: input.body,
        }),
      ),

    onMutate: (input) => {
      // A separate, clearly temporary id for the row that only exists in the
      // cache. The persisted id travels in `input.id`.
      const optimisticId = newOptimisticId();
      const snapshot = snapshotNotes(client, optimisticId);

      const existing = client.getQueryData<NoteView[]>(
        queryKeys.notes.list(params.notebookId, params.scope),
      );
      const now = new Date().toISOString();

      const base: NoteView = {
        id: optimisticId,
        notebookId: params.notebookId,
        title: "",
        body: "",
        archived: params.scope === "archived",
        // Top of the list, matching the service's own choice.
        position: existing?.length ? Math.min(...existing.map((n) => n.position)) - 1000 : 0,
        wordCount: 0,
        excerpt: "",
        createdAt: now,
        updatedAt: now,
        optimistic: true,
      };

      // withEditedText fills title, body, wordCount, and excerpt using the same
      // derivation the server uses, so the optimistic card is not missing the
      // fields the server computes.
      upsertNote(client, { ...withEditedText(base, input), optimistic: true });
      return { snapshot, optimisticId };
    },

    onSuccess: (data, _input, context) => {
      // Drop the temporary row, then insert the server's row under its real id.
      if (context) dropNoteEverywhere(client, context.optimisticId);
      upsertNote(client, data.note);

      // SOFT WARNINGS ONLY. A duplicate title was kept, so this is a toast and
      // not an error: the note exists and the user should not be told otherwise.
      for (const warning of data.warnings) toast.show(warning.message, "warning");
    },

    onError: (error, _input, context) => {
      if (context) restoreNotes(client, context.snapshot);
      toast.show(error.message, "error");
    },

    onSettled: () => settle(client),
  });
}

// ------------------------------------------------------------------ edit text

/**
 * Edit title and body.
 *
 * ROLLBACK: NO SNAPSHOT. The user is looking at the text they typed, so a
 * divergence is self correcting: the onSettled prefix invalidation refetches and
 * whatever the server actually stored wins. Snapshotting here would be worse than
 * useless, because restoring an older body would clobber keystrokes the user made
 * while the request was in flight.
 */
export function useEditNote() {
  const client = useQueryClient();
  const toast = useToast();

  return useMutation<NoteView, Error, { id: string; title: string; body: string }>({
    mutationFn: async (input) => unwrap(await updateNoteAction(input)),

    onMutate: (input) => {
      // withEditedText recomputes excerpt and wordCount, the two fields the
      // server derives. Patching body alone would leave both stale on screen.
      patchNote(client, input.id, (note) => withEditedText(note, input));
    },

    onError: (error) => toast.show(error.message, "error"),
    onSettled: () => settle(client),
  });
}

// ------------------------------------------------------------------ archive

/**
 * Archive / unarchive.
 *
 * ROLLBACK: NO SNAPSHOT. A toggle is cheap and self correcting; the settle
 * refetch fixes any divergence.
 *
 * This is also the SCOPE TRANSITION: flipping `archived` means the note no longer
 * matches the list it is sitting in, and patchNote ejects it from that list
 * rather than leaving it there until the refetch.
 */
export function useSetNoteArchived() {
  const client = useQueryClient();
  const toast = useToast();

  return useMutation<NoteView, Error, { id: string; archived: boolean }>({
    mutationFn: async (input) => unwrap(await setNoteArchivedAction(input)),

    onMutate: (input) => {
      patchNote(client, input.id, (note) => ({ ...note, archived: input.archived }));
    },

    onSuccess: (note) => upsertNote(client, note),
    onError: (error) => toast.show(error.message, "error"),
    onSettled: () => settle(client),
  });
}

/**
 * Archive with UNDO instead of a confirm dialog.
 *
 * Archiving is reversible, so the action flips IMMEDIATELY and a roughly five
 * second countdown appears. A second click inside that window undoes it purely
 * locally: only the expiring timer ever talks to the server, so nothing at any
 * point blocks on the network.
 *
 * Pending timers are cleared on unmount, otherwise navigating away mid-countdown
 * would either fire a mutation into a dead tree or leak the timer.
 */
export const UNDO_WINDOW_MS = 5000;

export type PendingUndo = { id: string; title: string; secondsLeft: number };

/**
 * IMPORTANT: the undo affordance must be rendered OUTSIDE the list it archives
 * from, and the reason is worth stating because the obvious placement is wrong.
 *
 * `start()` flips `archived` immediately, and patchNote then ejects the note from
 * the active list because it no longer matches that scope. The row unmounts. An
 * undo button rendered inside the row would therefore vanish on the very click
 * that is supposed to offer it. So this hook exposes a list of pending undos and
 * NotesView renders them as banners above the list, which is also how a user
 * expects a "sent to archive, undo?" affordance to behave.
 */
export function useArchiveWithUndo() {
  const client = useQueryClient();
  const archive = useSetNoteArchived();
  /**
   * The pending entry holds the WHOLE note, not just its id.
   *
   * That is required, not merely convenient: flipping `archived` ejects the note
   * from the active list, so by the time the user clicks Undo there is nothing
   * left in the cache to patch. Undo therefore re-inserts the captured note. This
   * is the snapshot rollback strategy, applied to a local reversal instead of a
   * failed request.
   */
  const [entries, setEntries] = useState<{ note: NoteView; deadline: number }[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const ticker = useRef<ReturnType<typeof setInterval> | null>(null);
  /**
   * The clock, held in state rather than read during render. `Date.now()` in a
   * render body is impure (and the react-hooks/purity rule rejects it), so the
   * interval below advances this and the countdown is derived from it.
   */
  const [now, setNow] = useState(() => Date.now());

  // Clear every pending timer on unmount, otherwise navigating away
  // mid-countdown fires a mutation into a dead tree and leaks the interval.
  useEffect(() => {
    const timeouts = timers.current;
    const interval = ticker;
    return () => {
      for (const timer of timeouts.values()) clearTimeout(timer);
      timeouts.clear();
      if (interval.current) clearInterval(interval.current);
    };
  }, []);

  const stopTickerIfIdle = useCallback((remaining: number) => {
    if (remaining === 0 && ticker.current) {
      clearInterval(ticker.current);
      ticker.current = null;
    }
  }, []);

  const forget = useCallback(
    (noteId: string) => {
      setEntries((current) => {
        const next = current.filter((entry) => entry.note.id !== noteId);
        stopTickerIfIdle(next.length);
        return next;
      });
    },
    [stopTickerIfIdle],
  );

  /**
   * Undo, purely locally. No request is sent, so nothing blocks on the network.
   *
   * Re-inserts the captured note rather than patching: the note was ejected from
   * its list when the archive flipped, so there is nothing there to patch.
   */
  const cancel = useCallback(
    (noteId: string) => {
      const timer = timers.current.get(noteId);
      if (timer) clearTimeout(timer);
      timers.current.delete(noteId);

      setEntries((current) => {
        const entry = current.find((candidate) => candidate.note.id === noteId);
        if (entry) upsertNote(client, { ...entry.note, archived: false });
        const next = current.filter((candidate) => candidate.note.id !== noteId);
        stopTickerIfIdle(next.length);
        return next;
      });
    },
    [client, stopTickerIfIdle],
  );

  const start = useCallback(
    (note: NoteView) => {
      // Flips immediately. The scope ejection happens here, not on commit, which
      // is why the undo banner cannot live inside the row.
      patchNote(client, note.id, (cached) => ({ ...cached, archived: true }));

      const startedAt = Date.now();
      setEntries((current) => [
        ...current.filter((entry) => entry.note.id !== note.id),
        { note, deadline: startedAt + UNDO_WINDOW_MS },
      ]);
      // Seed the clock now, so the first banner shows the full window rather than
      // whatever the last interval tick left behind.
      setNow(startedAt);

      if (!ticker.current) {
        ticker.current = setInterval(() => setNow(Date.now()), 250);
      }

      const timer = setTimeout(() => {
        timers.current.delete(note.id);
        forget(note.id);
        // ONLY the expiring timer talks to the server.
        archive.mutate({ id: note.id, archived: true });
      }, UNDO_WINDOW_MS);

      timers.current.set(note.id, timer);
    },
    [archive, client, forget],
  );

  const pending: PendingUndo[] = entries.map((entry) => ({
    id: entry.note.id,
    title: entry.note.title,
    secondsLeft: Math.max(0, Math.ceil((entry.deadline - now) / 1000)),
  }));

  return { start, cancel, pending };
}

// ------------------------------------------------------------------ delete

/**
 * Delete.
 *
 * ROLLBACK: SNAPSHOT. A destructive remove that silently failed and then
 * reappeared on the next refetch is exactly the confusing case, so the previous
 * cache is captured and restored on error.
 *
 * Uses dropNoteEverywhere, not a patch: the note has to leave EVERY cached view
 * it could appear in, including lists the user is not currently looking at.
 */
export function useDeleteNote() {
  const client = useQueryClient();
  const toast = useToast();

  return useMutation<{ id: string }, Error, { id: string }, { snapshot: NotesSnapshot }>({
    mutationFn: async (input) => unwrap(await deleteNoteAction(input)),

    onMutate: (input) => {
      const snapshot = snapshotNotes(client, input.id);
      dropNoteEverywhere(client, input.id);
      return { snapshot };
    },

    onError: (error, _input, context) => {
      if (context) restoreNotes(client, context.snapshot);
      toast.show(error.message, "error");
    },

    onSettled: () => settle(client),
  });
}

// ------------------------------------------------------------------ reorder

/**
 * Drag to reorder.
 *
 * ROLLBACK: NO SNAPSHOT. The user is watching the list they just dragged, and the
 * settle refetch corrects any divergence. reorderNotes is the same pure function
 * the service uses, so the optimistic order and the server's order agree.
 */
export function useMoveNote(params: NotesScopeParams) {
  const client = useQueryClient();
  const toast = useToast();

  return useMutation<NoteView[], Error, { id: string; fromIndex: number; toIndex: number }>({
    mutationFn: async (input) =>
      unwrap(
        await moveNoteAction({
          id: input.id,
          notebookId: params.notebookId,
          toIndex: input.toIndex,
        }),
      ),

    onMutate: (input) => {
      const key = queryKeys.notes.list(params.notebookId, params.scope);
      const current = client.getQueryData<NoteView[]>(key);
      if (!current) return;
      replaceNotesList(client, {
        notebookId: params.notebookId,
        scope: params.scope,
        notes: reorderNotes(current, input.fromIndex, input.toIndex),
      });
    },

    onSuccess: (notes) => {
      replaceNotesList(client, {
        notebookId: params.notebookId,
        scope: params.scope,
        notes,
      });
    },

    onError: (error) => toast.show(error.message, "error"),
    onSettled: () => settle(client),
  });
}
