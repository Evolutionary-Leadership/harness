---
name: setup
description: "Configure this fresh template: choose Railway or code-only, optionally materialize the pre-built technical foundation. Runs once and deletes itself."
argument-hint: "[railway=yes|no] [foundation=yes|no]"
allowed-tools: Bash(git *), Bash(ls *), Bash(cp *), Bash(rm *), Bash(chmod *), Bash(date *), Bash(pnpm *), Bash(curl *), Read, Write, Glob, Grep, mcp__github__actions_run_trigger
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

Third guard: a retry after a failed preflight. If the working tree is
clean but `git log origin/dev -5 --format='%s%n%b'` shows a
`chore: harness preflight result` commit whose most recent occurrence
says `preflight: fail`, a previous session already got as far as the
secrets check and stopped there. Open by saying so, quoting the failed
probe lines from that commit body, and asking whether the token has
been fixed. On a retry: skip Q0 (the first-time question was answered
last time), treat railway = yes as settled (a preflight only ever runs
on that path), still run step 3, ask Q2 only if `foundation=` was not
passed, and go straight to the preflight in step 7.

### 2. Arguments

Parse `$ARGUMENTS` for `railway=yes|no` and `foundation=yes|no`. The
harnesscompanion.com wizard passes both so its users answer nothing
twice. Whatever is missing gets asked interactively in the steps below.

Accept `secrets=confirmed` silently if present (older wizard hand-offs
still pass it) but never act on it: the secrets preflight in step 7
runs regardless, because a planted secret says nothing about whether
the token inside it actually has the permissions provisioning needs.

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

### 4. Q0: first time? (always asked, except on a retry)

Skipped only when step 1 detected a retry after a failed preflight.
Otherwise ask via AskUserQuestion, before Q1 and regardless of which arguments
were passed (the wizard's arguments say nothing about whether the user
has seen the guide, and a wizard user is the most likely first-timer):

> Is this your first time setting up this Harness by Evolutionary
> Leadership?

**If yes**: reply with, in this order:

1. A warm, lightly joking welcome at the very top. Something in the
   spirit of "Awesome that you're trying this out. Get ready to amaze
   yourself, by yourself." Write it in your own words; keep it to a
   line or two, and never sarcastic.
2. The first-time guide: tell them to open and read
   www.harnesscompanion.com/firsttime (a web page) before anything
   else. It covers the one-time setup end to end.
3. A short orientation so the page has context: this skill runs once,
   asks one or two questions, pushes a single commit, and deletes
   itself; a Railway project additionally needs the two repository
   secrets the guide explains.
4. End by asking them to prompt exactly this when done reading:
   **"I've read it"**.

Then STOP and wait. "I've read it" (or any clear affirmative like
"done" or "read it") resumes the skill at step 5. Anything else gets
answered as a normal question, after which you re-state the cue and
wait again; never continue past this point on an unrelated message.

**If no**: mention the guide URL in one line for reference
(www.harnesscompanion.com/firsttime) and continue straight to Q1.

### 5. Q1: deploy target

If `railway=` was not passed, ask via AskUserQuestion:

> Will this project deploy to Railway?

- **Yes**: this becomes a `harness-railway` repository.
- **No**: this becomes a `harness-plain` repository.

When the answer is yes (asked or passed), add one short note before
moving on: a Railway account with **more than one workspace** should
set the repository **variable** `RAILWAY_WORKSPACE_ID` now, under
Settings > Secrets and variables > Actions > Variables, so provisioning
lands in the right workspace; a single-workspace account needs nothing.
Do not wait for an answer, it is a heads-up, not a question; the
preflight will flag it again if it actually applies.

### 6. Q2: technical foundation (only when Q1 = yes)

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
the rest of `.claude/setup/` in step 10.

### 7. Secrets preflight (only when Q1 = yes)

Railway provisioning runs in GitHub Actions and needs two repository
secrets, normally planted by the setup wizard before this session:

- `PAT_TOKEN`, which needs **contents, pull requests, workflows,
  secrets and variables, all set to Read and write**: contents and pull
  requests for auto-merge, workflows so the bootstrap can push workflow
  files, secrets so provisioning can store `RAILWAY_PROJECT_ID`, and
  variables so it can manage `RAILWAY_WORKSPACE_ID`. The preflight
  below probes four of the five (contents, workflows, secrets and
  variables; pull requests is first exercised by auto-merge, after
  setup); a token missing any probed permission fails it.
- `RAILWAY_ACCOUNT_TOKEN`

Multi-workspace Railway accounts may also need the repository
**variable** (not secret) `RAILWAY_WORKSPACE_ID`.

Before firing anything, print the timeline once, so the coming quiet
stretches read as normal instead of broken. Adapt it to the answers:

    1. Secrets preflight        ~1 minute
    2. Apply configuration      seconds
       (foundation=yes adds:    install + verify, ~2-3 minutes)
    3. Push and provisioning    ~3-6 minutes
    4. Your live URLs           printed here

Plain (railway = no) setups skip this: they finish in seconds and need
no timeline. Then narrate against it as you go: one line when each
stage starts, so the user always knows which wait they are in.

Do not ask the user whether these are set; verify them. Secret values
are unreadable from outside Actions, so the check is a workflow run:
`harness-preflight.yml` ships live in the template and probes both
tokens for real (Railway's API for `RAILWAY_ACCOUNT_TOKEN`; a
create-then-delete probe of a throwaway secret and variable for
`PAT_TOKEN`), then reports by pushing a result commit to `dev`
(ADR 0009). Tell the user in one line that the preflight is running
and takes about a minute, then fire it:

1. Preferred: dispatch via the GitHub MCP server, tool
   `actions_run_trigger`, method `run_workflow`,
   `workflow_id: harness-preflight.yml`, `ref: dev` (owner/repo from
   `git remote get-url origin`).
2. Fallback, when that tool is unavailable or errors: Write a
   `.harness-preflight` file containing only a timestamp
   (`date -u +%Y-%m-%dT%H:%M:%SZ`), commit it, and
   `git push origin HEAD:dev`. The push path-trigger fires the same
   workflow. Use exactly one of the two paths, never both.

Poll with git, the same pattern as step 13; cap at 20 attempts
(about 3 minutes):

    for i in $(seq 1 20); do
      git fetch -q origin dev
      BODY=$(git log origin/dev -3 --format='%s%n%b' \
        | grep -A8 '^chore: harness preflight result$' || true)
      if [ -n "$BODY" ]; then break; fi
      [ "$i" -lt 20 ] && sleep 10
    done

The body's `preflight:` line is the verdict (that subject line and key
are a parsed contract with `harness-preflight.yml`; the forge's overlay
checker guards the pair):

- **`preflight: pass`**: sync the local branch with what the workflow
  just changed on `dev` (on pass, the result commit deletes the
  preflight workflow file and any sentinel):

      git fetch origin dev && git merge origin/dev --no-edit

  Report any `workspace-hint:` line to the user, then continue to
  step 8.
- **`preflight: fail`**: print the `railway-token:`, `pat-secrets:`,
  `pat-variables:` and any `pat-workflows:` or `workspace-hint:` lines
  verbatim, point at Settings > Secrets and variables > Actions and the
  guide (www.harnesscompanion.com/firsttime), and STOP before any
  mutation. The user fixes the token and reruns `/setup`; the guard in
  step 1 finds a clean tree, and the preflight simply runs again.
- **Timeout**: surface the Actions run URL
  (`https://github.com/<owner>/<repo>/actions/workflows/harness-preflight.yml`)
  and the two known causes: `PAT_TOKEN` lacking Contents: Read and
  write (the workflow cannot push its result), or Actions disabled on
  the repository. STOP before any mutation.

### 8. Apply

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
   to this repository's name (from `git remote get-url origin`), made
   npm-safe: lowercase it, strip any leading `.` or `_` characters, and
   truncate to 214 characters. npm rejects names that violate any of
   the three, and a bad name fails later at an unrelated moment, not
   here. Everything else in the payload stays byte-for-byte as shipped.

4. Verify the materialized app with the same chain CI will run:

       pnpm install --frozen-lockfile && pnpm typecheck && pnpm lint && pnpm check:docs

   This chain needs no database and no Docker. Do NOT run the test
   suite (integration tests need Postgres) and do NOT run `next build`.
   `node_modules/` is created here; the payload's `.gitignore` already
   keeps it out of the commit. If Node 22.11+ or pnpm is unavailable in
   this session, materialize anyway, skip this verification, and say so
   plainly in the handoff. Never imply a check ran when it did not.

For railway = no: copy nothing.

### 9. Record the variant

Rewrite line 1 of `.harness-version` to the chosen variant:

    harness: harness-railway

or

    harness: harness-plain

On the foundation path, also append this line (the CI gate
`feature-branch-checks.yml` reads it; it is the same chain step 8 ran):

    check: pnpm install --frozen-lockfile && pnpm typecheck && pnpm lint && pnpm check:docs

Leave every other line untouched. Line 1 is the variant's identity;
`/harness-upgrade` filters migrations by it.

### 10. Self-delete

    git rm -r -q .claude/setup .claude/skills/setup
    git rm -q --ignore-unmatch .github/workflows/harness-preflight.yml

The second line matters on the railway = no path, where the preflight
never ran: a plain repo must not keep a Railway-probing workflow. On
railway = yes the passing preflight already deleted its own file on
`dev` and the step 7 merge removed it locally, so the line is a no-op.

The quarantine has served its purpose (applied or declined), and this
skill's presence is the "unconfigured" marker, so both go in the same
commit. The skill file disappearing mid-session is fine; its content is
already in context.

### 11. Sentinel (only when railway = yes)

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

### 12. One commit, pushed to dev

Stage everything and commit once, with the real answers in the message:

    git add -A
    git commit -m "chore: configure harness (railway=yes, foundation=no)"
    git push origin HEAD:dev

`dev` is the scaffold's default and only branch at this point. Push to
`dev` explicitly (never to a `claude/` branch; that would trigger the
feature-branch machinery). If the push fails on a network error, retry
up to 4 times with exponential backoff (2s, 4s, 8s, 16s).

Then move the checkout off the `claude/` branch so the session does not
end there:

    git checkout dev && git reset --hard origin/dev

Without this, the session's stop hook sees the configuration commit
sitting unpushed on the `claude/` branch and asks you to push it. Do
NOT comply: the commit is already on `dev`, and pushing the `claude/`
branch fires the feature-branch machinery, which would create a stray
`feature/setup-*` branch and (on railway) provision a preview
environment for a branch containing no feature.

This one push is the whole configuration: it delivers the Railway
workflows (when chosen), fires the provisioning sentinel, records the
variant, and removes the setup machinery.

### 13. Watch provisioning (only when railway = yes)

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
      [ "$i" -lt 24 ] && sleep 15
    done

Parse `production-url:` and `dev-url:` from the body and print them as a
compact two-line block:

    Production: <url>
    Dev:        <url>

Then verify the production URL is actually serving before celebrating.
Provisioning finishing is not the same as the app being up: Railway
still has to build and deploy, which takes a minute or two, and a bare
HTTP 200 can come from a placeholder page rather than the app. Both
shipped apps (the Express starter and the foundation) send the response
header `x-harness: live` for exactly this check, so poll for the header,
not the status code; tolerate the deploy delay; cap at 12 attempts
(about 3 minutes):

    for i in $(seq 1 12); do
      if curl -sfI --max-time 10 "$PROD_URL" | grep -qi '^x-harness: live'; then
        echo "Production is live and serving the app."
        break
      fi
      [ "$i" -lt 12 ] && sleep 15
    done

The apps send a second header, `x-harness-sha` (the deployed commit),
which `/feature`'s deploy verification compares against the feature
branch tip. Setup checks only `x-harness: live` and never the sha: the
bootstrap deploy started before the cleanup commit existed, so a sha
comparison against `dev`'s tip would fail forever here by design.

If the header never appears, do not fail setup: provisioning succeeded
and the deploy may simply still be rolling. Say exactly that, hand over
the URL, and suggest checking it again in a couple of minutes (a
downstream app that later replaces the starter may also drop the
header; that only disables this check, nothing else).

On a visible failure or on timeout, surface the Actions run URL
(`https://github.com/<owner>/<repo>/actions/workflows/harness-railway.yml`,
owner/repo from `git remote get-url origin`) and the three known causes:

1. `RAILWAY_ACCOUNT_TOKEN` scoped to the wrong workspace.
2. Multiple Railway workspaces with no `RAILWAY_WORKSPACE_ID` repository
   variable set; check for a `::warning::` in the Step 1 logs listing
   the workspaces.
3. `PAT_TOKEN` missing Secrets or Variables: Read and write (needed to
   store `RAILWAY_PROJECT_ID` and clean up `RAILWAY_WORKSPACE_ID`);
   rare after a passed preflight, which probes both, but a secret
   rotated between preflight and bootstrap lands here.

Explain the re-fire procedure: after fixing the cause, commit
`.harness-bootstrap` again with a fresh timestamp and push to `dev`;
the sentinel-path trigger fires the workflow again.

### 14. Hand off

The close has a shared core and an audience-specific ending, chosen by
the Q0 answer.

Shared core, for everyone:

- A one-line configuration summary (variant, foundation materialized or
  not, and whether the verify chain ran).
- The production and dev URLs, when railway = yes, and whether the
  liveness check confirmed production serving.
- When foundation = yes: the application is already in place and
  verified in this session (or materialized unverified, if step 8 had
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

**First-timer ending (Q0 = yes)**: end on the payoff, then the path,
in the same warm register the welcome opened with:

1. The see-it-work moment, concrete for their configuration:
   foundation = yes means "open your dev URL and click the demo login;
   that is your app, seeded and running"; railway without foundation
   means "open your production URL; that page is your pipeline working
   end to end"; plain means a one-line tour of what now exists
   (workflows, skills, the docs skeleton).
2. The first feature: start a fresh chat, type `/feature`, and describe
   one small idea in a sentence; the harness drives it from there,
   including the questions. Nothing else to install or configure.
3. One pointer, not a catalog: `/getting-started` lists every skill
   when they want the map.

**Returning-user ending (Q0 = no, or a retry)**: one line: fresh chat,
`/feature`, done. They know the drill; do not tour them.
