# 0001. Adopt the AI-native documentation standard

- **Status:** Accepted
- **Date:** 2026-08-07

## Context

Nearly every reader of this repo's documentation is an AI agent starting a
fresh session with no memory of the previous one. Documentation is that
agent's persistent memory, and `CLAUDE.md` is the only part of it that loads
automatically, on every single session, whether or not the session needs it.

Documentation written for humans fails badly under that constraint. The
failure mode is well documented in projects that let `CLAUDE.md` grow
organically:

- The auto-loaded file becomes an encyclopedia. At around 1,600 lines it is a
  five-figure token tax on every session, most of it irrelevant to the task
  at hand, and roughly two thirds of it restating what the code already says.
- The same fact ends up in several files. Copies drift. An agent that reads
  the wrong copy confidently does the wrong thing.
- Nothing detects the drift, so the repo needs periodic "sync docs to the
  codebase" rescue commits, which are expensive and always late.

## Decision

Documentation is organized in layers, each with an explicit owner and a line
budget, and freshness is machine-checked.

| Layer | Path | Role |
|---|---|---|
| Router | `CLAUDE.md` | Conventions, one-way decisions, definition of done, don't-touch list, and a map of which doc to read for which work. Hard budget: 300 lines. Never a catalog |
| Reference | `docs/architecture/*.md` | Per-subsystem catalogs, 400 lines each, with YAML front-matter `sources:` globs naming the files they describe |
| Rationale | `docs/decisions/NNNN-*.md` | Numbered ADRs. Append-only once accepted |
| Procedure | `docs/runbooks/*.md` | Operations that have bitten someone |
| Manifest | `docs/README.md` | The index: every doc, what it owns, when to update it. Read first, always |

Four rules hold the layers together:

1. **One home per fact.** When a fact moves, the old copy is deleted in the
   same commit.
2. **Code is truth for WHAT, docs for WHY and WHERE.** Restating code is a
   defect, not thoroughness.
3. **Accepted ADRs are append-only.** Supersede, never rewrite. Each ADR is
   back-referenced from the module it governs by a comment containing its id,
   so `grep` reaches the rationale from the code and back.
4. **Freshness is mechanical.** `node scripts/check-docs.mjs` fails on broken
   links, unindexed docs, `sources:` globs that match nothing, dangling ADR
   references, and surface tables whose row count no longer matches the code.
   It belongs in the `check:` line so broken docs block auto-merge exactly
   like a type error.

### Rejected alternatives

| Alternative | Why not |
|---|---|
| One large `CLAUDE.md` | Cost is paid on every session regardless of relevance, and size is what makes duplication and drift invisible |
| Generated API docs only | Restates the code perfectly and captures no rationale, which is the part an agent cannot recover by reading source |
| A docs wiki outside the repo | Cannot be diffed against the code, cannot be checked in CI, and goes stale silently |
| Review discipline without a checker | This is exactly what failed in practice. Drift is found late, by an agent acting on a wrong fact |
| Keeping superseded docs in an `archive/` folder | Two plausible answers to the same question is the failure this standard exists to prevent. Git history is the archive |

## Consequences

- `CLAUDE.md` has a budget. Content that outgrows it moves into
  `docs/architecture/` with `sources:` front-matter rather than being trimmed
  into vagueness.
- Every architecture doc must declare which files it describes. Renaming a
  described file breaks the build until the doc is updated, which is the
  point.
- The definition of done includes documentation: a change that adds a route,
  a migration, an env var, an invariant, a domain term, or a security-
  relevant behavior updates its owning doc in the same commit. Cosmetic
  refactors update nothing.
- New docs cost an index row in `docs/README.md`. That friction is
  deliberate: it forces the question "does this fact already have a home?"

## When to reconsider

Reconsider if auto-loaded context stops being scarce (a model that can hold
the whole repo cheaply and reliably retrieve from it), or if the router
routinely runs at half its budget because every fact is finding a home
elsewhere, in which case the budget is no longer doing work.
