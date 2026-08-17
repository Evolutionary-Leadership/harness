import { and, asc, eq } from "drizzle-orm";
import type { DbExecutor } from "@/lib/db";
import { notebooks, type NotebookRow } from "@/lib/db/schema/notes";

/** Layer 1. The only module allowed to touch the `notebooks` table. */

export async function listNotebooks(
  db: DbExecutor,
  params: { userId: string },
): Promise<NotebookRow[]> {
  return db.query.notebooks.findMany({
    where: eq(notebooks.userId, params.userId),
    orderBy: [asc(notebooks.createdAt), asc(notebooks.id)],
  });
}

export async function findNotebook(
  db: DbExecutor,
  params: { userId: string; notebookId: string },
): Promise<NotebookRow | undefined> {
  return db.query.notebooks.findFirst({
    where: and(eq(notebooks.id, params.notebookId), eq(notebooks.userId, params.userId)),
  });
}

/**
 * Insert a notebook, or return the one already holding that (userId, name).
 *
 * Idempotent by construction: the caller generates the id, and the unique index
 * on (user_id, name) plus ON CONFLICT DO NOTHING means running this twice yields
 * one row. That is what lets the seed run repeatedly with unchanged row counts.
 */
export async function ensureNotebook(
  db: DbExecutor,
  values: { id: string; userId: string; name: string },
): Promise<NotebookRow> {
  const [inserted] = await db
    .insert(notebooks)
    .values(values)
    .onConflictDoNothing({ target: [notebooks.userId, notebooks.name] })
    .returning();

  if (inserted) return inserted;

  const existing = await db.query.notebooks.findFirst({
    where: and(eq(notebooks.userId, values.userId), eq(notebooks.name, values.name)),
  });
  if (!existing) {
    throw new Error(`ensureNotebook: notebook "${values.name}" neither inserted nor found`);
  }
  return existing;
}
