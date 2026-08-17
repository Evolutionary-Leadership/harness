import type { NoteRow } from "@/lib/db/schema/notes";

/**
 * The pure core of the notes domain: normalization, derived fields, sorting, and
 * the view model. No database, no React, no DOM, no I/O.
 *
 * Everything here is unit tested in tests/unit/note-view.test.ts (including
 * fast-check property tests over arbitrary bodies), and the optimistic cache
 * helpers in src/app/notes/mutations.ts reuse these same functions so the client
 * computes derived fields exactly the way the server does.
 */

export const EXCERPT_MAX_LENGTH = 140;
export const TITLE_MAX_LENGTH = 200;
export const BODY_MAX_LENGTH = 100_000;

/** The list scope a note can be filed under. Mirrors the `archived` column. */
export type NoteScope = "active" | "archived";

/**
 * The read model. `excerpt` is COMPUTED ON READ and never stored; `wordCount` is
 * denormalized onto the row and mirrored here.
 */
export type NoteView = {
  id: string;
  notebookId: string;
  title: string;
  body: string;
  archived: boolean;
  position: number;
  wordCount: number;
  /** Derived on read. See toNoteView and the optimistic mirror in mutations.ts. */
  excerpt: string;
  createdAt: string;
  updatedAt: string;
  /**
   * True while this note only exists in the client cache, carrying a temporary
   * optimistic id. Rows with this flag disable their own actions: a server
   * generated id has not arrived yet, so an edit or delete would address a row
   * that does not exist. Never set by the server.
   */
  optimistic?: true;
};

/**
 * Count words in a body. The oracle for the denormalized `word_count` column:
 * `tests/unit/note-view.test.ts` asserts stored === countWords(body) over
 * arbitrary strings, and the integration test asserts it against real rows.
 *
 * Deliberately simple and total: split on any Unicode whitespace run, drop empty
 * segments. An empty or whitespace-only body counts 0.
 */
export function countWords(body: string): number {
  const trimmed = body.trim();
  if (trimmed === "") return 0;
  return trimmed.split(/\s+/u).length;
}

/**
 * A single-line preview of the body, capped at EXCERPT_MAX_LENGTH.
 *
 * Cuts on a word boundary when one is available in the last quarter of the
 * budget, so the ellipsis does not land mid-word. Collapses all whitespace,
 * because a body's newlines would otherwise break the one-line card layout.
 */
export function buildExcerpt(body: string, maxLength: number = EXCERPT_MAX_LENGTH): string {
  const collapsed = body.replace(/\s+/gu, " ").trim();
  if (collapsed.length <= maxLength) return collapsed;

  const hardCut = collapsed.slice(0, maxLength);
  const lastSpace = hardCut.lastIndexOf(" ");
  const softCut = lastSpace > maxLength * 0.75 ? hardCut.slice(0, lastSpace) : hardCut;
  return `${softCut.trimEnd()}…`;
}

/** Normalize user input once, so the server and the optimistic client agree. */
export function normalizeTitle(title: string): string {
  const collapsed = title.replace(/\s+/gu, " ").trim();
  return collapsed === "" ? "Untitled note" : collapsed;
}

/**
 * Everything derived from a note's editable fields, in one place.
 *
 * Both the service (on write) and the optimistic cache patch (on click) call
 * this, which is why an optimistic body edit cannot leave a stale excerpt or
 * word count behind.
 */
export function deriveNoteFields(input: { title: string; body: string }): {
  title: string;
  body: string;
  wordCount: number;
  excerpt: string;
} {
  const title = normalizeTitle(input.title);
  return {
    title,
    body: input.body,
    wordCount: countWords(input.body),
    excerpt: buildExcerpt(input.body),
  };
}

/** Row to view model. The one place `excerpt` is computed on read. */
export function toNoteView(row: NoteRow): NoteView {
  return {
    id: row.id,
    notebookId: row.notebookId,
    title: row.title,
    body: row.body,
    archived: row.archived,
    position: row.position,
    wordCount: row.wordCount,
    excerpt: buildExcerpt(row.body),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** The scope a note currently belongs to. */
export function scopeOf(note: Pick<NoteView, "archived">): NoteScope {
  return note.archived ? "archived" : "active";
}

/**
 * Does this note still belong in a list keyed by (notebookId, scope)?
 *
 * The scoped-list ejection rule depends on this: an upsert that archives a note
 * has to REMOVE it from the "active" list, not leave it sitting there until the
 * refetch. See ejectFromForeignScopes in src/app/notes/mutations.ts.
 */
export function matchesScope(
  note: Pick<NoteView, "archived" | "notebookId">,
  notebookId: string,
  scope: NoteScope,
): boolean {
  return note.notebookId === notebookId && scopeOf(note) === scope;
}

/**
 * Canonical list order: position ascending, then createdAt descending as the
 * tiebreak so two notes sharing a position never swap places between renders,
 * and finally id so the order is total.
 */
export function sortNotes(notes: readonly NoteView[]): NoteView[] {
  return [...notes].sort((a, b) => {
    if (a.position !== b.position) return a.position - b.position;
    if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
    return a.id < b.id ? -1 : 1;
  });
}

/** The gap between positions, so a single insert rarely needs a renumber. */
export const POSITION_STEP = 1000;

/** The position a newly created note takes: the top of its list. */
export function nextPositionForTop(notes: readonly NoteView[]): number {
  if (notes.length === 0) return 0;
  const lowest = Math.min(...notes.map((n) => n.position));
  return lowest - POSITION_STEP;
}

/**
 * Recompute positions after a drag from `fromIndex` to `toIndex`.
 *
 * Returns the FULL new order with evenly spaced positions rather than a single
 * moved row, because a reorder is a whole-list fact: renumbering keeps the gaps
 * uniform and avoids the pathological case where repeated drags into the same
 * slot exhaust the space between two neighbours.
 *
 * Out-of-range indices are clamped, so a stale drag event cannot corrupt order.
 */
export function reorderNotes(
  notes: readonly NoteView[],
  fromIndex: number,
  toIndex: number,
): NoteView[] {
  const ordered = sortNotes(notes);
  if (ordered.length === 0) return ordered;

  const clamp = (i: number): number => Math.min(Math.max(i, 0), ordered.length - 1);
  const from = clamp(fromIndex);
  const to = clamp(toIndex);

  const moved = ordered.slice();
  const [item] = moved.splice(from, 1);
  if (!item) return ordered;
  moved.splice(to, 0, item);

  return moved.map((note, index) => ({ ...note, position: index * POSITION_STEP }));
}

/**
 * Group notes by notebook, preserving canonical order within each group. Pulled
 * out as a pure function precisely so it is testable with no DOM.
 */
export function groupByNotebook(notes: readonly NoteView[]): Map<string, NoteView[]> {
  const groups = new Map<string, NoteView[]>();
  for (const note of sortNotes(notes)) {
    const bucket = groups.get(note.notebookId);
    if (bucket) bucket.push(note);
    else groups.set(note.notebookId, [note]);
  }
  return groups;
}
