import { beforeEach, describe, expect, it } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import type { NoteView } from "@/lib/notes/view";
import { countWords } from "@/lib/notes/view";
import {
  dropNoteEverywhere,
  isOptimisticId,
  newNoteId,
  newOptimisticId,
  patchNote,
  replaceNotesList,
  restoreNotes,
  snapshotNotes,
  upsertNote,
  withEditedText,
} from "@/app/notes/cache";

/**
 * The cache helpers are plain functions over a QueryClient, so this whole file
 * runs with no DOM, no React, and no server. That is the point of keeping them
 * out of the hooks.
 */

const NB1 = "nb1";
const NB2 = "nb2";

function note(overrides: Partial<NoteView> = {}): NoteView {
  return {
    id: "n1",
    notebookId: NB1,
    title: "Title",
    body: "one two",
    archived: false,
    position: 0,
    wordCount: 2,
    excerpt: "one two",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

let client: QueryClient;

/** Seed a list entry so it exists in the cache and is therefore discoverable. */
function seedList(notebookId: string, scope: "active" | "archived", notes: NoteView[]): void {
  client.setQueryData(queryKeys.notes.list(notebookId, scope), notes);
}

function readList(notebookId: string, scope: "active" | "archived"): NoteView[] | undefined {
  return client.getQueryData<NoteView[]>(queryKeys.notes.list(notebookId, scope));
}

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

describe("patchNote", () => {
  it("patches the note in every list it appears in", () => {
    seedList(NB1, "active", [note({ id: "a" }), note({ id: "b" })]);
    seedList(NB2, "active", [note({ id: "a", notebookId: NB2 })]);

    patchNote(client, "a", (n) => ({ ...n, title: "patched" }));

    expect(readList(NB1, "active")?.find((n) => n.id === "a")?.title).toBe("patched");
    expect(readList(NB1, "active")?.find((n) => n.id === "b")?.title).toBe("Title");
    expect(readList(NB2, "active")?.find((n) => n.id === "a")?.title).toBe("patched");
  });

  it("leaves lists that do not contain the note untouched", () => {
    const untouched = [note({ id: "b" })];
    seedList(NB1, "active", untouched);
    patchNote(client, "missing", (n) => ({ ...n, title: "nope" }));
    expect(readList(NB1, "active")).toBe(untouched);
  });

  it("patches the detail entry too", () => {
    client.setQueryData(queryKeys.notes.detail("a"), note({ id: "a" }));
    patchNote(client, "a", (n) => ({ ...n, title: "patched" }));
    expect(client.getQueryData<NoteView>(queryKeys.notes.detail("a"))?.title).toBe("patched");
  });

  /**
   * The scoped-list ejection rule. A patch that flips `archived` makes the note
   * stop matching the "active" list, so it has to LEAVE that list rather than
   * linger there until the refetch.
   */
  it("ejects a note from a list whose scope it no longer matches", () => {
    seedList(NB1, "active", [note({ id: "a" }), note({ id: "b" })]);
    seedList(NB1, "archived", []);

    patchNote(client, "a", (n) => ({ ...n, archived: true }));

    expect(readList(NB1, "active")?.map((n) => n.id)).toEqual(["b"]);
  });

  it("keeps the note when the patch does not change its scope", () => {
    seedList(NB1, "active", [note({ id: "a" })]);
    patchNote(client, "a", (n) => ({ ...n, title: "still active" }));
    expect(readList(NB1, "active")?.map((n) => n.id)).toEqual(["a"]);
  });

  it("re-sorts after a patch that changes position", () => {
    seedList(NB1, "active", [note({ id: "a", position: 0 }), note({ id: "b", position: 1000 })]);
    patchNote(client, "a", (n) => ({ ...n, position: 5000 }));
    expect(readList(NB1, "active")?.map((n) => n.id)).toEqual(["b", "a"]);
  });
});

describe("upsertNote", () => {
  it("inserts a note into a list it matches", () => {
    seedList(NB1, "active", [note({ id: "a", position: 0 })]);
    upsertNote(client, note({ id: "b", position: 1000 }));
    expect(readList(NB1, "active")?.map((n) => n.id)).toEqual(["a", "b"]);
  });

  it("replaces an existing note rather than duplicating it", () => {
    seedList(NB1, "active", [note({ id: "a", title: "old" })]);
    upsertNote(client, note({ id: "a", title: "new" }));
    const list = readList(NB1, "active");
    expect(list).toHaveLength(1);
    expect(list?.[0]?.title).toBe("new");
  });

  /**
   * The case the spec singles out: an upsert that moves a note from one scope to
   * another must remove it from the scope it left.
   */
  it("moves a note between scopes, ejecting it from the old one", () => {
    seedList(NB1, "active", [note({ id: "a" }), note({ id: "b" })]);
    seedList(NB1, "archived", []);

    upsertNote(client, note({ id: "a", archived: true }));

    expect(readList(NB1, "active")?.map((n) => n.id)).toEqual(["b"]);
    expect(readList(NB1, "archived")?.map((n) => n.id)).toEqual(["a"]);
  });

  it("does not add a note to a list belonging to another notebook", () => {
    seedList(NB1, "active", []);
    seedList(NB2, "active", []);
    upsertNote(client, note({ id: "a", notebookId: NB1 }));
    expect(readList(NB1, "active")?.map((n) => n.id)).toEqual(["a"]);
    expect(readList(NB2, "active")).toEqual([]);
  });

  it("writes the detail entry", () => {
    upsertNote(client, note({ id: "a" }));
    expect(client.getQueryData<NoteView>(queryKeys.notes.detail("a"))?.id).toBe("a");
  });
});

describe("dropNoteEverywhere", () => {
  it("removes the note from every cached view, visible or not", () => {
    seedList(NB1, "active", [note({ id: "a" }), note({ id: "b" })]);
    seedList(NB1, "archived", [note({ id: "a", archived: true })]);
    seedList(NB2, "active", [note({ id: "a", notebookId: NB2 })]);
    client.setQueryData(queryKeys.notes.detail("a"), note({ id: "a" }));

    dropNoteEverywhere(client, "a");

    expect(readList(NB1, "active")?.map((n) => n.id)).toEqual(["b"]);
    expect(readList(NB1, "archived")).toEqual([]);
    expect(readList(NB2, "active")).toEqual([]);
    expect(client.getQueryData(queryKeys.notes.detail("a"))).toBeUndefined();
  });

  it("is a no-op for an id that is not cached", () => {
    const original = [note({ id: "b" })];
    seedList(NB1, "active", original);
    dropNoteEverywhere(client, "missing");
    expect(readList(NB1, "active")).toBe(original);
  });
});

describe("replaceNotesList", () => {
  it("replaces one list wholesale and sorts it", () => {
    seedList(NB1, "active", [note({ id: "a" })]);
    replaceNotesList(client, {
      notebookId: NB1,
      scope: "active",
      notes: [note({ id: "y", position: 2000 }), note({ id: "x", position: 1000 })],
    });
    expect(readList(NB1, "active")?.map((n) => n.id)).toEqual(["x", "y"]);
  });
});

describe("withEditedText", () => {
  /**
   * The optimistic mirror of the server's derived fields. If this stopped
   * recomputing excerpt and wordCount, an edited card would keep showing the old
   * preview until the refetch landed.
   */
  it("recomputes the derived fields, not just the body", () => {
    const before = note({ body: "one two", wordCount: 2, excerpt: "one two" });
    const after = withEditedText(before, { title: "T", body: "one two three four" });

    expect(after.wordCount).toBe(4);
    expect(after.excerpt).toBe("one two three four");
    expect(after.body).toBe("one two three four");
  });

  it("keeps wordCount consistent with countWords for any body", () => {
    const bodies = ["", "  ", "a", "a b c", "line\nbreak", "  padded  "];
    for (const body of bodies) {
      expect(withEditedText(note(), { title: "T", body }).wordCount).toBe(countWords(body));
    }
  });

  it("normalizes the title", () => {
    expect(withEditedText(note(), { title: "   ", body: "x" }).title).toBe("Untitled note");
  });

  it("bumps updatedAt", () => {
    const before = note({ updatedAt: "2020-01-01T00:00:00.000Z" });
    const after = withEditedText(before, { title: "T", body: "x" });
    expect(after.updatedAt).not.toBe(before.updatedAt);
  });
});

describe("snapshot and restore", () => {
  it("restores every list captured in the snapshot", () => {
    seedList(NB1, "active", [note({ id: "a" }), note({ id: "b" })]);
    seedList(NB1, "archived", [note({ id: "c", archived: true })]);

    const snapshot = snapshotNotes(client);
    dropNoteEverywhere(client, "a");
    dropNoteEverywhere(client, "c");
    expect(readList(NB1, "active")?.map((n) => n.id)).toEqual(["b"]);

    restoreNotes(client, snapshot);

    expect(readList(NB1, "active")?.map((n) => n.id)).toEqual(["a", "b"]);
    expect(readList(NB1, "archived")?.map((n) => n.id)).toEqual(["c"]);
  });

  it("removes a detail entry that did not exist when the snapshot was taken", () => {
    seedList(NB1, "active", []);
    const snapshot = snapshotNotes(client, "new");
    upsertNote(client, note({ id: "new" }));
    expect(client.getQueryData(queryKeys.notes.detail("new"))).toBeDefined();

    restoreNotes(client, snapshot);

    expect(client.getQueryData(queryKeys.notes.detail("new"))).toBeUndefined();
  });

  it("round-trips a create rollback: the optimistic row is gone afterwards", () => {
    seedList(NB1, "active", [note({ id: "existing" })]);

    const optimisticId = newOptimisticId();
    const snapshot = snapshotNotes(client, optimisticId);
    upsertNote(client, note({ id: optimisticId, optimistic: true }));
    expect(readList(NB1, "active")).toHaveLength(2);

    restoreNotes(client, snapshot);

    expect(readList(NB1, "active")?.map((n) => n.id)).toEqual(["existing"]);
  });
});

describe("optimistic ids", () => {
  it("marks an optimistic id as clearly temporary", () => {
    const id = newOptimisticId();
    expect(isOptimisticId(id)).toBe(true);
    expect(id.startsWith("optimistic-")).toBe(true);
  });

  it("does not mark a real id as optimistic", () => {
    expect(isOptimisticId(newNoteId())).toBe(false);
  });

  it("mints distinct ids", () => {
    expect(newOptimisticId()).not.toBe(newOptimisticId());
    expect(newNoteId()).not.toBe(newNoteId());
  });
});
