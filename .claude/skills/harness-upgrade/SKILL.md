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

Everything the upgrade reads is public and needs no credentials.

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

It returns JSON with `variant`, `update`, `create`, `delete`, `skipped`,
`blocked`, `blockedSummary`, `stamp` and `deletionsDetected`.

`deletionsDetected` is false when no previous tree was available. Say so in
the plan when it is: "retired files were not checked for, because the
version you are on was never tagged" is honest, and silence reads as
"nothing was retired".

`variant` is the normalised name, which differs from your stamp when the
repo was stamped before 0.4.4.

**The planner owns the rules, not you.** It decides which paths are
managed, which are write-once, and which must never be written. Do not
second-guess it, do not add a path it left out, and do not write anything
it classified as blocked or skipped, however reasonable it looks. Those
classifications are the contracts the upgrade exists to keep:

- **Config** files (`.claude/settings.json`, `.github/dependabot.yml`,
  `railway.json`, `.env.example`) arrive as defaults a project extends.
  An update entry for one carries `merge: true`: merge it, never copy over
  it, or you silently drop the entries the project added.
- **Write-once** files are created only when missing, per file, and are
  never overwritten and never resurrected once deleted. A create entry
  marked `unverified` means there was no previous tree to tell "you
  deleted this" from "this was never installed"; offer it, and say which
  it is you could not determine.
- **Blocked** paths are one-shot setup and bootstrap machinery, plus the
  template repo's own README. A restored setup spine would sit armed in a
  repo that must never run it again, and the template repo's README is not
  your project's README. LICENSE and NOTICE are write-once rather than
  blocked, so a project that never received them still can.
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

### 5. Build the narrative

The file plan says what will change. It does not say why. Fetch the
published release notes so the user gets both:

```bash
curl -sf "https://api.github.com/repos/$REPO/releases?per_page=100"
```

This is the only API call the upgrade makes. If it fails, note that the
narrative is unavailable and carry on with the file plan. A missing
narrative never blocks an upgrade.

Keep the releases whose version is greater than `CURRENT` and at most
`TARGET`, ordered oldest first.

Each body carries the same five H3 sections in a fixed order: **Breaking**,
**Features**, **Fixes**, **Improvements**, **Notes**. The publisher rejects
anything else, so parse by those headings rather than guessing at structure.
Collect the items under each heading across the whole range, keeping the
version each came from.

**Resolve the current stamp honestly.** If `CURRENT` has no tag, the range
cannot start where the user actually is. Fall back to the nearest older
tag and say which one you used. Never present a narrative that silently
starts somewhere other than where the user is.

**Report coverage, and only from what you can actually count.** A version
ships a note only when its release published one, so a range is often
narrated in part.

You can count exactly two things: the number of releases you fetched that
fall in the range, and the endpoints of the range itself. You **cannot**
enumerate the versions that shipped without notes, because an untagged
version leaves no public trace: no tag, no release, nothing to list.
So report the first and name the second as unknown:

> 3 releases carry notes between 0.6.1 and 0.7.7. Versions released
> without a note leave no public record, so there may be changes below
> this list does not describe.

Never state a count of noteless versions. There is no source for it, and
inventing one turns an honesty measure into a fabrication.

### 6. Present the plan, Breaking first

Show the narrative above the file plan, and show **Breaking items above the
confirmation prompt**, before the file list.

This ordering is the point. Breaking items usually need manual action that
copying files does not perform, so a user who approves without reading them
gets a half-applied upgrade and no signal that anything is outstanding.

```
Harness upgrade: {CURRENT} to {TARGET} ({N} versions)

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

  Coverage: {narrated} of {total} versions in this range shipped a note.

Files to update ({n})
  {path}
    {diff}

Config to merge ({n})   <- never copied over; your entries are kept
  {path}
    {diff}

Files to create ({n})
  {path}   (missing locally)

Files to remove ({n})
  {path}   (retired by the harness)

Left alone
  {n} write-once file(s) already present
  {n} path(s) never written into a configured repo: {rule} and others

Version stamp
  .harness-version: version line {CURRENT} -> {TARGET}
```

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
apply its `source` rather than recomputing a path.

Two kinds of entry are not plain copies:

**Anything marked `merge: true`** (the config class): add what the target
introduced and keep everything the project added. Never drop a key the
project has and the target does not. `.claude/settings.json` is the usual
case, but `.github/dependabot.yml`, `railway.json` and `.env.example` are
the same: a project that added an ecosystem, a deploy setting or a variable
loses it if you copy over the file.

**`CLAUDE.md`**: never overwrite. Compare against the target's
`claude-md-snippet.md` and *suggest* additions for the user to apply.

Everything else in the plan is a straight copy of the target's content.

### 8. Update the version stamp

Rewrite **only** the `version:` line of `.harness-version`:

```
version: {TARGET}
```

Never replace the file wholesale. It carries fields this upgrade knows
nothing about (the check command, reviewers, anything the project added),
and they must all survive.

### 9. Offer to route an oversized CLAUDE.md

Count the lines in the project's `CLAUDE.md`. If it exceeds **500 lines**,
it has almost certainly accumulated catalog content that is being paid for
on every session. Offer the extraction:

```
CLAUDE.md is {N} lines.

CLAUDE.md loads on every session. Under the harness docs standard it is a
router with a ~300-line budget: conventions, one-way decisions, definition
of done, don't-touch list, writing rules, and a map of which doc to read.

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

### 10. Summarize

Report, in this order:

- **Breaking items still outstanding**, repeated from the narrative. This
  is the last chance the user has to see them, and copying files did not
  perform them.
- **Applied**: files updated, created and removed.
- **Left alone**: write-once files already present, and refused paths.
- **Manual review**: the settings merge, and any `CLAUDE.md` suggestions.

Then remind the user to review `git diff`, check that workflows and hooks
still run, and commit when satisfied.

Finally, remove the temporary clones:

```bash
rm -rf "$WORK"
```
