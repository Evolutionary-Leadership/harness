# Notes: product vision and behaviour

This file owns what the product IS and what it DOES. It wins over `CLAUDE.md` for
any product question; `CLAUDE.md` wins for conventions and layer rules.

## What it is

A notes and knowledge base app. One person's notes, organised into notebooks,
searchable and reorderable, that never makes you wait.

> **The notes domain is an illustrative reference domain.** The harness ships
> this app as a worked example of the stack and its conventions (optimistic UI,
> layered server, tested seams). Replace it with your real domain through the
> normal `/feature` flow; the conventions and infrastructure are the part that
> stays.

## The one non-negotiable property

**It feels instant.** Every action lands on the same frame as the click. Nothing in
the interface waits for a server: not creating a note, not editing one, not
archiving, not reordering, not deleting. The server reconciles afterwards.

This is a product decision before it is a technical one. A notes app competes with a
paper notebook, and a paper notebook has no latency. Any spinner on the writing path
is a defect, not a loading state.

Consequences the product accepts in exchange:

- A rejected write is reported as a correction after the fact (a toast, a row
  returning) rather than prevented up front.
- Warnings never block. A duplicate note title is kept, and mentioned.
- Destructive actions are guarded by a dialog; reversible ones are guarded by undo,
  because undo costs the user nothing when they were right.

## Domain

A **note** belongs to exactly one **notebook**, which belongs to exactly one
**user**. A note is either active or archived; archiving is reversible and undoable,
deleting is neither. Notes are manually ordered within their notebook by dragging.
Terms are defined in [GLOSSARY.md](./GLOSSARY.md).

## Behaviour built so far

| Area | Behaviour |
|---|---|
| Accounts | Email and password signup and sign in, argon2id, database sessions. Signup closable per environment |
| Demo login | One click sign in as a seeded fictional user, on non-production environments only |
| Notebooks | Every user gets an `Inbox` on first sign in. Multiple notebooks are supported by the data model and switchable in the UI when more than one exists |
| Notes | Create, edit title and body, archive with undo, unarchive, delete with confirmation, drag to reorder |
| Views | Active and archived lists per notebook. The active list polls every 20 seconds |
| Derived | A one-line excerpt and a word count, shown on every card |

## Not built yet

Named so nobody has to guess whether an absence is deliberate.

| Not built | Note |
|---|---|
| Search | The obvious next feature. Postgres full text search over `title` and `body`; `word_count` is already denormalized with this in mind |
| Notebook management UI | The data model supports many notebooks and the switcher renders when more than one exists, but there is no create, rename, or delete |
| Sharing and collaboration | Single user per note throughout. Every query is scoped to one `user_id`, and sharing would be a real schema change, not a filter change |
| Tags | Deliberately deferred in favour of notebooks. Adding them later is additive |
| Rich text | Bodies are plain text. The excerpt logic assumes it |
| File attachments | No uploads, which is why no `AWS_*` variables are declared |
| Email verification and password reset | The `verification` table exists (Better Auth core) but verification is off and no mail is sent |
| Trash and retention | Delete is immediate and permanent, which is why it is the one action behind a confirm dialog |
| Offline support | The optimistic cache would suit it, but there is no service worker and no write queue |
| Pagination | Lists are unbounded. `countOverAll` exists for when they are not |

## Deliberate non-goals

- **A collaborative editor.** Concurrent editing of one note by several people is a
  different product with a different data model (CRDTs, not last-write-wins).
- **A mobile app.** The web app is responsive; a native shell is out of scope.
