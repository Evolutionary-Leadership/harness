---
name: setup
description: "Configure this fresh template: choose Railway or code-only, optionally materialize the pre-built technical foundation. Runs once and deletes itself."
argument-hint: "[railway=yes|no] [foundation=yes|no] [secrets=confirmed]"
allowed-tools: Bash(git *), Bash(ls *), Bash(cp *), Bash(rm *), Bash(chmod *), Bash(date *), Bash(pnpm *), Read, Write, Glob, Grep
---

# Configure this template

One-shot configurator for a repository freshly created from the
`evolutionary-leadership/harness` template. It decides between the two
harness variants, applies the choice, pushes exactly one commit to `dev`,
and deletes itself. While this skill exists, the repository is
unconfigured; its self-deletion is the state transition, so there are no
flag files to check or clean up.

The variants:

| Variant | What it means |
|---|---|
| `harness-railway` | Web app on Railway: one-time provisioning of production and dev (app service, Postgres, object-storage bucket), plus an isolated preview environment per feature branch |
| `harness-plain` | Code-only: the full branch-and-release flow, no deploy target |

The Railway machinery ships quarantined under `.claude/setup/railway/`,
and the pre-built technical foundation (a complete, verified Next.js
application) ships quarantined under `.claude/setup/foundation/`. Both
hold final repo-relative paths, so applying either is one copy and
declining it is doing nothing. Nothing in the quarantine can trigger or
fail until it is copied out.

## Steps

### 1. Guard

If `.claude/setup/` does not exist, this repository is already
configured. Say so and stop; there is nothing to do.

If it exists but `git status` shows a half-applied previous run (for
example Railway workflow files already at `.github/workflows/`, a
rewritten `.harness-version`, or an unpushed configuration commit),
a previous `/setup` was interrupted. Do not start over and do not
re-ask questions the working tree already answers: infer the answers
from the applied state (Railway files at the root mean railway=yes;
`next.config.ts` at the repo root means the foundation was already
materialized), then continue from the first incomplete step below.

### 2. Arguments

Parse `$ARGUMENTS` for `railway=yes|no`, `foundation=yes|no`, and
`secrets=confirmed`. The harnesscompanion.com wizard passes all three so
its users answer nothing twice. Whatever is missing gets asked
interactively in the steps below.

### 3. Verify the harness landed

Check with local file operations (ls; never the GitHub API) that the
template sync delivered the tree. Key base files:

- `.github/workflows/claude-to-feature-branch.yml`
- `.claude/settings.json`
- `.claude/skills/mergedev/SKILL.md`
- `.harness-version`

And the quarantine:

- `.claude/setup/railway/.github/workflows/harness-railway.yml`
- `.claude/setup/foundation/package.json`

Report anything missing as an upstream sync bug and stop. Never recreate
missing files by hand; they come from the template sync or not at all.

### 4. Q1: deploy target

If `railway=` was not passed, ask via AskUserQuestion:

> Will this project deploy to Railway?

- **Yes**: this becomes a `harness-railway` repository.
- **No**: this becomes a `harness-plain` repository.

### 5. Q2: technical foundation (only when Q1 = yes)

If Q1 was yes and `foundation=` was not passed, ask via AskUserQuestion:

> Start from the standard technical foundation (Next.js 16, Drizzle,
> Better Auth, TanStack Query, optimistic UI)?

- **Yes**: the complete, pre-built application lands NOW, in this
  session. It is copied out of the quarantine as finished, verified
  files; there is no follow-up skill, no second session, and no code
  generation. It ships with a working notes app as an illustrative
  reference domain, replaced later through the normal `/feature` flow.
- **No**: the minimal Express starter stays in place until the first
  feature replaces it.

When Q1 = no, never ask Q2; the foundation quarantine is deleted with
the rest of `.claude/setup/` in step 9.

### 6. Secrets gate (only when Q1 = yes and secrets=confirmed was not passed)

Railway provisioning runs in GitHub Actions and needs two repository
secrets, normally planted by the setup wizard before this session:

- `PAT_TOKEN` (repo + workflow scopes; used for auto-merge and for
  storing `RAILWAY_PROJECT_ID`, so it needs Secrets: Read and write)
- `RAILWAY_ACCOUNT_TOKEN`

Multi-workspace Railway accounts may also need the repository
**variable** (not secret) `RAILWAY_WORKSPACE_ID`.

Ask the user whether the two secrets are set under
Settings > Secrets and variables > Actions. If they are not, print that
location, explain the two secrets (and the optional variable), and STOP
before any mutation. The user sets them and reruns `/setup`; the guard
in step 1 finds a clean tree and starts fresh.

### 7. Apply

For railway = yes:

    cp -R .claude/setup/railway/. .
    chmod +x .claude/scripts/*.sh .claude/hooks/*.sh

The quarantine holds final repo-relative paths, so that single copy IS
the activation: Railway workflows land in `.github/workflows/`, the
Railway hooks, scripts, and skill overrides land in `.claude/`, and the
starter app files land at the root. The chmod restores executable bits
in the working tree; git tracks them from the quarantine already.

For foundation = yes (only possible when railway = yes), AFTER the
railway copy, in this order:

1. Materialize the payload:

       cp -R .claude/setup/foundation/. .

   The payload deliberately overwrites the overlay's `package.json`,
   `.gitignore`, `.env.example`, `railway.json`, and `docs/README.md`;
   that is the design, not a conflict.

2. Remove the two starter artifacts the payload replaces:

       rm server.js claude-md-snippet.md

   The payload ships a full `CLAUDE.md`, so the snippet has no job.
   The code-only and railway-without-foundation paths keep both files.

3. Exactly ONE substitution: set the `"name"` field in `package.json`
   to this repository's name (from `git remote get-url origin`,
   lowercased; npm names must be lowercase). Everything else in the
   payload stays byte-for-byte as shipped.

4. Verify the materialized app with the same chain CI will run:

       pnpm install --frozen-lockfile && pnpm typecheck && pnpm lint && pnpm check:docs

   This chain needs no database and no Docker. Do NOT run the test
   suite (integration tests need Postgres) and do NOT run `next build`.
   `node_modules/` is created here; the payload's `.gitignore` already
   keeps it out of the commit. If Node 22.11+ or pnpm is unavailable in
   this session, materialize anyway, skip this verification, and say so
   plainly in the handoff. Never imply a check ran when it did not.

For railway = no: copy nothing.

### 8. Record the variant

Rewrite line 1 of `.harness-version` to the chosen variant:

    harness: harness-railway

or

    harness: harness-plain

On the foundation path, also append this line (the CI gate
`feature-branch-checks.yml` reads it; it is the same chain step 7 ran):

    check: pnpm install --frozen-lockfile && pnpm typecheck && pnpm lint && pnpm check:docs

Leave every other line untouched. Line 1 is the variant's identity;
`/harness-upgrade` filters migrations by it.

### 9. Self-delete

    git rm -r -q .claude/setup .claude/skills/setup

The quarantine has served its purpose (applied or declined), and this
skill's presence is the "unconfigured" marker, so both go in the same
commit. The skill file disappearing mid-session is fine; its content is
already in context.

### 10. Sentinel (only when railway = yes)

Get a timestamp:

    date -u +%Y-%m-%dT%H:%M:%SZ

Then Write `.harness-bootstrap` with exactly two lines, the timestamp
followed by the Q2 answer:

    2026-04-20T17:00:00Z
    foundation: yes

Record `foundation: no` just as explicitly when Q2 was no. The workflow
matches the whole line, so a declined foundation and a half-written
sentinel are different states, and only an exact `foundation: yes`
provisions application variables.

**That second line is a parsed contract**, in the same sense as the
cleanup commit body (ADR 0004). `harness-railway.yml` matches the
literal, and `scripts/check-template-overlay.mjs` in the forge fails the
merge gate when this skill and that workflow stop naming the same string.
ADR 0007 records why the answer travels here rather than in the commit
message. Line 1 stays the timestamp and keeps its existing job.

`harness-railway.yml` triggers on a `dev` push touching
`.harness-bootstrap`. Keep the sentinel in the SAME push as the workflow
file: GitHub evaluates push-event workflows from the pushed tip, so a
workflow added and triggered in one push does fire. (If that ever proves
wrong in a real scaffold, the fallback is two pushes: the configuration
commit first, then a second commit adding only the sentinel.)

### 11. One commit, pushed to dev

Stage everything and commit once, with the real answers in the message:

    git add -A
    git commit -m "chore: configure harness (railway=yes, foundation=no)"
    git push origin HEAD:dev

`dev` is the scaffold's default and only branch at this point. Push to
`dev` explicitly (never to a `claude/` branch; that would trigger the
feature-branch machinery). If the push fails on a network error, retry
up to 4 times with exponential backoff (2s, 4s, 8s, 16s).

This one push is the whole configuration: it delivers the Railway
workflows (when chosen), fires the provisioning sentinel, records the
variant, and removes the setup machinery.

### 12. Watch provisioning (only when railway = yes)

The sentinel push fired `harness-railway.yml`, which provisions
production and dev, then self-deletes and pushes a cleanup commit titled
`chore: remove harness bootstrap files (one-time use)` whose body
contains two stable lines:

    production-url: https://...
    dev-url: https://...

Poll with git, not gh: every 15 seconds, `git fetch origin dev` and look
for that commit; cap at 24 attempts (about 6 minutes). One capped loop:

    for i in $(seq 1 24); do
      git fetch -q origin dev
      BODY=$(git log origin/dev -5 --format='%s%n%b' \
        | grep -A5 '^chore: remove harness bootstrap files (one-time use)$' || true)
      if echo "$BODY" | grep -q '^production-url:'; then break; fi
      sleep 15
    done

Parse `production-url:` and `dev-url:` from the body and print them as a
compact two-line block:

    Production: <url>
    Dev:        <url>

On a visible failure or on timeout, surface the Actions run URL
(`https://github.com/<owner>/<repo>/actions/workflows/harness-railway.yml`,
owner/repo from `git remote get-url origin`) and the three known causes:

1. `RAILWAY_ACCOUNT_TOKEN` scoped to the wrong workspace.
2. Multiple Railway workspaces with no `RAILWAY_WORKSPACE_ID` repository
   variable set; check for a `::warning::` in the Step 1 logs listing
   the workspaces.
3. `PAT_TOKEN` missing Secrets: Read and write (needed to store
   `RAILWAY_PROJECT_ID`).

Explain the re-fire procedure: after fixing the cause, commit
`.harness-bootstrap` again with a fresh timestamp and push to `dev`;
the sentinel-path trigger fires the workflow again.

### 13. Hand off

Close with:

- A one-line configuration summary (variant, foundation materialized or
  not, and whether the verify chain ran).
- The production and dev URLs, when railway = yes.
- When foundation = yes: the application is already in place and
  verified in this session (or materialized unverified, if step 7 had
  to skip the chain; say which, honestly). Provisioning migrates the
  database, runs the idempotent seed, and serves the app at the dev URL
  with the demo login, with zero manually set variables: the bootstrap
  set `BETTER_AUTH_SECRET` (generated separately per environment),
  `SEED_DATA` (`false` on production, `true` on dev), and
  `SHOW_DEMO_LOGIN` (`true` on dev, never on production). Name the
  variables, never their values; the secrets are masked in the workflow
  and this session never sees them. Mention that dev and every feature
  preview therefore offer a publicly reachable one-click demo login, so
  dev must hold no real data.
- Next steps: start a fresh chat and describe the first feature. There
  is no follow-up setup step; the foundation, when chosen, is already
  built.
