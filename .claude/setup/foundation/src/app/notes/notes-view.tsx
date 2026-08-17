"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { authClient } from "@/lib/auth-client";
import { queryKeys } from "@/lib/query-keys";
import { sortNotes, type NoteScope, type NoteView } from "@/lib/notes/view";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { listNotesAction } from "@/app/notes/actions";
import { newNoteId } from "@/app/notes/cache";
import {
  useArchiveWithUndo,
  useCreateNote,
  useDeleteNote,
  useEditNote,
  useMoveNote,
  useSetNoteArchived,
} from "@/app/notes/mutations";
import { NoteCard } from "@/app/notes/note-card";

export function NotesView({
  user,
  notebooks,
  notebookId,
  scope,
  initialNotes,
}: {
  user: { name: string; email: string };
  notebooks: { id: string; name: string }[];
  notebookId: string;
  scope: NoteScope;
  initialNotes: NoteView[];
}) {
  const router = useRouter();
  const client = useQueryClient();

  /**
   * Seed the cache with the Server Component's data under the same key this
   * query uses, so the first paint has the list already and no spinner appears on
   * the hot path. `initialData` covers the first render; the effect keeps it in
   * step when the server re-renders after a scope switch.
   */
  useEffect(() => {
    client.setQueryData(queryKeys.notes.list(notebookId, scope), sortNotes(initialNotes));
  }, [client, initialNotes, notebookId, scope]);

  const notesQuery = useQuery({
    queryKey: queryKeys.notes.list(notebookId, scope),
    queryFn: async (): Promise<NoteView[]> => {
      const result = await listNotesAction({ notebookId, scope });
      if (!result.ok) throw new Error(result.error.message);
      return result.data;
    },
    initialData: sortNotes(initialNotes),
    // A shared notes list is a collaborative feed, so a slow poll is fine.
    refetchInterval: 20_000,
  });

  const notes = notesQuery.data;

  const create = useCreateNote({ notebookId, scope });
  const edit = useEditNote();
  const move = useMoveNote({ notebookId, scope });
  const remove = useDeleteNote();
  const unarchive = useSetNoteArchived();
  const undoableArchive = useArchiveWithUndo();

  const [draftTitle, setDraftTitle] = useState("");
  const [draftBody, setDraftBody] = useState("");
  const [pendingDelete, setPendingDelete] = useState<NoteView | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const fromIndex = notes.findIndex((note) => note.id === active.id);
    const toIndex = notes.findIndex((note) => note.id === over.id);
    if (fromIndex === -1 || toIndex === -1) return;

    move.mutate({ id: String(active.id), fromIndex, toIndex });
  }

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-10">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Notes</h1>
          <p className="text-sm text-slate-600">
            {user.name} ({user.email})
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            void authClient.signOut().then(() => router.replace("/login"));
          }}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-white"
        >
          Sign out
        </button>
      </header>

      <nav className="mt-6 flex items-center gap-2 text-sm">
        {(["active", "archived"] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            aria-current={tab === scope ? "page" : undefined}
            onClick={() => router.push(`/notes?notebook=${notebookId}&scope=${tab}`)}
            className={[
              "rounded-full px-3 py-1 font-medium",
              tab === scope ? "bg-slate-900 text-white" : "border border-slate-300 text-slate-700",
            ].join(" ")}
          >
            {tab === "active" ? "Active" : "Archived"}
          </button>
        ))}
        {notebooks.length > 1 ? (
          <select
            value={notebookId}
            onChange={(event) => router.push(`/notes?notebook=${event.target.value}&scope=${scope}`)}
            className="ml-auto rounded-md border border-slate-300 px-2 py-1"
          >
            {notebooks.map((book) => (
              <option key={book.id} value={book.id}>
                {book.name}
              </option>
            ))}
          </select>
        ) : null}
      </nav>

      {scope === "active" ? (
        <form
          className="mt-6 flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (draftTitle.trim() === "" && draftBody.trim() === "") return;
            // The real id is minted HERE, by the caller, and travels to the
            // server unchanged. See newNoteId in ./cache.ts.
            create.mutate({ id: newNoteId(), title: draftTitle, body: draftBody });
            // Cleared immediately: the optimistic row is already on screen, so
            // leaving the draft in place would look like the note failed to save.
            setDraftTitle("");
            setDraftBody("");
          }}
        >
          <input
            aria-label="New note title"
            placeholder="Title"
            value={draftTitle}
            onChange={(event) => setDraftTitle(event.target.value)}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900"
          />
          <textarea
            aria-label="New note body"
            placeholder="Write something…"
            rows={3}
            value={draftBody}
            onChange={(event) => setDraftBody(event.target.value)}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900"
          />
          <button
            type="submit"
            className="self-start rounded-md bg-slate-900 px-3 py-1.5 text-sm font-semibold text-white hover:bg-slate-800"
          >
            Add note
          </button>
        </form>
      ) : null}

      {/*
        The undo banners live HERE, outside the list, and that placement is load
        bearing. Archiving flips `archived` immediately, which ejects the note from
        this scope's list and unmounts its row, so an undo button rendered inside
        the row would disappear on the click that offers it. See
        useArchiveWithUndo, and ADR 0004 for the rejected alternatives.
      */}
      {undoableArchive.pending.length > 0 ? (
        <ul className="mt-6 flex flex-col gap-2">
          {undoableArchive.pending.map((entry) => (
            <li
              key={entry.id}
              data-testid="note-undo"
              data-note-id={entry.id}
              className="flex items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm"
            >
              <span className="text-amber-900">
                Archived “{entry.title}”. Committing in {entry.secondsLeft}s.
              </span>
              <button
                type="button"
                onClick={() => undoableArchive.cancel(entry.id)}
                className="shrink-0 rounded-md border border-amber-500 px-3 py-1 font-semibold text-amber-900 hover:bg-amber-100"
              >
                Undo
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {notes.length === 0 ? (
        <p className="mt-8 rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
          {scope === "active" ? "No notes yet. Add one above." : "Nothing archived."}
        </p>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext
            items={notes.map((note) => note.id)}
            strategy={verticalListSortingStrategy}
          >
            <ul className="mt-6 flex flex-col gap-3">
              {notes.map((note) => (
                <NoteCard
                  key={note.id}
                  note={note}
                  scope={scope}
                  onSave={(title, body) => edit.mutate({ id: note.id, title, body })}
                  // The whole note, not just its id: undo has to re-insert it
                  // after the archive ejected it from this list.
                  onArchive={() => undoableArchive.start(note)}
                  onUnarchive={() => unarchive.mutate({ id: note.id, archived: false })}
                  onRequestDelete={() => setPendingDelete(note)}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      )}

      {/* Destructive, so an in-app dialog, never window.confirm(). */}
      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete this note?"
        body={`"${pendingDelete?.title ?? ""}" will be gone for good. Archiving is undoable; this is not.`}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          if (pendingDelete) remove.mutate({ id: pendingDelete.id });
          setPendingDelete(null);
        }}
      />
    </main>
  );
}
