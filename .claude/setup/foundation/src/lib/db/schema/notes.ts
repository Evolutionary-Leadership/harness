import { relations } from "drizzle-orm";
import { boolean, index, integer, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
// Relative, not "@/lib/db/schema/auth": drizzle-kit bundles the schema with
// esbuild and does not resolve the tsconfig `@/*` alias.
import { user } from "./auth";

/**
 * A notebook is the scope a note lives in. Every user gets at least one
 * ("Inbox", created by the seed and on signup).
 */
export const notebooks = pgTable(
  "notebooks",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("notebooks_user_id_idx").on(table.userId),
    // One notebook name per user. The service turns the resulting 23505 into a
    // soft warning rather than an error, so seeding twice is a no-op.
    uniqueIndex("notebooks_user_id_name_key").on(table.userId, table.name),
  ],
);

export const notes = pgTable(
  "notes",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    notebookId: text("notebook_id")
      .notNull()
      .references(() => notebooks.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    body: text("body").notNull().default(""),
    /**
     * Archiving is the scope transition the optimistic cache has to handle: a
     * note that flips to archived must be ejected from the "active" list rather
     * than left there until the refetch. See src/app/notes/mutations.ts.
     */
    archived: boolean("archived").notNull().default(false),
    /** Sort order within (userId, notebookId, archived). Sparse, gaps are fine. */
    position: integer("position").notNull().default(0),
    /**
     * DENORMALIZED, derived from `body`. Written by the service on every create
     * and update, never by hand. The invariant (stored value always equals
     * countWords(body)) is a fast-check property test in
     * tests/unit/note-view.test.ts and asserted against real rows in
     * tests/integration/notes-repository.test.ts.
     */
    wordCount: integer("word_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Covers the list query: every read is scoped to one user's one notebook,
    // filtered by archived, ordered by position.
    index("notes_scope_idx").on(table.userId, table.notebookId, table.archived, table.position),
    index("notes_notebook_id_idx").on(table.notebookId),
  ],
);

export const notebooksRelations = relations(notebooks, ({ many, one }) => ({
  notes: many(notes),
  owner: one(user, { fields: [notebooks.userId], references: [user.id] }),
}));

export const notesRelations = relations(notes, ({ one }) => ({
  notebook: one(notebooks, { fields: [notes.notebookId], references: [notebooks.id] }),
  owner: one(user, { fields: [notes.userId], references: [user.id] }),
}));

/** The persisted row shape. The read model adds derived fields; see NoteView. */
export type NoteRow = typeof notes.$inferSelect;
export type NotebookRow = typeof notebooks.$inferSelect;
