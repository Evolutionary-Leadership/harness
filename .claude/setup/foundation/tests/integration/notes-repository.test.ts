import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import fc from "fast-check";
import { countWords } from "@/lib/notes/view";
import * as notesRepo from "@/server/repositories/notes-repository";
import * as notesService from "@/server/services/notes-service";
import { makeNotebook, setupIntegrationDb, type IntegrationDb } from "./helpers/database";

// Definite assignment: beforeAll sets it. The one place that cannot assume so
// is afterAll, which runs even when beforeAll threw, and guards with `?.`.
let ctx!: IntegrationDb;
let aliceNotebook: string;
let bobNotebook: string;

beforeAll(async () => {
  ctx = await setupIntegrationDb();
});

afterAll(async () => {
  // beforeAll may have thrown (no reachable database), leaving ctx unassigned.
  // Without the guard, that real failure is buried under a teardown TypeError.
  await ctx?.teardown();
});

beforeEach(async () => {
  await ctx.reset();
  aliceNotebook = await makeNotebook(ctx.db, ctx.users.alice);
  bobNotebook = await makeNotebook(ctx.db, ctx.users.bob);
});

async function createFor(userId: string, notebookId: string, title: string, body = "") {
  const result = await notesService.createNote(ctx.db, {
    userId,
    notebookId,
    id: randomUUID(),
    title,
    body,
  });
  return result.note;
}

describe("notes repository and service", () => {
  it("creates and lists a note", async () => {
    await createFor(ctx.users.alice, aliceNotebook, "First", "one two three");
    const notes = await notesService.listNotes(ctx.db, {
      userId: ctx.users.alice,
      notebookId: aliceNotebook,
      scope: "active",
    });
    expect(notes).toHaveLength(1);
    expect(notes[0]?.title).toBe("First");
    expect(notes[0]?.wordCount).toBe(3);
    expect(notes[0]?.excerpt).toBe("one two three");
  });

  it("puts a new note at the top of the list", async () => {
    await createFor(ctx.users.alice, aliceNotebook, "older");
    await createFor(ctx.users.alice, aliceNotebook, "newer");
    const notes = await notesService.listNotes(ctx.db, {
      userId: ctx.users.alice,
      notebookId: aliceNotebook,
      scope: "active",
    });
    expect(notes.map((n) => n.title)).toEqual(["newer", "older"]);
  });

  it("returns a soft warning for a duplicate title but keeps the note", async () => {
    await createFor(ctx.users.alice, aliceNotebook, "Same");
    const second = await notesService.createNote(ctx.db, {
      userId: ctx.users.alice,
      notebookId: aliceNotebook,
      id: randomUUID(),
      title: "Same",
      body: "",
    });

    expect(second.warnings.map((w) => w.code)).toEqual(["duplicate_title"]);
    // The note exists regardless: a warning is not a failure.
    const notes = await notesService.listNotes(ctx.db, {
      userId: ctx.users.alice,
      notebookId: aliceNotebook,
      scope: "active",
    });
    expect(notes).toHaveLength(2);
  });

  it("moves a note between scopes when archived", async () => {
    const note = await createFor(ctx.users.alice, aliceNotebook, "Archive me");
    await notesService.setNoteArchived(ctx.db, {
      userId: ctx.users.alice,
      noteId: note.id,
      archived: true,
    });

    const active = await notesService.listNotes(ctx.db, {
      userId: ctx.users.alice,
      notebookId: aliceNotebook,
      scope: "active",
    });
    const archived = await notesService.listNotes(ctx.db, {
      userId: ctx.users.alice,
      notebookId: aliceNotebook,
      scope: "archived",
    });
    expect(active).toHaveLength(0);
    expect(archived.map((n) => n.id)).toEqual([note.id]);
  });

  it("reorders and renumbers the whole list", async () => {
    const a = await createFor(ctx.users.alice, aliceNotebook, "a");
    const b = await createFor(ctx.users.alice, aliceNotebook, "b");
    const c = await createFor(ctx.users.alice, aliceNotebook, "c");
    // Creation puts each new note on top, so the list reads c, b, a.
    const moved = await notesService.moveNote(ctx.db, {
      userId: ctx.users.alice,
      noteId: c.id,
      notebookId: aliceNotebook,
      toIndex: 2,
    });
    expect(moved.map((n) => n.id)).toEqual([b.id, a.id, c.id]);

    const persisted = await notesService.listNotes(ctx.db, {
      userId: ctx.users.alice,
      notebookId: aliceNotebook,
      scope: "active",
    });
    expect(persisted.map((n) => n.id)).toEqual([b.id, a.id, c.id]);
  });

  it("casts counts to a real number, not a bigint string", async () => {
    await createFor(ctx.users.alice, aliceNotebook, "one");
    await createFor(ctx.users.alice, aliceNotebook, "two");

    const total = await notesRepo.countNotes(ctx.db, {
      userId: ctx.users.alice,
      notebookId: aliceNotebook,
      archived: false,
    });
    expect(total).toBe(2);
    expect(typeof total).toBe("number");
    // The bug this guards: a bigint arrives as "2", and "2" + 1 === "21".
    expect(total + 1).toBe(3);
  });
});

/**
 * The cross-user boundary, tested explicitly. Another user's row must be
 * invisible, unupdatable, and undeletable, and every case must fail the same way
 * a missing row does so probing cannot distinguish them.
 */
describe("cross-user isolation", () => {
  it("does not list another user's notes", async () => {
    await createFor(ctx.users.bob, bobNotebook, "Bob's private note");

    const aliceSees = await notesService.listNotes(ctx.db, {
      userId: ctx.users.alice,
      notebookId: bobNotebook,
      scope: "active",
    });
    expect(aliceSees).toEqual([]);
  });

  it("does not read another user's note by id", async () => {
    const bobNote = await createFor(ctx.users.bob, bobNotebook, "Bob's note");
    await expect(
      notesService.getNote(ctx.db, { userId: ctx.users.alice, noteId: bobNote.id }),
    ).rejects.toThrow(/not found/i);
  });

  it("cannot update another user's note", async () => {
    const bobNote = await createFor(ctx.users.bob, bobNotebook, "Bob's note", "original");

    await expect(
      notesService.updateNote(ctx.db, {
        userId: ctx.users.alice,
        noteId: bobNote.id,
        title: "hijacked",
        body: "hijacked",
      }),
    ).rejects.toThrow(/not found/i);

    // And the row is genuinely untouched.
    const stillBobs = await notesService.getNote(ctx.db, {
      userId: ctx.users.bob,
      noteId: bobNote.id,
    });
    expect(stillBobs.title).toBe("Bob's note");
    expect(stillBobs.body).toBe("original");
  });

  it("cannot archive another user's note", async () => {
    const bobNote = await createFor(ctx.users.bob, bobNotebook, "Bob's note");
    await expect(
      notesService.setNoteArchived(ctx.db, {
        userId: ctx.users.alice,
        noteId: bobNote.id,
        archived: true,
      }),
    ).rejects.toThrow(/not found/i);
    expect(
      (await notesService.getNote(ctx.db, { userId: ctx.users.bob, noteId: bobNote.id })).archived,
    ).toBe(false);
  });

  it("cannot delete another user's note", async () => {
    const bobNote = await createFor(ctx.users.bob, bobNotebook, "Bob's note");
    await expect(
      notesService.deleteNote(ctx.db, { userId: ctx.users.alice, noteId: bobNote.id }),
    ).rejects.toThrow(/not found/i);

    // Still there.
    await expect(
      notesService.getNote(ctx.db, { userId: ctx.users.bob, noteId: bobNote.id }),
    ).resolves.toMatchObject({ id: bobNote.id });
  });

  it("cannot create a note in another user's notebook", async () => {
    await expect(
      notesService.createNote(ctx.db, {
        userId: ctx.users.alice,
        notebookId: bobNotebook,
        id: randomUUID(),
        title: "trespassing",
        body: "",
      }),
    ).rejects.toThrow(/not found/i);
  });

  it("does not fetch another user's notes through the id list", async () => {
    const bobNote = await createFor(ctx.users.bob, bobNotebook, "Bob's note");
    const aliceNote = await createFor(ctx.users.alice, aliceNotebook, "Alice's note");

    const fetched = await notesRepo.findNotesByIds(ctx.db, {
      userId: ctx.users.alice,
      noteIds: [aliceNote.id, bobNote.id],
    });
    expect(fetched.map((n) => n.id)).toEqual([aliceNote.id]);
  });
});

/**
 * The empty-list discipline idList() documents. idList([]) is a TRUE fragment, so
 * it matches everything; the repository therefore short circuits, and this proves
 * it against real rows rather than trusting the comment.
 */
describe("empty id list short circuits", () => {
  it("returns nothing rather than everything, on the Drizzle path", async () => {
    await createFor(ctx.users.alice, aliceNotebook, "one");
    await createFor(ctx.users.alice, aliceNotebook, "two");

    const fetched = await notesRepo.findNotesByIds(ctx.db, {
      userId: ctx.users.alice,
      noteIds: [],
    });
    expect(fetched).toEqual([]);
  });

  it("returns nothing rather than everything, on the raw-SQL path", async () => {
    await createFor(ctx.users.alice, aliceNotebook, "one");
    await createFor(ctx.users.alice, aliceNotebook, "two");

    const fetched = await notesRepo.findNotesByIdsRaw(ctx.db, {
      userId: ctx.users.alice,
      noteIds: [],
    });
    expect(fetched).toEqual([]);
  });

  it("binds a multi-value raw IN list without a malformed array literal", async () => {
    // The trap: `= ANY(${array})` sends one parameter and Postgres raises
    // "malformed array literal". idList builds N placeholders instead.
    const a = await createFor(ctx.users.alice, aliceNotebook, "a");
    const b = await createFor(ctx.users.alice, aliceNotebook, "b");
    await createFor(ctx.users.alice, aliceNotebook, "c");

    const fetched = await notesRepo.findNotesByIdsRaw(ctx.db, {
      userId: ctx.users.alice,
      noteIds: [a.id, b.id],
    });
    expect(fetched.map((n) => n.id).sort()).toEqual([a.id, b.id].sort());
  });
});

/**
 * The denormalized `word_count` column against a compute-on-read oracle, over
 * arbitrary bodies, through the real database. The unit test proves the pure
 * function; this proves what is actually PERSISTED matches it.
 */
describe("word_count stays consistent with the body", () => {
  it("persists a word count matching the oracle for arbitrary bodies", async () => {
    const oracle = (body: string): number => (body.match(/\S+/gu) ?? []).length;

    await fc.assert(
      fc.asyncProperty(fc.string({ maxLength: 300 }), async (body) => {
        const note = await createFor(ctx.users.alice, aliceNotebook, "prop", body);
        const row = await notesRepo.findNote(ctx.db, {
          userId: ctx.users.alice,
          noteId: note.id,
        });
        expect(row?.wordCount).toBe(oracle(body));
        expect(row?.wordCount).toBe(countWords(body));
      }),
      // Each run is a round trip, so fewer runs than a pure property test.
      { numRuns: 40 },
    );
  });

  it("recomputes the word count on update", async () => {
    const note = await createFor(ctx.users.alice, aliceNotebook, "t", "one two");
    expect(note.wordCount).toBe(2);

    const updated = await notesService.updateNote(ctx.db, {
      userId: ctx.users.alice,
      noteId: note.id,
      title: "t",
      body: "one two three four five",
    });
    expect(updated.wordCount).toBe(5);

    const row = await notesRepo.findNote(ctx.db, {
      userId: ctx.users.alice,
      noteId: note.id,
    });
    expect(row?.wordCount).toBe(5);
  });
});

/** insertNote is called inside a retried transaction, so it must be idempotent. */
describe("idempotency under transaction retry", () => {
  it("inserting the same id twice yields one row", async () => {
    const id = randomUUID();
    const values = {
      id,
      userId: ctx.users.alice,
      notebookId: aliceNotebook,
      title: "once",
      body: "b",
      position: 0,
      wordCount: 1,
    };

    const first = await notesRepo.insertNote(ctx.db, values);
    const second = await notesRepo.insertNote(ctx.db, values);

    expect(second.id).toBe(first.id);
    const total = await notesRepo.countNotes(ctx.db, {
      userId: ctx.users.alice,
      notebookId: aliceNotebook,
      archived: false,
    });
    expect(total).toBe(1);
  });

  it("deleting an already-deleted note reports false rather than throwing", async () => {
    const note = await createFor(ctx.users.alice, aliceNotebook, "gone");
    expect(
      await notesRepo.deleteNote(ctx.db, { userId: ctx.users.alice, noteId: note.id }),
    ).toBe(true);
    expect(
      await notesRepo.deleteNote(ctx.db, { userId: ctx.users.alice, noteId: note.id }),
    ).toBe(false);
  });

  it("ensureNotebook is a no-op the second time", async () => {
    const { ensureDefaultNotebook } = notesService;
    const first = await ensureDefaultNotebook(ctx.db, { userId: ctx.users.alice });
    const second = await ensureDefaultNotebook(ctx.db, { userId: ctx.users.alice });
    expect(second.id).toBe(first.id);
  });
});
