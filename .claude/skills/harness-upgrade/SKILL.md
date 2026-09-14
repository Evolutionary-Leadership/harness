---
name: harness-upgrade
description: Upgrade harness infrastructure (workflows, skills, hooks, settings) to a target version, planned against the published template repo.
disable-model-invocation: true
argument-hint: "[optional: target version, e.g. 0.7.7]"
---

# Upgrade Harness

Upgrade this project's harness infrastructure to a target version.

The upgrade source is the **published template repo**, which carries a
tagged snapshot of exactly the tree a scaffold receives. Every tagged
version is a byte-exact picture of what your repo should look like at that
version, so the plan is a comparison of two real trees rather than a replay
of change descriptions. That is what makes it correct even when you have
edited a managed file by hand.

Everything the upgrade reads is public and needs no credentials, and
nothing it reads comes from an API: version discovery is `git ls-remote`,
the trees are `git clone`, and the release notes ride in the cloned tree.
That is what lets it run in a sandbox, behind a proxy, or offline against a
tree already on disk.

## Steps

### 1. Read the current stamp

Read `.harness-version` in the project root:

```
harness: harness-plain
version: 0.7.5
repo: Evolutionary-Leadership/harness
check: ...
```

Extract three values:

- `VARIANT`: `harness-plain` or `harness-railway`. A repo stamped before
  0.4.4 carries a retired spelling instead; pass it through unchanged, the
  planner normalises it.
- `CURRENT`: the installed version
- `REPO`: the published template repo, `owner/name`

If `.harness-version` is missing, tell the user this project does not
appear to be harnessed and stop.

If the `harness:` line says `unconfigured`, this repository was scaffolded
from the template but `/setup` never ran. Tell the user to run `/setup`
first and stop.

If `repo:` names a repository you cannot read, say so plainly and stop.
The usual cause is a repo stamped before the upgrade source moved to the
published template repo. The fix is one line, and saying it is more useful
than reporting a 404:

> Your `.harness-version` points at `<REPO>`, which this upgrade cannot
> read. The harness now publishes upgrades from
> `Evolutionary-Leadership/harness`. Change the `repo:` line to that and
> run `/harness-upgrade` again.

Do not rewrite the line yourself. `repo:` is the user's configuration, and
silently repointing it would hide where upgrades come from.

### 2. Resolve the target version

List the published tags. This is a git operation, not an API call, so it
costs nothing against any rate limit:

```bash
git ls-remote --tags "https://github.com/$REPO" 'v*' \
  | sed 's|.*refs/tags/||' | grep -v '\^{}' | sort -V
```

Pick the target:

- If `$ARGUMENTS` names a version, that is `TARGET`. If no tag matches it,
  say which versions are published and stop.
- Otherwise `TARGET` is the newest published tag.

Compare `CURRENT` with `TARGET` by semver:

- Equal: tell the user they are up to date and stop.
- `TARGET` older than `CURRENT`: warn that downgrades are not supported and
  stop.

A tag exists for a version only when that release published a note, so the
newest tag is the newest *released* version. That is the right target: an
untagged version is content that was synced without a release.

### 3. Fetch the target tree

Shallow-clone the target tag into a temporary directory:

```bash
WORK=$(mktemp -d)
git clone --quiet --depth 1 --branch "v$TARGET" \
  "https://github.com/$REPO" "$WORK/target"
```

This is a few megabytes and about a second. It costs no API calls, so
neither the unauthenticated rate limit nor any per-response file cap
applies, and the tree it gives you is the exact content of that version
rather than whatever is currently at the head of a branch.

Also clone the **installed** version, when it has a tag:

```bash
PREVIOUS=""
if git clone --quiet --depth 1 --branch "v$CURRENT" \
     "https://github.com/$REPO" "$WORK/previous" 2>/dev/null; then
  PREVIOUS="$WORK/previous"
fi
```

This one is optional and is only used to detect files the harness has
retired. When `CURRENT` has no tag the clone fails harmlessly, `PREVIOUS`
stays empty and deletions are simply not offered. Say so in the plan
rather than guessing: without this tree, a file missing from the target
cannot be told apart from a file the user wrote.

If the target clone fails, report the failure and stop. Do not fall back to
another source.

### 4. Build the file plan

Run the planner that ships with the harness:

```bash
node .claude/scripts/harness-upgrade-plan.mjs \
  --target "$WORK/target" \
  --local . \
  --variant "$VARIANT" \
  ${PREVIOUS:+--previous "$PREVIOUS"} \
  --pretty
```

Add `--verbose` only if you need the full per-path refused list. By default
the planner omits it and gives you `blockedSummary` instead, because on a
real tree that list runs to well over a hundred entries and the summary is
what you render.

It returns JSON with `variant`, `targetRoot`, `update`, `create`, `delete`,
`skipped`, `blocked`, `blockedSummary`, `stamp`, `deletionsDetected` and
`hazards`.

Every entry's `source` is **relative to `targetRoot`**, which the plan
carries once. Join the two to read or copy a file. The absolute clone path
is never inlined into an entry: it would put the same `mktemp` prefix in
front of a hundred paths and make two runs of the same plan impossible to
compare.

`deletionsDetected` is false when no previous tree was available. Say so in
the plan when it is: "retired files were not checked for, because the
version you are on was never tagged" is honest, and silence reads as
"nothing was retired".

`variant` is the normalised name, which differs from your stamp when the
repo was stamped before 0.4.4.

### 4b. Stop on a hazard, and ask

`hazards` is not a file list. Each entry is something about THIS repository,
read from its own stamp, that the upgrade would otherwise carry past in
silence, with an `id`, a `summary` and a `fix`.

**A non-empty `hazards` stops the upgrade here.** Print every entry's summary
and its fix, then ask the user what they want to do, and wait. Do not apply
anything, do not offer to apply anything, and do not rank the hazard against
the file plan: a hazard is about the repository being sound, and the plan is
about files.

```
HAZARD  {id}
  {summary}

  {fix}

Nothing has been applied. Fix this first, or say to continue anyway.
```

The one hazard the harness ships today is
`spec-loop-armed-without-product`: a `check:` line that runs `check:spec`
while `.harness-version` carries no `spec_product:` key. With no key the
checker prints one line and exits 0 before it reads a credential or walks the
tree, which is right for a repository that never connected a specification and
catastrophic for one that did: its anchor gate has stopped enforcing and its
build stays green. **That is why this stops rather than warns.** Everything else in an
upgrade is visible in a diff; a gate that reports success because it stopped
looking is visible nowhere.

The user may continue anyway: the shape is legal, and a repository whose loop
is deliberately dormant should drop `check:spec` from its `check:` line rather
than add a key. Take the answer, say which one they took, and carry on.

**The planner owns the rules, not you.** It decides which paths are
managed, which are write-once, and which must never be written. Do not
second-guess it, do not add a path it left out, and do not write anything
it classified as blocked or skipped, however reasonable it looks. Those
classifications are the contracts the upgrade exists to keep:

- **Config** files (`.claude/settings.json`, `.github/dependabot.yml`,
  `railway.json`, `.env.example`) arrive as defaults a project extends.
  An update entry for one carries `merge: true`: merge it, never copy over
  it, or you silently drop the entries the project added. An entry carrying
  `merge: "superseded"` instead is one the project has diverged from
  **on purpose**, and merging it changes nothing: see step 7.
- **Write-once** files are created only when missing, per file, and are
  never overwritten and never resurrected once deleted. A create entry
  marked `unverified` means there was no previous tree to tell "you
  deleted this" from "this was never installed"; offer it, and say which
  it is you could not determine.
- **Blocked** paths are one-shot setup and bootstrap machinery, the
  published release notes step 5 reads, and the template repo's own README.
  A restored setup spine would sit armed in a repo that must never run it
  again; the release notes are the publisher's record, not your project's;
  and the template repo's README is not your project's README. LICENSE and
  NOTICE are write-once rather than blocked, so a project that never
  received them still can.
- **Deletions** are only ever proposed for paths in trees the harness owns
  outright, and only when the installed version's tree was available.

**Exit 3 means the target tree is the wrong tree.** The planner refuses to
plan against the repository that *authors* the harness rather than a
rendered release of it, because doing so would propose writing authoring
files (`CLAUDE.md`, `VERSION`, `CHANGELOG.md`, publishing workflows) into
this project. It is the failure a stale `repo:` line produces for anyone
who happens to be able to read that repository, where an external user
would simply have got a 404. Report the planner's message and stop.

If the planner is missing (an older scaffold), say so and stop: it ships at
`.claude/scripts/harness-upgrade-plan.mjs` and arrives with the upgrade
itself, so the fix is to copy that one file from the target clone first.

### 5. Build the narrative, from the clone you already have

The file plan says what will change. It does not say why. The published
release notes are **already in the tree you cloned in step 3**, one file per
version:

```bash
NOTES="$WORK/target/.claude/setup/release-notes"
```

Read the ones in range, oldest first:

```bash
for v in $(ls "$NOTES" 2>/dev/null | sed 's/\.md$//' | sort -V); do
  # v <= CURRENT: already installed, not part of this upgrade.
  [ "$(printf '%s\n%s\n' "$v" "$CURRENT" | sort -V | head -1)" = "$v" ] && continue
  # v > TARGET: not being installed by this run.
  [ "$(printf '%s\n%s\n' "$v" "$TARGET" | sort -V | tail -1)" = "$TARGET" ] || continue
  printf '== %s\n' "$v"
  cat "$NOTES/$v.md"
done
```

**This makes no network call, and that is the point.** The notes used to be
fetched from the releases API. That call cannot succeed from a sandboxed
agent session: outbound HTTPS goes through a proxy that returns 403 for any
repository not attached to the session, and the template repo is never
attached during an upgrade, because you are upgrading *from* it rather than
working *in* it. The failure was total rather than occasional, and what it
dropped was the Breaking section. Reading the clone works offline, in any
sandbox, and with no credential.

Each file carries the same five H3 sections in a fixed order: **Breaking**,
**Features**, **Fixes**, **Improvements**, **Notes**. A section with nothing
to say is omitted. The publisher rejects anything else, so parse by those
headings rather than guessing at structure. Collect the items under each
heading across the whole range, keeping the version each came from.

**Resolve the current stamp honestly.** If `CURRENT` has no tag, the range
cannot start where the user actually is. Fall back to the nearest older
tag and say which one you used. Never present a narrative that silently
starts somewhere other than where the user is.

**Report coverage, and only from what you can actually count.** You can
count the notes present in the range and name the range's endpoints. You
**cannot** enumerate the versions that shipped without notes, because an
untagged version leaves no public trace: no tag, no release, nothing to
list. So report the first and name the second as unknown:

> 3 versions carry notes between 0.6.1 and 0.7.7. Versions released
> without a note leave no public record, so there may be changes below
> this list does not describe.

Never state a count of noteless versions. There is no source for it, and
inventing one turns an honesty measure into a fabrication.

#### When the notes cannot be read

`$NOTES` is missing when `TARGET` predates the release that started
rendering notes into the tree. Every version before that one is narrated by
nothing this skill can reach offline.

**Do not treat that as a minor inconvenience, and do not carry on quietly.**
A missing narrative is a missing *Breaking* section, and Breaking items are
the part of an upgrade that copying files does not perform. Say so where
the Breaking items would have gone, in step 6, above the confirmation
prompt, in these words:

```
BREAKING  COULD NOT BE READ
  {CURRENT} to {TARGET} carries no readable release notes, so this plan
  cannot tell you what breaks.

  A breaking item is work this upgrade does NOT perform: it copies files.
  Applying now means applying without that list in front of you.

  Read them first at https://github.com/{REPO}/releases, in a browser
  outside this session: the same proxy that refused the API refuses that
  page too.

  Why they could not be read: {the target tag predates rendered notes /
  the directory is empty / whatever you actually found}
```

Then ask the confirmation question with that banner above it. The user may
still apply, and that is their call; what they may not do is apply without
being told that the list is missing.

### 6. Present the plan, Breaking first

Show the narrative above the file plan, and show **Breaking items above the
confirmation prompt**, before the file list. Where the notes could not be
read at all, the `BREAKING  COULD NOT BE READ` banner from step 5 goes in
exactly that slot; the slot is never simply empty.

This ordering is the point. Breaking items usually need manual action that
copying files does not perform, so a user who approves without reading them
gets a half-applied upgrade and no signal that anything is outstanding.

```
Harness upgrade: {CURRENT} to {TARGET} ({N} versions)

HAZARD
  {id}: {summary}

  {fix}

BREAKING
  {version}: {item}
  {version}: {item}

  These need action from you. Applying this upgrade does not perform them.

What changed
  Features
    {version}: {item}
  Fixes
    {version}: {item}
  Improvements
    {version}: {item}
  Notes
    {version}: {item}

  Coverage: {narrated} version(s) in this range carry a note.

Files to update ({n})
  {path}
    {diff}

Config to merge ({n})   <- never copied over; your entries are kept
  {path}   adds {keys}
    {diff}

Config where only values differ ({n})   <- no setting of yours is missing
  {path}   the template's {list} carries entries yours does not

Config already ahead of the template ({n})   <- expect no change
  {path}   template default, diverged on purpose

Files to create ({n})
  {path}   (missing locally)

Files to remove ({n})
  {path}   (retired by the harness)

Left alone
  {n} write-once file(s) already present
  {n} path(s) never written into a configured repo: {rule} and others

Version stamp
  .harness-version: version line {CURRENT} -> {TARGET}, written last
```

A config update entry names which of three shapes it is, and each gets its
own list. Never fold them together:

| `merge` | List | Means |
|---|---|---|
| `true` | Config to merge | the template sets keys this project lacks. `newKeys` says which; render them, so the user sees the size before approving |
| `"values-only"` | Only values differ | no setting is missing, but a list the template sets carries entries this one does not. `newLists` names the key paths |
| `"superseded"` | Already ahead | nothing the template sets is absent here. The merge would change nothing |

**`"values-only"` is a question, not a verdict, and it is the user's to
answer.** Whether the template's extra list entries should be taken depends
on who owns the list, and nothing in the file says. The harness accumulates
into `.claude/settings.json`'s `hooks` and `permissions`, so a new entry
there is a behaviour this project should receive. `railway.json`'s
`watchPatterns` is the opposite: a value the project tuned for its own
stack, where the template's entries name files the project may not even
have. Say which list differs and what the template puts in it, and let the
user decide.

Render `blockedSummary` as one line per rule rather than listing every
refused path; a setup payload runs to well over a hundred files and the
detail is noise.

Show a real diff for each file to be updated. Where a file changed across
several versions in the range, show only the final state; the narrative
already carries the story of how it got there.

Then **ask for confirmation**. The user may apply everything, apply
selectively, or abort. **Change nothing until they confirm.**

Deletions are always confirmed separately, even inside "apply everything".
Removing a file is the one action here the user cannot undo by re-running
the upgrade.

### 7. Apply what was approved

Copy each approved file from the target clone to its path in the project.
The planner has already resolved which layer each file comes from, so
apply its `source`, joined onto `targetRoot`, rather than recomputing a
path.

Two kinds of entry are not plain copies:

**Anything marked `merge: true`** (the config class): add what the target
introduced and keep everything the project added. Never drop a key the
project has and the target does not.

> **A config merge NEVER changes a value the project already sets.** It
> only ever adds keys the project is missing. There is no case in which
> the template's value for a key the project has already chosen is the
> right one: the project chose it later, and with knowledge of its own
> stack that the template does not have.

**Anything marked `merge: "superseded"`**: do nothing to the file, and say
so. The project sets every key the template's copy sets and its lists
already carry everything the template's do, so there is nothing to add and
the only differences are values it chose on purpose.

**Anything marked `merge: "values-only"`**: change nothing until the user
says which entries to take. No setting is missing; a list the template sets
carries entries this project's does not, and only the user knows whether
that list is theirs or the harness's. Show the entries and ask.
`railway.json` is why this is a question rather than a copy: the template
ships the generic scaffold default (`node server.js`, npm, a Prisma migrate
line) and a real project ships its own start command, package manager and
watch patterns. Taking the template's entries there would write a start
command naming a `server.js` the same plan reports as deleted by the user,
which is a broken production deploy shipped by an upgrade. Taking them in
`.claude/settings.json` is the opposite: a hook the harness added is a
behaviour the project should have.

**`CLAUDE.md`**: never overwrite. Compare against the target's
`claude-md-snippet.md` and *suggest* additions for the user to apply.

Everything else in the plan is a straight copy of the target's content.

### 8. Verify the result, then stamp the version

**The stamp goes last, and only if the result verifies.** It used to be
written straight after the copies, which meant a failed copy left the repo
claiming a version it did not hold. That is worse than it sounds: the stamp
is the input to the NEXT upgrade's plan, so a wrong one propagates itself
and every later run plans from a version that never existed here.

Re-run the planner against the same target tree:

```bash
node .claude/scripts/harness-upgrade-plan.mjs \
  --target "$WORK/target" \
  --local . \
  --variant "$VARIANT" \
  ${PREVIOUS:+--previous "$PREVIOUS"} \
  --pretty
```

Every entry the user approved must be gone from `update` and `create`. The
re-plan costs nothing, it reads the tree you just wrote, and it is a real
post-condition check rather than a claim: it proves the copies landed.

| Re-plan says | Do |
|---|---|
| Nothing the user approved is left | Amend the stamp, below |
| An approved entry is still listed | **Do not stamp.** Name the paths that did not land, say the repo now holds a mixture of `{CURRENT}` and `{TARGET}`, and stop |
| Entries the user declined are still listed | Expected. They are not part of this upgrade; ignore them |

`merge` entries are the one thing the re-plan cannot clear: a merged config
still differs from the target's copy by design, so it comes back as an
update entry every time. Check those by reading the file, not by the plan;
a `merge: "superseded"` entry needs no check at all, and a
`merge: "values-only"` entry needs one only where the user chose to take
some of the template's list entries.

Once it verifies, rewrite **only** the `version:` line of `.harness-version`:

```
version: {TARGET}
```

Never replace the file wholesale. It carries fields this upgrade knows
nothing about (the check command, reviewers, the `agent-authority` grant,
anything the project added), and they must all survive.

### 9. Offer to route an oversized CLAUDE.md

`CLAUDE.md` loads on every session, so a router that has grown into a
catalog is paid for on every one. **Read the budget this project states
rather than picking a number**; a second threshold that disagrees with the
standard it cites teaches the reader to trust neither:

```bash
# Only lines that are ABOUT CLAUDE.md. A docs index states several budgets
# (AGENTS.md's is 20), and taking the first number on the page would have
# this fire on every repository.
BUDGET=$(grep -hF 'CLAUDE.md' CLAUDE.md docs/README.md .claude/HARNESS.md 2>/dev/null \
         | grep -oiE '(budget:? *~?|under a ~?)[0-9]{2,4}[ -]line' \
         | grep -oE '[0-9]{2,4}' | head -1)
case "$BUDGET" in ''|*[!0-9]*) BUDGET=300 ;; esac
# A two-digit budget belongs to a pointer file, not to a router. Reading one
# as CLAUDE.md's would nag on every single session, which is the failure
# this whole step exists to avoid creating.
[ "$BUDGET" -lt 100 ] && BUDGET=300
```

The fallback is the harness docs standard's own router budget. **Say which
number you used and where you read it**, so a user whose repository states
its budget somewhere this cannot see can correct you in one line. Count the
lines in `CLAUDE.md`; if it is meaningfully over `BUDGET`, offer the
extraction:

```
CLAUDE.md is {N} lines, against a {BUDGET}-line budget stated in {file}.

CLAUDE.md loads on every session. Under the harness docs standard it is a
router: conventions, one-way decisions, definition of done, don't-touch
list, writing rules, and a map of which doc to read.

Catalog sections that belong in docs/architecture/:
  "{heading}" (lines {a}-{b}) -> docs/architecture/{suggested}.md
    sources: [{globs covering the files that section describes}]
```

Identify candidates by shape, not by topic: a section is a catalog if it is
mostly a table or list enumerating routes, tools, components, tables, env
vars, or files. Conventions, invariants and rules stay in the router no
matter how long they are.

**Only extract if the user says yes.** When they do: create
`docs/architecture/<name>.md` with the `sources:` front-matter, move the
content verbatim without rewriting it in the same pass, delete the section
from `CLAUDE.md` and leave a row in its map table pointing at the new file,
add the index row to `docs/README.md`, then run `node
scripts/check-docs.mjs` and fix what it reports.

### 10. Summarize, and say what to do with the result

Report, in this order:

- **Any hazard the user chose to continue past**, repeated from step 4b with
  its fix. It was true before this upgrade and it is still true after it, and
  this is the last place anyone sees it.
- **Breaking items still outstanding**, repeated from the narrative, or the
  `COULD NOT BE READ` banner if that is what step 5 produced. This is the
  last chance the user has to see them, and copying files did not perform
  them.
- **Applied**: files updated, created and removed.
- **Verified**: that the re-plan came back clean, or exactly which approved
  paths did not land and that the stamp was therefore NOT written.
- **Left alone**: write-once files already present, config the project has
  superseded, and refused paths.
- **Manual review**: the config merges, and any `CLAUDE.md` suggestions.

Then say what happens to the change, because an upgrade is not ordinary
work and the default a session brings with it is the wrong one:

> **This is a reviewed commit, not an auto-push.** An upgrade rewrites the
> workflows, skills and hooks that decide how every future session in this
> repository behaves, and nothing in it was written by a person. Stage it,
> read `git diff`, check that the workflows and hooks still run, and commit
> it yourself.

Say that even when the session you are running in instructs you to commit
and push completed work: those instructions are about the project's own
code, and this change is the machinery that will run over it. Commit when
asked to; do not push a harness upgrade unattended.

Finally, remove the temporary clones:

```bash
rm -rf "$WORK"
```
