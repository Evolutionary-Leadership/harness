# Documentation index

**Read this file first.** It is the manifest: every doc in this repo, what it
owns, and when to update it. If a fact has a home, it is listed here. If you
are about to write something down and cannot find its home in this table, the
fact does not have one yet: add a row before you add the prose.

## Why the docs look like this

Roughly all readers of this repo's documentation are AI agents starting a
fresh session with no memory of the last one. The docs are those agents'
persistent memory, so they are optimized for machines, not for a linear human
read:

| Principle | What it means in practice |
|---|---|
| Minimal auto-load | `CLAUDE.md` is a router under 300 lines, never a catalog |
| On-demand retrieval | Detail lives in `docs/`, read only when the work needs it |
| One home per fact | A fact lives in exactly one file. Moving it means deleting the old copy |
| Machine-checkable freshness | `node scripts/check-docs.mjs` fails the build on drift |

The rationale for the layout is [ADR 0001](./decisions/0001-adopt-the-ai-native-documentation-standard.md).

## The layers

| Layer | Path | Owns | Budget |
|---|---|---|---|
| Router | `CLAUDE.md` | Conventions, one-way decisions, definition of done, don't-touch list, writing rules, the map below | 300 lines |
| Reference | `docs/architecture/*.md` | Per-subsystem catalogs: routes, tools, tables, jobs, config surfaces | 400 lines each |
| Rationale | `docs/decisions/NNNN-*.md` | Why a tradeoff was made, and what was rejected | no limit, append-only |
| Procedure | `docs/runbooks/*.md` | Operations that have bitten someone, step by step | no limit |
| Vocabulary | `docs/GLOSSARY.md` | Domain terms, with the file or ADR that defines each | no limit |
| Trust | `docs/SECURITY.md` | Trust boundaries, authn/authz, rate limits, known gaps | no limit |
| Verification | `docs/TESTING.md` | Test tiers, naming, where a new test goes, what CI skips | no limit |

## Index

Every `docs/**/*.md` must appear in one of the tables below. `TEMPLATE.md`
files are exempt: they are scaffolding, not content.

### Standing documents

| Doc | Owns | Update it when |
|---|---|---|
| [GLOSSARY.md](./GLOSSARY.md) | Domain vocabulary, each term pointing at its canonical file or ADR | A new domain term enters the code or a term's meaning changes |
| [SECURITY.md](./SECURITY.md) | Trust boundaries, authn/authz mechanics and rationale, rate limits, which tests assert which property, known gaps | Anything touching auth, sessions, secrets, input validation, or limits |
| [TESTING.md](./TESTING.md) | Test tiers, naming conventions, the "where does a new test go" table, what CI does not run | You add a tier, change the runner, or discover CI does not cover something |
| [agents/issue-tracker.md](./agents/issue-tracker.md) | The tracker contract: how agents create, read, and label issues, plus the idea-issue, spec-issue, and ticket conventions with blocking edges and the frontier query | The project moves trackers, or a flow skill needs a new tracker operation |

### Architecture

Per-subsystem reference catalogs. Each declares `sources:` globs in YAML
front-matter naming the files it describes, so a diff touching those files
mechanically implicates the doc. Start from
[TEMPLATE.md](./architecture/TEMPLATE.md).

| Doc | Subsystem | `sources:` |
|---|---|---|
| [railway-environments.md](./architecture/railway-environments.md) | Per-environment Postgres, object-storage bucket, app service, and the preview-URL contract | the two `*railway*.yml` workflows, `railway.json` |

### Decisions (ADRs)

Numbered, append-only. An Accepted ADR is never rewritten: supersede it with
a new one and set the old status to `Superseded by ADR NNNN`. Every ADR
should be back-referenced from the module it governs with a comment
containing its id (`ADR 0001`), so `grep -rn "ADR 0001"` finds the code from
the rationale and the rationale from the code.

Scaffold the next one with `/document adr <title>`.

| ADR | Title | Status | Date |
|---|---|---|---|
| [0001](./decisions/0001-adopt-the-ai-native-documentation-standard.md) | Adopt the AI-native documentation standard | Accepted | 2026-08-07 |

### Runbooks

Operational procedures that have actually bitten someone. Not tutorials.
Start from [TEMPLATE.md](./runbooks/TEMPLATE.md).

| Runbook | When you need it |
|---|---|
| _(none yet)_ | |

### Historical

Retrospectives, handoffs, and post-mortems are **frozen** once written. Do
not edit them to match today's reality: a correction goes in as a bracketed
addition, `[2026-05-02: this path moved to src/api/.]`. A doc that is fully
superseded is **deleted**, not archived. Git history is the archive.

| Doc | Date | Frozen |
|---|---|---|
| _(none yet)_ | | |

## Definition of done for documentation

Mirrored in `CLAUDE.md` so it is always in context. If your change matches a
row, the doc change ships in the same commit.

| You changed | Update |
|---|---|
| A database migration or schema | The data-model architecture doc |
| A route, tool, command, or event | That subsystem's surface table in `docs/architecture/` |
| An environment variable | `.env.example` (with a comment saying what it is for) |
| An invariant others must respect | `CLAUDE.md`, plus an ADR when the tradeoff is not obvious |
| A domain term | `docs/GLOSSARY.md` |
| Anything auth, secrets, limits, or input trust | `docs/SECURITY.md` |
| A test tier, runner, or convention | `docs/TESTING.md` |
| An operational procedure you had to figure out under pressure | A new `docs/runbooks/*.md` |
| Any new doc file | A row in this index |

A cosmetic refactor (rename, extract, reformat) needs **no** doc change.
Documenting it would be restating what the code already says.

## Checking

```
node scripts/check-docs.mjs
```

Errors block the merge. Run `/document check` to have the mechanical updates
applied for you before the checker runs.
