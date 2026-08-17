import { redirect } from "next/navigation";
import { z } from "zod";
import { getSession } from "@/lib/auth-server";
import { getDb } from "@/lib/db";
import type { NoteScope } from "@/lib/notes/view";
import * as notesService from "@/server/services/notes-service";
import { NotesView } from "@/app/notes/notes-view";

export const dynamic = "force-dynamic";

/** Search params are external input, so they are parsed like any other. */
const searchParamsSchema = z.object({
  scope: z.enum(["active", "archived"]).default("active"),
  notebook: z.string().min(1).max(64).optional(),
});

export default async function NotesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getSession();
  // Convenience for redirect UX. The security boundary is that every action and
  // route re-verifies the session itself; this check is not load bearing.
  if (!session) redirect("/login");

  const parsed = searchParamsSchema.safeParse(await searchParams);
  const scope: NoteScope = parsed.success ? parsed.data.scope : "active";

  const db = getDb();
  const notebook = await notesService.ensureDefaultNotebook(db, { userId: session.id });
  const notebooks = await notesService.listNotebooks(db, { userId: session.id });

  const notebookId =
    parsed.success && parsed.data.notebook && notebooks.some((n) => n.id === parsed.data.notebook)
      ? parsed.data.notebook
      : notebook.id;

  // NO BLOCKING SPINNER ON THE HOT PATH. The first list is fetched here, on the
  // server, and handed to the client as `initialNotes`, which seeds the query
  // cache under exactly the key the client would otherwise have fetched into
  // (queryKeys.notes.list(notebookId, scope)). The archived list is secondary and
  // fetches lazily when the user switches to it.
  const initialNotes = await notesService.listNotes(db, {
    userId: session.id,
    notebookId,
    scope,
  });

  return (
    <NotesView
      user={{ name: session.name, email: session.email }}
      notebooks={notebooks}
      notebookId={notebookId}
      scope={scope}
      initialNotes={initialNotes}
    />
  );
}
