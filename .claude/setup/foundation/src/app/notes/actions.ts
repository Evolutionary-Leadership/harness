"use server";

import { z } from "zod";
import { defineAction, type Warning } from "@/lib/action";
import { BODY_MAX_LENGTH, TITLE_MAX_LENGTH, type NoteView } from "@/lib/notes/view";
import * as notesService from "@/server/services/notes-service";

/**
 * Layer 3. Thin by construction: every export here is a defineAction call whose
 * handler does nothing but delegate to a service.
 *
 * No business rules and no SQL. If you are tempted to add an `if` here, it
 * belongs in src/server/services/notes-service.ts.
 */

const noteId = z.string().min(1).max(64);
const notebookId = z.string().min(1).max(64);
const scope = z.enum(["active", "archived"]);

const titleField = z.string().max(TITLE_MAX_LENGTH, `Keep the title under ${TITLE_MAX_LENGTH} characters`);
const bodyField = z.string().max(BODY_MAX_LENGTH, "That note is too long to save");

export const listNotesAction = defineAction({
  name: "notes.list",
  input: z.object({ notebookId, scope }),
  handler: (input, { session, db }): Promise<NoteView[]> =>
    notesService.listNotes(db, {
      userId: session.id,
      notebookId: input.notebookId,
      scope: input.scope,
    }),
});

export const createNoteAction = defineAction({
  name: "notes.create",
  input: z.object({
    /**
     * The id is supplied BY THE CLIENT, which is what makes the create
     * optimistic without a temporary-id swap on the way back, and what keeps the
     * service's SERIALIZABLE body idempotent under retry.
     */
    id: noteId,
    notebookId,
    title: titleField,
    body: bodyField,
  }),
  handler: (input, { session, db }): Promise<{ note: NoteView; warnings: Warning[] }> =>
    notesService.createNote(db, {
      userId: session.id,
      notebookId: input.notebookId,
      id: input.id,
      title: input.title,
      body: input.body,
    }),
});

export const updateNoteAction = defineAction({
  name: "notes.update",
  input: z.object({ id: noteId, title: titleField, body: bodyField }),
  handler: (input, { session, db }): Promise<NoteView> =>
    notesService.updateNote(db, {
      userId: session.id,
      noteId: input.id,
      title: input.title,
      body: input.body,
    }),
});

export const setNoteArchivedAction = defineAction({
  name: "notes.setArchived",
  input: z.object({ id: noteId, archived: z.boolean() }),
  handler: (input, { session, db }): Promise<NoteView> =>
    notesService.setNoteArchived(db, {
      userId: session.id,
      noteId: input.id,
      archived: input.archived,
    }),
});

export const deleteNoteAction = defineAction({
  name: "notes.delete",
  input: z.object({ id: noteId }),
  handler: (input, { session, db }): Promise<{ id: string }> =>
    notesService.deleteNote(db, { userId: session.id, noteId: input.id }),
});

export const moveNoteAction = defineAction({
  name: "notes.move",
  input: z.object({ id: noteId, notebookId, toIndex: z.number().int().min(0).max(10_000) }),
  handler: (input, { session, db }): Promise<NoteView[]> =>
    notesService.moveNote(db, {
      userId: session.id,
      noteId: input.id,
      notebookId: input.notebookId,
      toIndex: input.toIndex,
    }),
});
