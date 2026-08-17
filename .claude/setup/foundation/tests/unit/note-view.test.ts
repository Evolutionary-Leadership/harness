import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  EXCERPT_MAX_LENGTH,
  POSITION_STEP,
  buildExcerpt,
  countWords,
  deriveNoteFields,
  groupByNotebook,
  matchesScope,
  nextPositionForTop,
  normalizeTitle,
  reorderNotes,
  scopeOf,
  sortNotes,
  type NoteView,
} from "@/lib/notes/view";

/**
 * Unit tier: pure logic, no DOM, no database. This is the tier most of this
 * codebase's behaviour should land in, which is why grouping, sorting,
 * normalization, and the derived fields were pulled out as pure functions.
 */

function note(overrides: Partial<NoteView> = {}): NoteView {
  return {
    id: "n1",
    notebookId: "nb1",
    title: "Title",
    body: "body",
    archived: false,
    position: 0,
    wordCount: 1,
    excerpt: "body",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("countWords", () => {
  it("counts nothing in an empty or whitespace-only body", () => {
    expect(countWords("")).toBe(0);
    expect(countWords("   \n\t  ")).toBe(0);
  });

  it("counts words separated by any whitespace run", () => {
    expect(countWords("one")).toBe(1);
    expect(countWords("one two")).toBe(2);
    expect(countWords("  one \n\n two \t three  ")).toBe(3);
  });

  /**
   * The invariant behind the denormalized `notes.word_count` column, checked
   * against a COMPUTE-ON-READ ORACLE that uses a different mechanism (matching
   * non-whitespace runs) than the implementation (splitting on whitespace runs).
   * Two independent derivations agreeing over arbitrary input is the property.
   */
  it("agrees with a compute-on-read oracle for arbitrary bodies", () => {
    const oracle = (body: string): number => (body.match(/\S+/gu) ?? []).length;
    fc.assert(
      fc.property(fc.string(), (body) => {
        expect(countWords(body)).toBe(oracle(body));
      }),
      { numRuns: 1000 },
    );
  });

  it("agrees with the oracle for whitespace-heavy bodies too", () => {
    const oracle = (body: string): number => (body.match(/\S+/gu) ?? []).length;
    // fast-check 4 replaced fc.stringOf with the `unit` option on fc.string.
    const whitespaceish = fc.string({
      // Includes exotic whitespace as explicit escapes: U+00A0 (no-break
      // space) and U+2003 (em space) are matched by \s under the `u` flag, so the
      // implementation and the oracle must agree on them too.
      unit: fc.constantFrom(" ", "\t", "\n", "\r", "\u00a0", "\u2003", "a", "b"),
      maxLength: 60,
    });
    fc.assert(
      fc.property(whitespaceish, (body) => {
        expect(countWords(body)).toBe(oracle(body));
      }),
      { numRuns: 1000 },
    );
  });
});

describe("buildExcerpt", () => {
  it("collapses whitespace to a single line", () => {
    expect(buildExcerpt("one\ntwo\t\tthree")).toBe("one two three");
  });

  it("returns a short body unchanged", () => {
    expect(buildExcerpt("short")).toBe("short");
  });

  it("truncates a long body and marks it", () => {
    const excerpt = buildExcerpt("word ".repeat(200));
    expect(excerpt.endsWith("…")).toBe(true);
    expect(excerpt.length).toBeLessThanOrEqual(EXCERPT_MAX_LENGTH + 1);
  });

  it("never exceeds the budget and never contains a newline, for any body", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 2000 }), (body) => {
        const excerpt = buildExcerpt(body);
        expect(excerpt.length).toBeLessThanOrEqual(EXCERPT_MAX_LENGTH + 1);
        expect(excerpt).not.toContain("\n");
      }),
      { numRuns: 500 },
    );
  });
});

describe("normalizeTitle", () => {
  it("falls back for an empty or whitespace-only title", () => {
    expect(normalizeTitle("")).toBe("Untitled note");
    expect(normalizeTitle("   ")).toBe("Untitled note");
  });

  it("collapses inner whitespace", () => {
    expect(normalizeTitle("  a   b  ")).toBe("a b");
  });

  it("never returns an empty string", () => {
    fc.assert(
      fc.property(fc.string(), (title) => {
        expect(normalizeTitle(title).length).toBeGreaterThan(0);
      }),
    );
  });
});

describe("deriveNoteFields", () => {
  it("derives title, wordCount, and excerpt together", () => {
    const derived = deriveNoteFields({ title: "  My  note ", body: "one two three" });
    expect(derived).toEqual({
      title: "My note",
      body: "one two three",
      wordCount: 3,
      excerpt: "one two three",
    });
  });

  it("is the single derivation the server and the optimistic client share", () => {
    // If this ever diverges from countWords/buildExcerpt, the optimistic mirror
    // in withEditedText would show something the server would not have computed.
    fc.assert(
      fc.property(fc.string({ maxLength: 500 }), (body) => {
        const derived = deriveNoteFields({ title: "t", body });
        expect(derived.wordCount).toBe(countWords(body));
        expect(derived.excerpt).toBe(buildExcerpt(body));
      }),
      { numRuns: 300 },
    );
  });
});

describe("scope", () => {
  it("maps archived onto a scope name", () => {
    expect(scopeOf(note({ archived: false }))).toBe("active");
    expect(scopeOf(note({ archived: true }))).toBe("archived");
  });

  it("matches only its own notebook and scope", () => {
    const active = note({ notebookId: "nb1", archived: false });
    expect(matchesScope(active, "nb1", "active")).toBe(true);
    expect(matchesScope(active, "nb1", "archived")).toBe(false);
    expect(matchesScope(active, "nb2", "active")).toBe(false);
  });
});

describe("sortNotes", () => {
  it("orders by position ascending", () => {
    const sorted = sortNotes([
      note({ id: "b", position: 10 }),
      note({ id: "a", position: 0 }),
      note({ id: "c", position: 5 }),
    ]);
    expect(sorted.map((n) => n.id)).toEqual(["a", "c", "b"]);
  });

  it("is a total order, so equal positions never swap between calls", () => {
    const notes = [
      note({ id: "a", position: 0, createdAt: "2026-01-01T00:00:00.000Z" }),
      note({ id: "b", position: 0, createdAt: "2026-01-01T00:00:00.000Z" }),
      note({ id: "c", position: 0, createdAt: "2026-01-02T00:00:00.000Z" }),
    ];
    const once = sortNotes(notes).map((n) => n.id);
    const twice = sortNotes(sortNotes(notes)).map((n) => n.id);
    const shuffled = sortNotes([...notes].reverse()).map((n) => n.id);
    expect(twice).toEqual(once);
    expect(shuffled).toEqual(once);
  });

  it("does not mutate its input", () => {
    const notes = [note({ id: "b", position: 10 }), note({ id: "a", position: 0 })];
    sortNotes(notes);
    expect(notes.map((n) => n.id)).toEqual(["b", "a"]);
  });
});

describe("nextPositionForTop", () => {
  it("starts at zero for an empty list", () => {
    expect(nextPositionForTop([])).toBe(0);
  });

  it("goes below the current lowest position", () => {
    expect(nextPositionForTop([note({ position: 0 }), note({ position: 500 })])).toBe(-POSITION_STEP);
  });
});

describe("reorderNotes", () => {
  const list = [
    note({ id: "a", position: 0 }),
    note({ id: "b", position: 1000 }),
    note({ id: "c", position: 2000 }),
  ];

  it("moves an item to the target index", () => {
    expect(reorderNotes(list, 0, 2).map((n) => n.id)).toEqual(["b", "c", "a"]);
    expect(reorderNotes(list, 2, 0).map((n) => n.id)).toEqual(["c", "a", "b"]);
  });

  it("renumbers with uniform gaps", () => {
    expect(reorderNotes(list, 0, 2).map((n) => n.position)).toEqual([0, 1000, 2000]);
  });

  it("clamps out-of-range indices instead of corrupting the order", () => {
    expect(reorderNotes(list, -5, 99).map((n) => n.id)).toEqual(["b", "c", "a"]);
  });

  it("returns an empty list unchanged", () => {
    expect(reorderNotes([], 0, 1)).toEqual([]);
  });

  /** Invariants that must hold for any list and any pair of indices. */
  it("preserves the set of ids and produces strictly increasing positions", () => {
    const notesArb = fc
      .uniqueArray(fc.string({ minLength: 1, maxLength: 6 }), { minLength: 1, maxLength: 12 })
      .map((ids) => ids.map((id, index) => note({ id, position: index * POSITION_STEP })));

    fc.assert(
      fc.property(notesArb, fc.nat(20), fc.nat(20), (notes, from, to) => {
        const result = reorderNotes(notes, from, to);

        expect(result).toHaveLength(notes.length);
        expect([...result.map((n) => n.id)].sort()).toEqual([...notes.map((n) => n.id)].sort());

        const positions = result.map((n) => n.position);
        for (let i = 1; i < positions.length; i++) {
          expect(positions[i]!).toBeGreaterThan(positions[i - 1]!);
        }

        // The renumbered result is already in canonical order.
        expect(sortNotes(result).map((n) => n.id)).toEqual(result.map((n) => n.id));
      }),
      { numRuns: 500 },
    );
  });
});

describe("groupByNotebook", () => {
  it("groups and orders within each group", () => {
    const groups = groupByNotebook([
      note({ id: "b", notebookId: "nb1", position: 10 }),
      note({ id: "a", notebookId: "nb1", position: 0 }),
      note({ id: "z", notebookId: "nb2", position: 0 }),
    ]);
    expect([...groups.keys()].sort()).toEqual(["nb1", "nb2"]);
    expect(groups.get("nb1")?.map((n) => n.id)).toEqual(["a", "b"]);
    expect(groups.get("nb2")?.map((n) => n.id)).toEqual(["z"]);
  });

  it("returns an empty map for no notes", () => {
    expect(groupByNotebook([]).size).toBe(0);
  });
});
