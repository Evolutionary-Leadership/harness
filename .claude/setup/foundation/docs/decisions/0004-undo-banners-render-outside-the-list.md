# 4. Undo banners render outside the list they archive from

- **Status**: Accepted
- **Date**: 2026-08-17

## Context

Two rules of the optimistic architecture collide, and the collision is invisible
until you run it in a browser.

1. **Scoped lists eject entities that no longer match their scope.** Archiving a
   note flips `archived`, so the note stops matching the `active` list and
   `patchNote` removes it from that list immediately, rather than leaving it there
   until the refetch.
2. **Undo beats confirm for reversible actions.** Archiving flips instantly and
   offers a roughly five second window in which a second click undoes it locally.
   Only the expiring timer commits to the server.

The obvious implementation puts the countdown and the Undo button inside the row
being archived, replacing the card's contents. That cannot work: rule 1 unmounts
that row on the very click that is supposed to offer the undo. The affordance
disappears the instant it becomes relevant.

The second-order problem is subtler. Once ejected, the note is not in any cached
list, so there is nothing left for `patchNote` to patch. An undo implemented as
"patch `archived` back to false" finds no entry and silently does nothing, and if
the archived list is not currently cached (the user is on the active tab, so it
usually is not) the note is absent from the cache entirely.

Both were found by the e2e journey, not by the unit tests, which is a fair
illustration of what the e2e tier is for: the unit tests for `patchNote` and for
the undo hook were each correct in isolation.

## Decision

Two things, together:

- **The undo affordance renders at the view level**, not inside the row.
  `useArchiveWithUndo` exposes `pending: PendingUndo[]` and `NotesView` renders one
  banner per entry above the list. This also matches what users expect from a
  "moved to archive, undo?" interaction, which is a page-level notice rather than
  something attached to a row that has visibly gone.
- **The pending entry holds the whole `NoteView`, not just its id.** `cancel()`
  re-inserts the captured note with `upsertNote`, because there is nothing left in
  the cache to patch. This is the snapshot rollback strategy applied to a local
  reversal rather than to a failed request.

## Consequences

- Ejection stays immediate and unconditional, so rule 1 needs no exception. The
  archived note really is gone from the list on the same frame as the click.
- Undo works with no network round trip in either direction, including when the
  archived list has never been fetched.
- The banner outliving its row means the undo window survives a scope switch or a
  notebook change, since the banner is not tied to the list being displayed.
- Multiple concurrent undos work, each with its own timer and banner. One shared
  interval drives every countdown label.
- The captured note can go stale: if something else edits the note during the
  five second window, undo re-inserts the older copy. The `onSettled` prefix
  invalidation corrects it on the next refetch, and for a five second window on a
  single user's own note this is an acceptable trade against holding a live
  subscription open per pending undo.

## Alternatives considered

- **Delay the ejection until the timer commits.** Preserves the naive in-row
  undo, and breaks rule 1: the note would sit in a list it no longer belongs to
  for five seconds, which is exactly the staleness the ejection rule exists to
  prevent. It also makes the list lie about what is archived.
- **Render the undo through the toast system.** Tempting, since the toast provider
  already exists. Rejected because toasts are for soft warnings the server sends
  back, they auto-dismiss on their own schedule, and an undo needs a deadline
  synchronised with a specific timer. Overloading toasts would couple two
  unrelated lifetimes.
- **Keep only the id and refetch the note on undo.** Puts the network back on the
  path the undo design exists to keep off it.
