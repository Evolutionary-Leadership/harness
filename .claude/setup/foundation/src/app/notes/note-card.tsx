"use client";

import { useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { NoteScope, NoteView } from "@/lib/notes/view";
import { isOptimisticId } from "@/app/notes/cache";

export function NoteCard({
  note,
  scope,
  onSave,
  onArchive,
  onUnarchive,
  onRequestDelete,
}: {
  note: NoteView;
  scope: NoteScope;
  onSave: (title: string, body: string) => void;
  onArchive: () => void;
  onUnarchive: () => void;
  onRequestDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(note.title);
  const [body, setBody] = useState(note.body);

  /**
   * A row whose id is still the temporary optimistic one has NOT been
   * acknowledged by the server, so every action that would address it by id is
   * disabled. Editing or deleting it would target a note that does not exist yet.
   */
  const unacknowledged = isOptimisticId(note.id) || note.optimistic === true;

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: note.id,
    disabled: unacknowledged || scope === "archived",
  });

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      data-dragging={isDragging}
      data-testid="note-card"
      // A stable hook for tests and for debugging. The title is not usable as
      // one: in edit mode it lives in an input's value, not in text content.
      data-note-id={note.id}
      className={[
        "rounded-xl border bg-white p-4",
        isDragging ? "border-slate-900 shadow-lg" : "border-slate-200",
        unacknowledged ? "opacity-60" : "",
      ].join(" ")}
    >
      <div className="flex items-start gap-3">
        {scope === "active" ? (
          <button
            type="button"
            aria-label={`Reorder ${note.title}`}
            disabled={unacknowledged}
            className="mt-0.5 cursor-grab rounded px-1 text-slate-400 hover:text-slate-700 disabled:cursor-not-allowed"
            {...attributes}
            {...listeners}
          >
            ⠿
          </button>
        ) : null}

        <div className="min-w-0 flex-1">
          {editing ? (
            <form
              className="flex flex-col gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                onSave(title, body);
                setEditing(false);
              }}
            >
              <input
                aria-label="Note title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                className="rounded-md border border-slate-300 px-2 py-1 text-sm font-medium outline-none focus:border-slate-900"
              />
              <textarea
                aria-label="Note body"
                rows={4}
                value={body}
                onChange={(event) => setBody(event.target.value)}
                className="rounded-md border border-slate-300 px-2 py-1 text-sm outline-none focus:border-slate-900"
              />
              <div className="flex gap-2">
                <button
                  type="submit"
                  className="rounded-md bg-slate-900 px-3 py-1 text-xs font-semibold text-white hover:bg-slate-800"
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setTitle(note.title);
                    setBody(note.body);
                    setEditing(false);
                  }}
                  className="rounded-md border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700"
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <>
              <h2 className="truncate text-sm font-semibold text-slate-900">{note.title}</h2>
              {/*
                `excerpt` and `wordCount` are derived by the server. The
                optimistic patch recomputes both (withEditedText), so they update
                on the same frame as an edit rather than lagging until the refetch.
              */}
              <p data-testid="note-excerpt" className="mt-1 text-sm text-slate-600">
                {note.excerpt || <span className="italic text-slate-400">Empty note</span>}
              </p>
              <p data-testid="note-wordcount" className="mt-2 text-xs text-slate-400">
                {note.wordCount} {note.wordCount === 1 ? "word" : "words"}
              </p>
            </>
          )}
        </div>

        {!editing ? (
          <div className="flex shrink-0 flex-col items-end gap-1 text-xs">
            <button
              type="button"
              disabled={unacknowledged}
              onClick={() => setEditing(true)}
              className="rounded px-2 py-1 font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-40"
            >
              Edit
            </button>
            {scope === "active" ? (
              <button
                type="button"
                disabled={unacknowledged}
                onClick={onArchive}
                className="rounded px-2 py-1 font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-40"
              >
                Archive
              </button>
            ) : (
              <button
                type="button"
                disabled={unacknowledged}
                onClick={onUnarchive}
                className="rounded px-2 py-1 font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-40"
              >
                Unarchive
              </button>
            )}
            <button
              type="button"
              disabled={unacknowledged}
              onClick={onRequestDelete}
              className="rounded px-2 py-1 font-medium text-red-600 hover:bg-red-50 disabled:opacity-40"
            >
              Delete
            </button>
          </div>
        ) : null}
      </div>
    </li>
  );
}
