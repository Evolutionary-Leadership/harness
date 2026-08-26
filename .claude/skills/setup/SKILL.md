---
name: setup
description: "Configure this fresh template: choose Railway or code-only, optionally materialize the pre-built technical foundation, and optionally let agents work inside it over MCP. Runs once and deletes itself."
argument-hint: "[railway=yes|no] [foundation=yes|no] [mcp=yes|no]"
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
the pre-built technical foundation (a complete, verified Next.js
application) under `.claude/setup/foundation/`, and the opt-in MCP layer
(everything that lets agents call the application's tools) under
`.claude/setup/mcp/`. All three hold final repo-relative paths, so
applying any of them is one copy and declining one is doing nothing.
Nothing in the quarantine can trigger or fail until it is copied out.

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
materialized; `src/app/api/mcp/route.ts` at the repo root means the MCP
payload was applied too), then continue from the first incomplete step
below.

Third guard: a retry after a failed preflight. If the working tree is
clean but `git log origin/dev -5 --format='%s%n%b'` shows a
`chore: harness preflight result` commit whose most recent occurrence
says `preflight: fail`, a previous session already got as far as the
secrets check and stopped there. Open by saying so, quoting the failed
probe lines from that commit body, and asking whether the token has
been fixed. On a retry: skip Q0 (the first-time question was answered
last time), treat railway = yes as settled (a preflight only ever runs
on that path), still run step 3, ask Q2 and Q2b only if `foundation=`
and `mcp=` were not passed, and go straight to the preflight in step 7.

### 2. Arguments

Parse `$ARGUMENTS` for `railway=yes|no`, `foundation=yes|no` and
`mcp=yes|no`. The harnesscompanion.com wizard passes them so its users
answer nothing twice. Whatever is missing gets asked interactively in the
steps below.

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
- `.claude/setup/mcp/src/app/api/mcp/route.ts`

Report anything missing as an upstream sync bug and stop. Never recreate
missing files by hand; they come from the template sync or not at all.

### 3b. Branches

A harness repository runs on three branches: `main` and `dev` carry code,
and `coordination` is an orphan branch holding only what exists nowhere
else yet (forge decision records 0014 and 0015). A scaffold arrives with
`dev` as its default and only branch, so the other two have to be made.

They cannot be made from here. An orphan branch needs a commit with no
parents, which the contents API cannot produce, and this session cannot
push outside its own `claude/` branch. So fire the workflow, the same two
paths as the preflight in step 7:

1. Preferred: dispatch via the GitHub MCP server, tool
   `actions_run_trigger`, method `run_workflow`,
   `workflow_id: harness-bootstrap.yml`, `ref: dev` (owner/repo from
   `git remote get-url origin`).
2. Fallback, when that tool is unavailable or errors: write a
   `.harness-bootstrap` file containing only a timestamp
   (`date -u +%Y-%m-%dT%H:%M:%SZ`), commit it, and
   `git push origin HEAD:dev`. The push path-trigger fires the same
   workflow, which removes the sentinel again. Use exactly one of the two
   paths, never both.

Then wait for the branches, capped at 12 attempts (about a minute):

    for i in $(seq 1 12); do
      if git ls-remote --exit-code --heads origin coordination >/dev/null 2>&1 \
        && git ls-remote --exit-code --heads origin main >/dev/null 2>&1; then
        echo "branches ready"; break
      fi
      sleep 5
    done

The workflow is idempotent, so a repository that already has all three
passes through untouched and this returns at once.

If the branches never appear, say so in one line and continue anyway.
Setup does not depend on them; the first ADR and the first release do.

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
   asks a handful of short questions (how many depends on the answers,
   at most five), pushes a single commit, and deletes itself; a Railway
   project additionally needs the two repository secrets the guide
   explains.
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

Nothing else is needed here. A multi-workspace Railway account is
handled by the question in step 7b, once the preflight has read the
account's actual workspaces; never send the user to a settings screen
to pick one by hand.

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

### 6b. Q2b: agents calling the app (only when Q2 = yes)

If Q2 was yes and `mcp=` was not passed, ask via AskUserQuestion:

> Should AI agents be able to work inside this app, using its features
> on a user's behalf?

Phrase it in those terms, not as "do you want MCP". The person answering
is deciding whether agents get to act in their product; the protocol is
how, not what. Mention the acronym once, in the option text, so someone
who already knows the term recognises it.

- **Yes**: the app ships an MCP endpoint at `/api/mcp`, authorized with
  the same accounts the UI uses. Every agent connects as one signed-in
  user and reaches only that user's data. It arrives working, with a
  consent screen, a first tool, tests, and a `/mcp-tool` skill for
  adding the next one.
- **No**: no endpoint, no extra dependencies, no OAuth tables.

**Say plainly that no is final**, in the question itself: this skill
deletes its own payloads when it finishes, so a later change of mind
means wiring MCP by hand from the docs. That is the whole reason the
question is asked here rather than left for later.

Never ask Q2b when Q1 or Q2 was no. The MCP payload overlays the
foundation, so without the foundation there is nothing for it to attach
to, and its quarantine is deleted in step 10 like the rest.

### 7. Secrets preflight (only when Q1 = yes)

Railway provisioning runs in GitHub Actions and needs two repository
secrets, normally planted by the setup wizard before this session:

- `PAT_TOKEN`, which needs **contents, pull requests, workflows and
  secrets, all set to Read and write**: contents and pull requests for
  auto-merge, workflows so the bootstrap can push workflow files, and
  secrets so provisioning can store `RAILWAY_PROJECT_ID`. The preflight
  below probes three of the four (contents, workflows and secrets;
  pull requests is first exercised by auto-merge, after setup); a token
  missing any probed permission fails it. Variables is deliberately not
  required: nothing in the harness reads or writes a repository
  variable.
- `RAILWAY_ACCOUNT_TOKEN`

Nothing else needs planting. Multi-workspace accounts are handled by
the question in step 7b, not by a variable set ahead of time.

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
create-then-delete probe of a throwaway secret for `PAT_TOKEN`), then
reports by pushing a result commit to `dev` (ADR 0009). The same
Railway call collects every workspace the account can reach, which is
what step 7b then offers as a choice. Tell the user in one line that
the preflight is running and takes about a minute, then fire it:

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
      BODY=$(git log origin/dev -1 --format='%b' \
        --grep='^chore: harness preflight result$' || true)
      if [ -n "$BODY" ]; then break; fi
      [ "$i" -lt 20 ] && sleep 10
    done

`--grep` with `-1` selects the newest matching commit and `%b` prints
only its body, so `$BODY` is exactly one result and nothing else. Do not
replace this with a `git log -N | grep -A<n>` window: the body now
carries one `workspace:` line per Railway workspace, so a window wide
enough to hold them all also reaches into neighbouring commits, and a
rerun (which leaves two result commits on `dev`) would mix a stale
verdict and stale workspaces into the current one.

The body's `preflight:` line is the verdict (that subject line and key
are a parsed contract with `harness-preflight.yml`; the forge's overlay
checker guards the pair):

- **`preflight: pass`**: sync the local branch with what the workflow
  just changed on `dev` (on pass, the result commit deletes the
  preflight workflow file and any sentinel):

      git fetch origin dev && git merge origin/dev --no-edit

  Then pull the workspace list out of the body:

      WORKSPACES=$(echo "$BODY" | grep '^workspace: ' || true)

  Each line is the key, the workspace id, and the workspace name, which
  may itself contain spaces. Split on the first space after the id:

      workspace: 0f3b1c9a-1234-5678-9abc-def012345678 Acme Production
                 |_____________ id _____________| |____ name ____|

  Keep that list; step 7b uses it. Report it to the user by name (one
  short line, not a table), then continue to step 7b.
- **`preflight: fail`**: print the `railway-token:`, `pat-secrets:` and
  any `pat-workflows:` lines verbatim, point at Settings > Secrets and
  variables > Actions and the guide
  (www.harnesscompanion.com/firsttime), and STOP before any mutation.
  The user fixes the token and reruns `/setup`; the guard in step 1
  finds a clean tree, and the preflight simply runs again. Never ask
  the workspace question on this path.
- **Timeout**: surface the Actions run URL
  (`https://github.com/<owner>/<repo>/actions/workflows/harness-preflight.yml`)
  and the two known causes: `PAT_TOKEN` lacking Contents: Read and
  write (the workflow cannot push its result), or Actions disabled on
  the repository. STOP before any mutation.

### 7b. Q3: which Railway workspace (only when there is a choice)

Count the `workspace:` lines collected in step 7.

**Exactly one**: ask nothing. Say in one line which workspace the
project will land in, and go to step 8. This is the common case and it
must stay silent; a token scoped to a single workspace lands here too.

**More than one**: ask via AskUserQuestion, one option per workspace:

> Which Railway workspace should this project be created in?

Label each option with the workspace **name** and put the id in the
option's description, so the choice reads in human terms while staying
unambiguous between two similarly named workspaces. Keep the ids
verbatim; they are what provisioning uses.

Three rules on this question:

- **Pre-select nothing.** Do not highlight a default, do not order the
  list to imply one, and do not guess from the repository name or any
  other similarity. A wrong guess the user clicks through provisions a
  real project into the wrong workspace, which is the entire failure
  this question exists to prevent.
- **Wait for the answer.** Never infer it, never proceed on silence.
- **Record the chosen id.** Step 11 writes it to the sentinel; it is
  the only way the choice reaches provisioning.

This question is never reached on a failing preflight, because step 7
stops there.

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

3. For mcp = yes only, overlay the MCP payload:

       cp -R .claude/setup/mcp/. .

   Order matters: this runs AFTER the foundation copy, because it
   deliberately overrides several of the foundation's files whole
   (`package.json` and `pnpm-lock.yaml` with the MCP dependency set,
   `src/lib/auth.ts` with the OAuth plugins, the Drizzle journal with a
   second migration, and the docs that describe them). Copying it first
   would let the foundation overwrite all of it. It also adds the
   `/mcp-tool` skill at `.claude/skills/`, which `list-skills.sh` picks
   up with no further wiring. ADR 0011.

   For mcp = no, copy nothing. The payload is deleted with the rest of
   the quarantine in step 10 and is not recoverable afterwards.

4. Exactly ONE substitution: set the `"name"` field in `package.json`
   to this repository's name (from `git remote get-url origin`), made
   npm-safe: lowercase it, strip any leading `.` or `_` characters, and
   truncate to 214 characters. npm rejects names that violate any of
   the three, and a bad name fails later at an unrelated moment, not
   here. Apply it to whichever `package.json` is now on disk, which on
   the mcp = yes path is the MCP payload's copy. Everything else in
   both payloads stays byte-for-byte as shipped.

5. Verify the materialized app with the same chain CI will run:

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

Then Write `.harness-bootstrap`, the timestamp followed by the Q2
answer:

    2026-04-20T17:00:00Z
    foundation: yes

Record `foundation: no` just as explicitly when Q2 was no. The workflow
matches the whole line, so a declined foundation and a half-written
sentinel are different states, and only an exact `foundation: yes`
provisions application variables.

**When step 7b asked the workspace question**, add the chosen id as a
third line:

    2026-04-20T17:00:00Z
    foundation: yes
    workspace: 0f3b1c9a-1234-5678-9abc-def012345678

Write that line ONLY when there was a choice to make. A
single-workspace account produces no third line, and the bootstrap
resolves that case by itself.

**Lines 2 and 3 are parsed contracts**, in the same sense as the
cleanup commit body (ADR 0004). `harness-railway.yml` matches both
literals, and `scripts/check-template-overlay.mjs` in the forge fails
the merge gate when this skill and that workflow stop naming the same
strings. ADR 0007 records why the foundation answer travels here rather
than in the commit message; the workspace id travels the same way for a
sharper reason, that this session cannot write a GitHub repository
variable at all (no MCP tool exists for them and `gh` is absent here),
so a push is the only channel it has to reach a workflow. Line 1 stays
the timestamp and keeps its existing job.

`harness-railway.yml` triggers on a `dev` push touching
`.harness-bootstrap`. Keep the sentinel in the SAME push as the workflow
file: GitHub evaluates push-event workflows from the pushed tip, so a
workflow added and triggered in one push does fire. (If that ever proves
wrong in a real scaffold, the fallback is two pushes: the configuration
commit first, then a second commit adding only the sentinel.)

### 12. One commit, pushed to dev

Stage everything and commit once, with the real answers in the message:

    git add -A
    git commit -m "chore: configure harness (railway=yes, foundation=yes, mcp=yes)"
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
2. Several Railway workspaces and no `workspace:` line on the sentinel;
   Step 1 fails with the available workspaces listed. This means the
   sentinel was written without the answer from step 7b, or the run was
   dispatched by hand rather than by the sentinel push.
3. `PAT_TOKEN` missing Secrets: Read and write (needed to store
   `RAILWAY_PROJECT_ID`); rare after a passed preflight, which probes
   it, but a secret rotated between preflight and bootstrap lands here.

Explain the re-fire procedure: after fixing the cause, commit
`.harness-bootstrap` again with a fresh timestamp and push to `dev`;
the sentinel-path trigger fires the workflow again. Keep the
`workspace:` line when rewriting it on a multi-workspace account, or
Step 1 refuses again.

### 14. Hand off

The close has a shared core and an audience-specific ending, chosen by
the Q0 answer.

Shared core, for everyone:

- A one-line configuration summary (variant, foundation materialized or
  not, and whether the verify chain ran).
- The production and dev URLs, when railway = yes, and whether the
  liveness check confirmed production serving.
- When mcp = yes: the MCP endpoint is live at `<production-url>/api/mcp`
  and at the dev URL too. Print it. Say in one line that a client
  authorizes with the same accounts the app uses, so the first
  connection walks a normal sign in and a consent screen, and that the
  client must speak MCP revision **2026-07-28**: an older client is
  refused with a version error rather than a broken session, which is a
  version mismatch and not a fault in the app. Point at
  `docs/architecture/mcp-server.md` for connecting a client and at
  `/mcp-tool` for adding the next tool.
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
   that is your app, seeded and running", and with mcp = yes add that
   the same app is already reachable by an agent at `/api/mcp`;
   railway without foundation
   means "open your production URL; that page is your pipeline working
   end to end"; plain means a one-line tour of what now exists
   (workflows, skills, the docs skeleton).
2. The first feature: start a fresh chat, type `/feature`, and describe
   one small idea in a sentence; the harness drives it from there,
   including the questions. Nothing else to install or configure.
3. The send-off, and it is the last thing on the screen. They have
   just watched a project go from nothing to live; close on that, not
   on another instruction. Set it off from the paragraph above with a
   horizontal rule, keep it to a line or two, and lean into emoji
   (three or four, placed deliberately, not sprinkled). Something in
   the spirit of "Now go build something great" said in your own
   words: celebratory, a little bold, never smug and never a slogan
   you would be embarrassed to read twice. Write it fresh each time;
   do not reuse a fixed sentence. Nothing follows it, no pointers, no
   next steps, no offers to help. The catalog is one `/getting-started`
   away whenever they want it, and they will find it.

Never use em dashes anywhere in the handoff; commas, colons and
parentheses do the same work.

**Returning-user ending (Q0 = no, or a retry)**: one line: fresh chat,
`/feature`, done. They know the drill; do not tour them.
