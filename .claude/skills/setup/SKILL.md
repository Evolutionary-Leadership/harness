---
name: setup
description: "Configure this fresh template: choose Railway or code-only, optionally materialize the pre-built technical foundation, and optionally let agents work inside it over MCP. Runs once and deletes itself."
argument-hint: "[railway=yes|no] [foundation=yes|no] [mcp=yes|no] [prefix=<PREFIX>]"
allowed-tools: Bash(bash .claude/scripts/setup.sh *), Bash(bash .claude/scripts/registry.sh *), Bash(git *), Bash(ls *), Bash(pnpm *), Bash(curl *), Bash(date *), Read, Write, Glob, Grep, mcp__github__actions_run_trigger
---

# Configure this template

One-shot configurator for a repository freshly created from the
`evolutionary-leadership/harness` template. It decides between the two
harness variants, applies the choice, pushes exactly one commit to `preprod`,
and deletes itself. While this skill exists, the repository is
unconfigured; its self-deletion is the state transition, so there are no
flag files to check or clean up.

The variants:

| Variant | What it means |
|---|---|
| `harness-railway` | Web app on Railway: one-time provisioning of production and preprod (app service, Postgres, object-storage bucket), plus an isolated preview environment per feature branch |
| `harness-plain` | Code-only: the full branch-and-release flow, no deploy target |

The Railway machinery ships quarantined under `.claude/setup/railway/`,
the pre-built technical foundation (a complete, verified Next.js
application) under `.claude/setup/foundation/`, and the opt-in MCP layer
(everything that lets agents call the application's tools) under
`.claude/setup/mcp/`. All three hold final repo-relative paths, so
applying any of them is one copy and declining one is doing nothing.
Nothing in the quarantine can trigger or fail until it is copied out.

## Division of labor

This skill owns the questions and the handoff. Everything deterministic
(guard checks, sync verification, workflow dispatch, polling, parsing
the two structured commit bodies, the payload copies, the sentinel, the
configuration commit, the provisioning watch, the liveness check) lives
in `.claude/scripts/setup.sh`, the spine this skill drives:

    bash .claude/scripts/setup.sh guard
    bash .claude/scripts/setup.sh prepare [--railway yes|no|unknown]
    bash .claude/scripts/setup.sh apply --railway yes|no --foundation yes|no \
        --mcp yes|no [--workspace <id>] [--first-time yes|no]

Every invocation ends with a `--- setup-status ---` block of
`key: value` lines, always including `phase:` and `outcome:`. Exit code
0 means the phase completed; non-zero means you take over, and the
block carries what you need to recover without re-deriving anything.
Read the whole block every time; never re-implement a spine step by
hand while the script can run it. The script deletes itself in the
configuration commit, alongside the quarantine and this skill.

## Steps

### 1. Guard

Run `bash .claude/scripts/setup.sh guard` and branch on `outcome:`:

- **`configured`**: this repository is already configured. Say so and
  stop; there is nothing to do.
- **`half-applied`**: a previous `/setup` was interrupted. Do not start
  over and do not re-ask questions the working tree already answers:
  the status block's `inferred-railway:`, `inferred-foundation:` and
  `inferred-mcp:` lines are the answers, and `inferred-change-prefix:`
  with `inferred-system-key:` say whether the identity lines already
  landed. `none` on the prefix line means Q2c is still owed, so ask it
  (and verify it, step 5b) before rerunning apply. Rerun
  `setup.sh apply` with exactly those answers (apply is idempotent), or
  follow the block's `detail:` line when it names a different finish
  (an unpushed configuration commit only needs its push).
- **`retry-after-failed-preflight`**: a previous session already got as
  far as the secrets check and stopped there. Open by saying so, quote
  the probe lines from the status block (`railway-token:`,
  `pat-secrets:`, any `pat-workflows:`), and ask whether the token has
  been fixed. On a retry: skip Q0 (the first-time question was answered
  last time), treat railway = yes as settled (a preflight only ever
  runs on that path), ask Q2 and Q2b only if `foundation=` and `mcp=`
  were not passed, and let `prepare` rerun the preflight in step 5.
- **`fresh`**: continue.

### 2. Arguments

Parse `$ARGUMENTS` for `railway=yes|no`, `foundation=yes|no`,
`mcp=yes|no` and `prefix=<PREFIX>`. The harnesscompanion.com wizard
passes them so its users answer nothing twice. Whatever is missing gets
asked in step 4.

`prefix=` is the change-key prefix the System Registry issued for this
system, and the wizard usually cannot pass it: most repositories are
scaffolded before their registry entry exists. Treat its absence as
normal and ask Q2c.

Accept `secrets=confirmed` silently if present (older wizard hand-offs
still pass it) but never act on it: the secrets preflight runs
regardless, because a planted secret says nothing about whether the
token inside it actually has the permissions provisioning needs.

### 3. Q0: first time? (always asked, except on a retry)

Skipped only when step 1 detected a retry after a failed preflight.
Otherwise ask via AskUserQuestion, before anything fires and regardless
of which arguments were passed (the wizard's arguments say nothing
about whether the user has seen the guide, and a wizard user is the
most likely first-timer):

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
"done" or "read it") resumes the skill at step 4. Anything else gets
answered as a normal question, after which you re-state the cue and
wait again; never continue past this point on an unrelated message.

**If no**: mention the guide URL in one line for reference
(www.harnesscompanion.com/firsttime) and continue straight to step 4.

**This gate is hard.** Nothing runs, fires, or pushes before it: the
pause is where a first-timer sets up their Claude, GitHub and Railway
connections. The `guard` subcommand in step 1 is the one thing that may
precede it, precisely because it mutates nothing.

### 4. Background prepare, questions in parallel

The moment Q0 resolves, do BOTH of these in the same turn:

1. Start the preparation in the background (the Bash tool's
   `run_in_background`), so its ~25 seconds of dispatch and poll
   latency disappears behind the questions:

       bash .claude/scripts/setup.sh prepare --railway <yes|no|unknown>

   Pass `--railway yes` or `--railway no` when the argument was given,
   `--railway unknown` when Q1 still has to be asked. With yes it also
   runs the secrets preflight; with unknown it deliberately does not,
   because a speculative preflight on a repository that then answers
   "no" would leave a red Actions run and a failed-result commit on a
   plain repo forever (forge decision record 0022).

2. Ask every still-unanswered question from the list below in ONE
   AskUserQuestion call (it takes up to four questions, and these are
   exactly four). Include a question only when its argument was not
   passed; include Q2 and Q2b only when railway is not already known to
   be no, and Q2b only when foundation is not already known to be no.
   **Q2c does not depend on any of the others** and is asked whenever
   `prefix=` was not passed, on the railway path and the plain path
   alike. When the arguments answered everything (the wizard path), there
   is nothing to ask: skip the AskUserQuestion call entirely and this
   step is just the background prepare, leaving Q0 and, when the
   workspace list demands it, Q3 as the only questions.

**Q1: deploy target.** If `railway=` was not passed:

> Will this project deploy to Railway?

- **Yes**: this becomes a `harness-railway` repository.
- **No**: this becomes a `harness-plain` repository.

Nothing else is needed here. A multi-workspace Railway account is
handled by Q3, once the preflight has read the account's actual
workspaces; never send the user to a settings screen to pick one by
hand.

**Q2: technical foundation.** If `foundation=` was not passed:

> Start from the standard technical foundation (Next.js 16, Drizzle,
> Better Auth, TanStack Query, optimistic UI)?

- **Yes**: the complete, pre-built application lands NOW, in this
  session. It is copied out of the quarantine as finished, verified
  files; there is no follow-up skill, no second session, and no code
  generation. It ships with a working notes app as an illustrative
  reference domain, replaced later through the normal `/feature` flow.
- **No**: the minimal Express starter stays in place until the first
  feature replaces it.

**Q2b: agents calling the app.** If `mcp=` was not passed:

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

**Q2c: the change prefix.** If `prefix=` was not passed:

> What change-key prefix did the System Registry issue for this system?

Two options, and nothing pre-selected:

- **I have one**: they type it into the free-text answer. It is a short
  word, `MYPR`, and it gives change keys like `MYPR-7`. Say in the option
  text that the answer goes in the free-text field.
- **Not yet, there is no registry entry for this system**: a first-class
  answer, not a failure. Most repositories are scaffolded before their
  registry entry exists.

Frame it as the repository's permanent name for its own changes, not as
a configuration value. Every feature this repository ever builds gets a
key under it, every branch and every environment starts with that key,
and the prefix is issued once and never released.

**Answering "not yet" costs exactly one thing, and the user is told it
here and again at the hand-off**: `/feature` cannot start without the
line, so the first feature waits until the prefix exists and the line is
added by hand. Nothing else in the repository is affected: the branch
flow, the checks, the release and (on the railway path) provisioning all
work without it.

**Never guess a prefix, and never derive one from the repository name.**
A prefix the registry did not issue mints keys that collide with the real
ones forever, and there is no way back: the keys minted under a prefix
outlive the mistake. No line at all is a session's inconvenience; a wrong
line is permanent.

**Batching over branching, handled after the fact.** Asking the three
together means Q2 and Q2b can be asked in a combination where they turn
out not to apply (Q1 answered no, or Q2 answered no under Q2b). Their
wording must not change, so resolve it afterwards instead: normalize
`foundation` to no when railway is no, and `mcp` to no when foundation
is no, and say plainly, in one line, that those answers did not apply
and were ignored. Never carry a yes into `apply` for a question that
did not apply. **Q2c is never normalized away**: the prefix applies to
every variant, because every repository mints change keys.

### 5. Collect the preparation

Read the background `prepare`'s output; it is normally already finished
by the time the questions are answered. If Q1 answered yes but prepare
ran with `--railway unknown`, run it again in the foreground, and tell
the user in one line that the secrets preflight is running and takes
about a minute:

    bash .claude/scripts/setup.sh prepare --railway yes

It is idempotent: the branch wait short-circuits and only the preflight
runs. Then branch on the final status:

- **`outcome: ok`**: continue. Relay `branches: timeout` in one line if
  present (setup does not depend on the branches; the first ADR and the
  first release do). On the railway path the block carries
  `preflight: pass` and the workspace list.
- **`outcome: sync-missing`**: report the `missing:` files as an
  upstream sync bug and stop. Never recreate missing files by hand;
  they come from the template sync or not at all.
- **`outcome: preflight-fail`**: print the probe lines from the block
  verbatim (`railway-token:`, `pat-secrets:`, any `pat-workflows:`),
  point at Settings > Secrets and variables > Actions and the guide
  (www.harnesscompanion.com/firsttime), and STOP before any mutation.
  The user fixes the token and reruns `/setup`; step 1's guard finds
  the failed result and the preflight simply runs again. Never ask the
  workspace question on this path.
- **`outcome: preflight-timeout`**: surface the block's `run-url:` and
  its `detail:` causes (`PAT_TOKEN` lacking Contents: Read and write,
  or Actions disabled on the repository). STOP before any mutation.
- **`outcome: dispatch-failed`** (or a `push-error:` on the preflight
  path): the sentinel push was rejected. Fire the named workflow
  yourself via the GitHub MCP server (`actions_run_trigger`, method
  `run_workflow`, `ref: preprod`, owner/repo from
  `git remote get-url origin`), then rerun `prepare` with `--poll-only`;
  when the status carried a `stale-result:` other than `none`, append
  `--stale-result <that sha>` so the poll waits out the result that
  already sat on preprod instead of re-reading it.

### 5b. Verify the change prefix

Skip this entirely when Q2c answered "not yet": there is nothing to
verify, and the hand-off says what happens next.

The registry client is `.claude/scripts/registry.sh`, and it reads
`REGISTRY_URL` and `REGISTRY_TOKEN` from the environment. **Where either
is unset, ask and trust**: say in one line that the prefix was recorded
as given and not checked, and go to step 6. A code-only scaffold with no
registry must never be blocked here.

Where both are set:

    bash .claude/scripts/registry.sh prefix <PREFIX>

The exits, and what each one means for this session:

| Exit | Meaning | Do |
|---|---|---|
| 0 | The prefix resolves to a system | Read the system out of the JSON on stdout and confirm it with the user, below |
| 1 | The registry has no system with this prefix | **Stop.** Show the prefix back and ask for the right one, or for "not yet" |
| 2 | The prefix is a shape no change key could be built from | **Stop.** The message says why; ask again |
| 3 | A variable is unset or blank | A half-configured registry. Say so in one line, record the prefix unverified, continue |
| 4 | `REGISTRY_TOKEN` was refused | Say so in one line, record the prefix unverified, continue |
| 5 | The registry could not be reached | Say so in one line, record the prefix unverified, continue |

**Only exit 1 and exit 2 stop.** Three, four and five mean this session
learned nothing about the prefix, and refusing to configure a repository
because a lookup was unavailable would trade a permanent problem for a
temporary one in the wrong direction. Say which of the three happened,
in the registry's own words, and carry on unverified.

**On exit 0, confirm the system with the user before recording anything.**
The response body is the registry's, not this skill's: read it and put
the system's name, its permanent key and its status in front of them, then
ask, in one short question, whether that is the system this repository
belongs to.

- **Yes**: record the prefix as the registry spells it (the lookup is
  case-insensitive, so what the user typed and what the registry holds
  may differ in case, and the registry's spelling is the one to keep),
  and record the permanent key too.
- **No**: the prefix belongs to someone else's system. **Stop and say
  so.** Ask for the right prefix, or for "not yet". This is the whole
  reason the lookup happens before anything is written.

A system the registry reports as **retired** is still a match, not a free
prefix: the keys minted under it are still out there. Say that it is
retired when you show it, and let the user answer the same question. Only
they know whether this repository is that system coming back.

### 6. Q3: which Railway workspace (only when there is a choice)

Count the `workspace:` lines in the prepare status
(`workspace-count:` says it directly).

**Exactly one**: ask nothing. Say in one line which workspace the
project will land in, and go to step 7. This is the common case and it
must stay silent; a token scoped to a single workspace lands here too.

**More than one**: ask via AskUserQuestion, one option per workspace:

> Which Railway workspace should this project be created in?

Each `workspace:` line is the key, the workspace id, and the workspace
name, which may itself contain spaces; split on the first space after
the id. Label each option with the workspace **name** and put the id in
the option's description, so the choice reads in human terms while
staying unambiguous between two similarly named workspaces. Keep the
ids verbatim; they are what provisioning uses.

Three rules on this question:

- **Pre-select nothing.** Do not highlight a default, do not order the
  list to imply one, and do not guess from the repository name or any
  other similarity. A wrong guess the user clicks through provisions a
  real project into the wrong workspace, which is the entire failure
  this question exists to prevent.
- **Wait for the answer.** Never infer it, never proceed on silence.
- **Record the chosen id.** It reaches provisioning only as `apply`'s
  `--workspace` flag, which writes it to the sentinel.

This question is never reached on a failing preflight, because step 5
stops there.

### 7. Apply

Before firing it, print the timeline once, so the coming quiet
stretches read as normal instead of broken. Adapt it to the answers:

    1. Apply configuration      seconds
    2. Push and provisioning    ~1-3 minutes
       (foundation=yes: verification runs during this wait)
    3. Your live URLs           printed here

Plain (railway = no) setups skip the timeline: they finish in seconds.

Then run apply ONCE, in the foreground, with every answer. No further
human interaction happens past this point:

    bash .claude/scripts/setup.sh apply --railway <yes|no> \
      --foundation <yes|no> --mcp <yes|no> \
      [--workspace <id>] --first-time <yes|no> \
      [--change-prefix <PREFIX>] [--system-key <KEY>]

Pass `--workspace` only when Q3 was asked. Pass `--first-time` from the
Q0 answer; the script echoes it back so step 9 can branch without
remembering.

Pass `--change-prefix` with the prefix Q2c produced, and `--system-key`
with the permanent key **only when step 5b verified it and the user
confirmed the system**. Pass neither when Q2c answered "not yet". Pass
the prefix alone when step 5b could not check it (exits 3, 4 and 5): the
key records which system the prefix resolved to, so recording one this
session never saw would be inventing the answer the check exists to make.
The script writes both into `.harness-version` and echoes them back as
`change-prefix:` and `system-key:` in the apply status.

The script does the rest: payload copies, the one
package.json name substitution, the `.harness-version` rewrite, the
self-delete (quarantine, this skill, the spine script itself, and on
the plain path the preflight workflow), the provisioning sentinel, the
single configuration commit pushed to `preprod`, the checkout move off
any `claude/` branch, the provisioning watch, the liveness check, and,
on the foundation path, the verify chain
(`pnpm install --frozen-lockfile && pnpm typecheck && pnpm lint &&
pnpm check:docs`) running concurrently with the provisioning watch.

While it runs, narrate against the timeline: one line when the status
output shows each stage starting, so the user always knows which wait
they are in.

### 8. Read the apply status

- **`outcome: ok`**: continue to the handoff. The block carries
  `production-url:` and `preprod-url:` (railway), `liveness:` (`live`,
  or `unconfirmed` with a note saying the deploy may simply still be
  rolling; relay that honestly and do not treat it as a failure), and
  `verify:` (`pass`, or `skipped (...)`; when skipped, say so plainly
  in the handoff and never imply the check ran).
- **`outcome: verify-failed`**: provisioning succeeded and the
  configuration commit is on `preprod`, but the local verify chain
  failed. Report the URLs as on the ok path, then diagnose from the
  `verify-log:` lines; the cause is almost always the local toolchain
  (Node 22.11+ or pnpm missing or mismatched), and the same chain runs
  in CI on every future merge.
- **`outcome: provisioning-timeout`**: no cleanup commit appeared. Do
  NOT diagnose from the timeout alone; read the workflow run first, at
  the block's `run-url:`. Two distinct states, one of them recoverable
  right here:
  1. **The run failed during provisioning.** The three known causes:
     `RAILWAY_ACCOUNT_TOKEN` scoped to the wrong workspace; several
     Railway workspaces and no `workspace:` line on the sentinel (Step
     1 of the run fails listing the available workspaces; the sentinel
     was written without the Q3 answer, or the run was dispatched by
     hand); `PAT_TOKEN` missing Secrets: Read and write (needed to
     store `RAILWAY_PROJECT_ID`; rare after a passed preflight, but a
     secret rotated between preflight and bootstrap lands here).
     Explain the re-fire: after fixing the cause, commit
     `.harness-bootstrap` again with a fresh timestamp and push to
     `preprod`; keep the `foundation:` line, and the `workspace:` line
     on a multi-workspace account, or Step 1 refuses again.
  2. **The run succeeded through provisioning but went red on its
     cleanup step.** Provisioning is DONE and the URLs are real; only
     the cleanup commit did not land. This is recoverable without
     re-provisioning: read `production-url:` and `preprod-url:` from
     the run log (the cleanup step echoes both, and the `=== Done ===`
     block prints the same URLs), finish the cleanup by deleting
     `.github/workflows/harness-railway.yml` and `.harness-bootstrap`
     from `preprod` in one commit, and hand off with those URLs as if
     provisioning had reported normally.
- **`outcome: push-failed` / `local-diverged` / `payload-damaged`**:
  follow the block's `detail:` line; each names its own finish.

### 9. Hand off

The close has a shared core and an audience-specific ending, chosen by
the `first-time:` echo in the apply status.

Shared core, for everyone:

- A one-line configuration summary (variant, foundation materialized or
  not, and whether the verify chain ran; `verify:` in the status says
  which, honestly).
- **The change prefix, in one of three shapes.** This is the line that
  decides whether the user's next session works, so it is never left out:
  - **Recorded and verified**: name the prefix and the system it resolved
    to, and say the first feature will be `<PREFIX>-1`.
  - **Recorded, not verified** (the registry was unset, refused or
    unreachable, per step 5b): name the prefix, say plainly that it was
    taken as given and not checked, and say which of the three it was.
  - **Not recorded** (Q2c answered "not yet"): say that `/feature` will
    stop at its first step until the line exists, and give the exact
    remedy, on its own, as the two things it is: get the prefix from the
    System Registry, then add one line to `.harness-version`:

        change-prefix: MYPR

    Say that nothing else is blocked, and that the line can be added at
    any time, by anyone, in any session.
- The production and preprod URLs, when railway = yes, and whether the
  liveness check confirmed production serving (`liveness: live`).
- When mcp = yes: the MCP endpoint is live at `<production-url>/api/mcp`
  and at the preprod URL too. Print it. Say in one line that a client
  authorizes with the same accounts the app uses, so the first
  connection walks a normal sign in and a consent screen, and that the
  client must speak MCP revision **2026-07-28**: an older client is
  refused with a version error rather than a broken session, which is a
  version mismatch and not a fault in the app. Point at
  `docs/architecture/mcp-server.md` for connecting a client and at
  `/mcp-tool` for adding the next tool.
- When foundation = yes: the application is already in place, and the
  verify chain ran alongside provisioning (or was skipped, if the
  session lacked Node 22.11+ or pnpm; say which, honestly).
  Provisioning migrates the database, runs the idempotent seed, and
  serves the app at the preprod URL with the demo login, with zero
  manually set variables: the bootstrap set `BETTER_AUTH_SECRET`
  (generated separately per environment), `SEED_DATA` (`false` on
  production, `true` on preprod), and `SHOW_DEMO_LOGIN` (`true` on
  preprod, never on production). Name the variables, never their
  values; the secrets are masked in the workflow and this session never
  sees them. Mention that preprod and every feature preview therefore
  offer a publicly reachable one-click demo login, so preprod must hold
  no real data.

**First-timer ending (first-time: yes)**: end on the payoff, then the
path, in the same warm register the welcome opened with:

1. The see-it-work moment, concrete for their configuration:
   foundation = yes means "open your preprod URL and click the demo login;
   that is your app, seeded and running", and with mcp = yes add that
   the same app is already reachable by an agent at `/api/mcp`;
   railway without foundation
   means "open your production URL; that page is your pipeline working
   end to end"; plain means a one-line tour of what now exists
   (workflows, skills, the docs skeleton).
2. The first feature: start a fresh chat, type `/feature`, and describe
   one small idea in a sentence; the harness drives it from there,
   including the questions. Nothing else to install or configure, **when
   the prefix was recorded**. When it was not, this is the one thing that
   is: say so here too, in their words, so the send-off is not the last
   place a blocker could have been mentioned.
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

**Returning-user ending (first-time: no, or a retry)**: one line: fresh
chat, `/feature`, done. They know the drill; do not tour them. The one
exception is a missing prefix: that is a second line, because `/feature`
will not start without it and a returning user has no reason to expect
that.
