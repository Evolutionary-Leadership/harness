import { randomUUID } from "node:crypto";
import type { DbClient, DbExecutor } from "@/lib/db";
import { NotFoundError } from "@/lib/errors";
import type { Warning } from "@/lib/action";
import {
  deriveNoteFields,
  reorderNotes,
  toNoteView,
  type NoteScope,
  type NoteView,
} from "@/lib/notes/view";
import * as notesRepo from "@/server/repositories/notes-repository";
import * as notebooksRepo from "@/server/repositories/notebooks-repository";
import { runSerializable } from "@/server/tx";

/**
 * Layer 2. Domain logic over repositories.
 *
 * This module never imports the Drizzle client or any schema table: it receives
 * an executor and calls repositories. Readers take a DbExecutor so they compose
 * inside a caller's transaction; mutators take a DbClient because a mutator owns
 * its transaction boundary and decides the isolation level.
 */

const DEFAULT_NOTEBOOK_NAME = "Inbox";

// --------------------------------------------------------------------- readers

export async function listNotes(
  db: DbExecutor,
  params: { userId: string; notebookId: string; scope: NoteScope },
): Promise<NoteView[]> {
  const rows = await notesRepo.listNotes(db, {
    userId: params.userId,
    notebookId: params.notebookId,
    archived: params.scope === "archived",
  });
  return rows.map(toNoteView);
}

export async function getNote(
  db: DbExecutor,
  params: { userId: string; noteId: string },
): Promise<NoteView> {
  const row = await notesRepo.findNote(db, params);
  // Someone else's note and a nonexistent note return the same error on
  // purpose, so probing cannot tell them apart.
  if (!row) throw new NotFoundError("Note");
  return toNoteView(row);
}

export async function listNotebooks(
  db: DbExecutor,
  params: { userId: string },
): Promise<{ id: string; name: string }[]> {
  const rows = await notebooksRepo.listNotebooks(db, params);
  return rows.map((row) => ({ id: row.id, name: row.name }));
}

/**
 * The notebook a signed in user lands in. Creates "Inbox" on first visit, which
 * is why a brand new account can render the notes page with no seeding.
 */
export async function ensureDefaultNotebook(
  db: DbClient,
  params: { userId: string },
): Promise<{ id: string; name: string }> {
  const existing = await notebooksRepo.listNotebooks(db, params);
  const first = existing[0];
  if (first) return { id: first.id, name: first.name };

  // Id generated HERE, outside any retried transaction body.
  const row = await notebooksRepo.ensureNotebook(db, {
    id: randomUUID(),
    userId: params.userId,
    name: DEFAULT_NOTEBOOK_NAME,
  });
  return { id: row.id, name: row.name };
}

// -------------------------------------------------------------------- mutators

export type CreateNoteResult = { note: NoteView; warnings: Warning[] };

/**
 * Create a note at the top of its list.
 *
 * `id` comes from the CALLER (the action generates it), not from inside the
 * transaction: runSerializable retries, and minting an id inside a retried body
 * would produce a second row on the second attempt.
 *
 * A duplicate title is a SOFT WARNING, not an error. The note is created either
 * way and the client surfaces a toast in onSuccess. Blocking here would strand
 * an optimistic row the user already sees.
 */
export async function createNote(
  db: DbClient,
  params: {
    userId: string;
    notebookId: string;
    id: string;
    title: string;
    body: string;
  },
): Promise<CreateNoteResult> {
  const notebook = await notebooksRepo.findNotebook(db, {
    userId: params.userId,
    notebookId: params.notebookId,
  });
  if (!notebook) throw new NotFoundError("Notebook");

  const derived = deriveNoteFields({ title: params.title, body: params.body });
  const warnings: Warning[] = [];

  const row = await runSerializable(db, async (tx) => {
    // SERIALIZABLE because the new note's position is derived from a read of its
    // siblings: at READ COMMITTED two concurrent creates would both compute the
    // same top position.
    const siblings = await notesRepo.listNotes(tx, {
      userId: params.userId,
      notebookId: params.notebookId,
      archived: false,
    });
    const lowest = siblings.reduce(
      (min, note) => Math.min(min, note.position),
      Number.POSITIVE_INFINITY,
    );
    const position = siblings.length === 0 ? 0 : lowest - 1000;

    return notesRepo.insertNote(tx, {
      id: params.id,
      userId: params.userId,
      notebookId: params.notebookId,
      title: derived.title,
      body: derived.body,
      position,
      wordCount: derived.wordCount,
    });
  });

  // Counted AFTER the transaction: a soft warning is not part of the invariant
  // the transaction protects, and doing it inside would make the retried body
  // do redundant work.
  const sameTitle = await notesRepo.countNotesWithTitle(db, {
    userId: params.userId,
    notebookId: params.notebookId,
    title: derived.title,
  });
  if (sameTitle > 1) {
    warnings.push({
      code: "duplicate_title",
      message: `Another note in this notebook is also called "${derived.title}". Kept both.`,
    });
  }

  return { note: toNoteView(row), warnings };
}

/**
 * Update a note's title and body, recomputing the denormalized word count.
 *
 * No SERIALIZABLE transaction: this is a single-row write with no read-derived
 * value, so READ COMMITTED is correct and cheaper. Last write wins, which is what
 * the user editing the text in front of them expects.
 */
export async function updateNote(
  db: DbClient,
  params: { userId: string; noteId: string; title: string; body: string },
): Promise<NoteView> {
  const derived = deriveNoteFields({ title: params.title, body: params.body });
  const row = await notesRepo.updateNote(db, {
    userId: params.userId,
    noteId: params.noteId,
    patch: { title: derived.title, body: derived.body, wordCount: derived.wordCount },
  });
  if (!row) throw new NotFoundError("Note");
  return toNoteView(row);
}

/**
 * Archive or unarchive. This is the SCOPE TRANSITION: the returned note no
 * longer belongs to the list it came from, and the client must eject it there
 * rather than wait for a refetch.
 */
export async function setNoteArchived(
  db: DbClient,
  params: { userId: string; noteId: string; archived: boolean },
): Promise<NoteView> {
  const row = await notesRepo.updateNote(db, {
    userId: params.userId,
    noteId: params.noteId,
    patch: { archived: params.archived },
  });
  if (!row) throw new NotFoundError("Note");
  return toNoteView(row);
}

export async function deleteNote(
  db: DbClient,
  params: { userId: string; noteId: string },
): Promise<{ id: string }> {
  const removed = await notesRepo.deleteNote(db, params);
  if (!removed) throw new NotFoundError("Note");
  return { id: params.noteId };
}

/**
 * Move a note within its list and renumber the whole list.
 *
 * SERIALIZABLE: the new order is computed from a read of the current order, so
 * two concurrent drags at READ COMMITTED would each renumber against a stale
 * snapshot and interleave. The body is idempotent because reorderNotes is a pure
 * function of (current order, from, to) and setNotePositions writes exact keys,
 * so a replay converges to the same positions.
 */
export async function moveNote(
  db: DbClient,
  params: { userId: string; noteId: string; notebookId: string; toIndex: number },
): Promise<NoteView[]> {
  return runSerializable(db, async (tx) => {
    const rows = await notesRepo.listNotes(tx, {
      userId: params.userId,
      notebookId: params.notebookId,
      archived: false,
    });
    const current = rows.map(toNoteView);

    const fromIndex = current.findIndex((note) => note.id === params.noteId);
    if (fromIndex === -1) throw new NotFoundError("Note");

    const reordered = reorderNotes(current, fromIndex, params.toIndex);
    await notesRepo.setNotePositions(tx, {
      userId: params.userId,
      positions: reordered.map((note) => ({ id: note.id, position: note.position })),
    });
    return reordered;
  });
}
