---
name: harness-upgrade
description: Upgrade harness infrastructure (workflows, skills, hooks, settings, traits) to the latest version using migration-aware filtering.
disable-model-invocation: true
argument-hint: "[optional: target version, e.g. 0.3.0]"
---

# Upgrade Harness

Upgrade the project's harness infrastructure and stack traits to a target
version from the upstream harness repo. Uses structured migration files to
understand what changed, filter by relevance, and present a smart upgrade plan.

## Steps

### 1. Read current version info

Read `.harness-version` in the project root:

```
harness: harness-railway
version: 0.3.35
repo: evolutionary-leadership/harness-forge
companion_url: https://your-companion-site.up.railway.app
traits: nodejs, typescript, express, vitest, eslint, pnpm
```

Extract five values:
- `VARIANT`: the harness variant (`harness-plain` or `harness-railway`)
- `CURRENT_VERSION`: the currently installed version (semver: `MAJOR.MINOR.PATCH`)
- `REPO`: the GitHub repo (`owner/name`)
- `COMPANION_URL`: the companion site URL for fetching upgrades (may be empty)
- `TRAITS`: comma-separated list of installed trait names (may be empty)

If `.harness-version` is missing, tell the user this project doesn't appear
to be harnessed and stop.

If the `harness:` line says `unconfigured`, this repository was scaffolded
from the template but `/setup` never ran. Tell the user to run `/setup`
first and stop.

If the `repo` field is missing, ask the user for the harness repo
(`owner/name` format) and proceed.

If the `traits` field is missing or empty, note this. You'll show all trait
changes later and suggest the user configure their traits.

### 2. Fetch upgrade data

There are two methods to fetch upgrade data. Try them in order:

#### Method A: Companion site API (preferred)

If `COMPANION_URL` is set (non-empty), fetch the upgrade manifest in a single
request:

```bash
MANIFEST=$(curl -sf "$COMPANION_URL/api/harness/upgrade?from=$CURRENT_VERSION&variant=$VARIANT&traits=$TRAITS")
```

If `$ARGUMENTS` specifies a target version, you'll filter the manifest
response to only include migrations up to that version.

The manifest returns JSON:
```json
{
  "latest_version": "0.2.16",
  "up_to_date": false,
  "migrations": [
    {
      "version": "0.2.2",
      "date": "2026-03-20",
      "summary": "...",
      "changes": [{ "scope": "...", "summary": "...", "affects": {...}, "files": [...] }]
    }
  ],
  "files": {
    "templates/harness/base/workflows/file.yml": "<base64-encoded content>",
    "stacks/traits/runtime/nodejs.md": "<base64-encoded content>"
  }
}
```

If `up_to_date` is true, tell the user they're already up to date and stop.

The `files` map contains base64-encoded content of all relevant files. Decode
them when needed for diffing and applying changes.

If the companion site request succeeds, skip to step 4 (categorize changes).

#### Method B: GitHub API (fallback)

If `COMPANION_URL` is not set, or the companion site request fails, fall back
to the GitHub API:

```bash
LATEST_VERSION=$(curl -sf "https://raw.githubusercontent.com/$REPO/main/VERSION" | tr -d '[:space:]')
```

If `$ARGUMENTS` specifies a target version, use that instead of latest.

Compare `CURRENT_VERSION` with the target version. If they match, tell the
user they're already up to date and stop.

If the target version is older than the current version, warn the user and
stop (downgrades are not supported).

If both methods fail, tell the user:
> Could not reach the harness upgrade server. You can either:
> 1. Set `companion_url` in `.harness-version` to your companion site URL
> 2. Ensure the harness repo (`$REPO`) is accessible on GitHub

### 3. Fetch migration files (GitHub fallback only)

This step only applies when using Method B (GitHub API). When using Method A
(companion site), the migrations are already included in the manifest response.

List all migration files from the upstream repo:

```bash
MIGRATION_FILES=$(curl -sf "https://api.github.com/repos/$REPO/git/trees/main?recursive=1" \
  | jq -r '.tree[] | select(.path | startswith("migrations/") and endswith(".yaml") and (. path != "migrations/README.md")) | .path')
```

Filter to only versions between `CURRENT_VERSION` (exclusive) and the target
version (inclusive) using semver comparison. For each matching migration file,
fetch and parse it:

```bash
curl -sf "https://raw.githubusercontent.com/$REPO/main/migrations/$VERSION.yaml"
```

If no migration files exist for the version range, fall back to the legacy
upgrade method (step 3-legacy below).

### 3-legacy. Fall back: fetch template listing and diff (for pre-migration versions)

If no migration files cover the version range (upgrading from a version
before migrations existed), use the legacy approach:

Fetch the template file listing using the GitHub API:

```bash
curl -sf "https://api.github.com/repos/$REPO/git/trees/main?recursive=1" \
  | jq -r '.tree[] | select(.path | startswith("templates/harness/base/")) | .path'
```

For the `harness-railway` variant, also list
`templates/harness/overlays/railway/`; wherever both layers carry the same
layer-relative path, the overlay file wins.

Map template paths to local paths, fetch each file, diff against local, and
categorize as Infrastructure (replace) / Configuration (merge) / Skills
(replace). Also check for trait files: if `.claude/traits/` exists locally,
diff those against upstream `stacks/traits/`.

**Skip these paths entirely in the legacy diff.** They are starter scaffold
files (write-once) and the legacy upgrade path must never overwrite them:

- `server.js`
- `package.json`
- `.gitignore`
- `docs/**` (the documentation skeleton; create only what is missing)
- `scripts/check-docs.mjs`

Then skip to step 6 (present the upgrade plan in the legacy format).

### 4. Categorize changes by relevance

Collect all `changes` entries from all fetched migration files. For each
entry, determine its relevance to this project:

**MUST APPLY**: changes matching the repo's variant:
- `scope: infrastructure` where `VARIANT` appears in `affects.variants`
- `scope: config` where `VARIANT` appears in `affects.variants`
- `scope: skill` where `VARIANT` appears in `affects.variants` (base
  skills list both variants; overlay skills list `harness-railway` only)
- `scope: docs` where `VARIANT` appears in `affects.variants`

Exception: changes whose files live under `templates/harness/setup/`,
plus the spine script `templates/harness/base/claude/scripts/setup.sh`
(landing at `.claude/scripts/setup.sh`), describe the one-shot `/setup`
skill, its deterministic spine, and the pre-built foundation payload it
materializes. In a configured repository the skill has already run and
deleted itself (taking the quarantine AND the spine with it), and any
materialized foundation files are user-owned application code, so treat
these changes as **INFORMATIONAL** regardless of scope. Never write
`setup/` payload files or `.claude/scripts/setup.sh` into a configured
repository; a restored spine would sit armed in a repo that must never
run it again.

**STARTER (skip-if-exists)**: write-once scaffold files for this variant:
- `scope: starter` where `VARIANT` appears in `affects.variants`
- These are seed files the harness ships as a starting point: the app
  scaffold (`server.js`, `package.json`, `.gitignore`), the documentation
  skeleton (`docs/README.md`, `docs/GLOSSARY.md`, `docs/SECURITY.md`,
  `docs/TESTING.md`, the `TEMPLATE.md` files, the seed ADR), and the docs
  checker (`scripts/check-docs.mjs`). They are created once, never
  overwritten on upgrade, and never recreated if the user has deleted them.
- Treated separately from MUST APPLY: only included in the upgrade plan when
  the local file is missing.
- Skip-if-exists is **per file**, not per directory. A project that already
  has `docs/README.md` but no `docs/SECURITY.md` gets exactly the missing
  file, and its existing content is never touched.

**RECOMMENDED**: trait changes matching the repo's installed traits:
- `scope: trait` where any trait in `affects.traits` appears in the repo's
  `TRAITS` list
- These update `.claude/traits/<name>.md` files

**INFORMATIONAL**: other changes that don't directly apply:
- `scope: trait` or `scope: preset` for traits/presets NOT in the repo's
  `TRAITS` list
- Show briefly so the user is aware of what's new

**SKIP**: changes for other variants:
- `scope: infrastructure` or `scope: config` where `VARIANT` is NOT in
  `affects.variants`
- Do not show these at all

If `TRAITS` is empty (not configured), treat ALL trait changes as
**RECOMMENDED** and inform the user they can configure `traits:` in
`.harness-version` to filter in future upgrades.

### 5. Fetch and diff relevant files

For each **MUST APPLY** change:
- Determine the local file path using these mapping rules. `$LAYER` is
  `templates/harness/base` for every project, plus
  `templates/harness/overlays/railway` for the `harness-railway` variant.
  When both layers ship the same layer-relative path, the overlay file
  wins:

  | Template path prefix | Local destination |
  |---|---|
  | `$LAYER/workflows/` | `.github/workflows/` |
  | `$LAYER/dependabot.yml` | `.github/dependabot.yml` |
  | `$LAYER/claude/` | `.claude/` |
  | `$LAYER/server.js` | `server.js` |
  | `$LAYER/package.json` | `package.json` |
  | `$LAYER/.gitignore` | `.gitignore` |
  | `$LAYER/railway.json` | `railway.json` (overlay only) |
  | `$LAYER/docs/` | `docs/` |
  | `$LAYER/scripts/` | `scripts/` |
  | `$LAYER/.harness-version` | `.harness-version` (keep the local `harness:` line) |
  | `$LAYER/claude-md-snippet.md` | *(reference only; see step 7)* |

- **If using Method A (companion site):** the file content is already in the
  manifest's `files` map (base64-encoded). Decode it and diff against the
  local file.
- **If using Method B (GitHub API):** fetch the upstream file:
  ```bash
  curl -sf "https://raw.githubusercontent.com/$REPO/main/$FILE_PATH"
  ```
  Then diff against the local file.
- If the file has changed across multiple versions in the range, only show
  the final state (diff local vs latest upstream). Note which versions
  contributed changes.

For each **RECOMMENDED** trait change:
- The upstream file is at `stacks/traits/<category>/<name>.md`
- The local file is at `.claude/traits/<name>.md`
- If the local file doesn't exist, it's a new trait to install
- If the local file exists, show the diff
- File content comes from the manifest `files` map (Method A) or GitHub
  raw URL (Method B)

For each **STARTER** change:
- Resolve the local destination from the path-mapping table above
  (`server.js`, `package.json`, `.gitignore`, `docs/**`,
  `scripts/check-docs.mjs`).
- If the local file already exists, **skip this change entirely**: do not
  diff, do not fetch the upstream content, do not include it in the upgrade
  plan. The user has either kept the starter as-is or replaced it with their
  own code; either way the harness must not touch it.
- If the local file is missing, fetch the upstream content (manifest or
  GitHub raw URL) and queue it for creation. Include it in the plan under
  the STARTER section.

For `claude-md-snippet.md`: fetch the upstream version and compare against
the project's `CLAUDE.md`. Note new sections or updates.

### 6. Present the smart upgrade plan

Present a clear, prioritized upgrade plan:

```
━━ Harness upgrade: v{CURRENT} → v{TARGET} ({N} versions) ━━

━━ REQUIRED ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Infrastructure ({VARIANT}):
  • {filename}: {summary} ({version})
    {diff}

Skills:
  • {filename}: {summary} ({version})
    {diff}

Configuration (merge carefully):
  • {filename}: {summary} ({version})
    {diff showing new entries}

━━ RECOMMENDED: Stack best practices ━━━━━━━━━━━━━━━━━━━━━
⚠ Review carefully, may affect existing code patterns

  {trait_name} ({version}):
    {diff of .claude/traits/{name}.md vs upstream}

━━ STARTER: missing scaffold files ━━━━━━━━━━━━━━━━━━━━━━━━
Only shown when a starter file is missing locally. Existing starter files
are never touched. Skip-if-exists is per file, so a partial docs/ tree is
completed rather than replaced.

  • {filename}: would be created from upstream ({version})

━━ INFORMATIONAL ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Also new since {CURRENT}:
  • New trait: {name} ({version})
  • Updated: {name} ({version})

━━ CLAUDE.md ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Suggestions from updated claude-md-snippet.md:
  {changes if any}
Router-ification (only when CLAUDE.md exceeds ~500 lines):
  {catalog sections that would move to docs/architecture/}
```

After presenting the plan, **ask the user for confirmation** before making
any changes. The user may choose to:
- Apply all changes
- Apply selectively (skip specific files or categories)
- Abort entirely

**Do NOT modify any files until the user confirms.**

### 7. Apply approved changes

Once the user approves, apply only the confirmed changes:

**Infrastructure files** (workflows, hooks, scripts): replace with upstream.

**Configuration files** (settings.json): merge new entries into the existing
config. Preserve any user-added hooks or settings. Do not remove entries the
user added.

**Skills**: replace with upstream version.

**Starter files** (`scope: starter`, e.g. `server.js`, `package.json`,
`.gitignore`):
- If the local file does NOT exist, create it from the upstream content.
- If the local file exists, leave it untouched. Do not prompt, do not diff,
  do not overwrite.
- Never delete a starter file, even if it has been removed from the upstream
  template.

**Trait files** (`.claude/traits/<name>.md`):
- If the file exists locally: replace with upstream content from
  `stacks/traits/<category>/<name>.md`
- If the file is new: create `.claude/traits/<name>.md` with upstream content
- To find the upstream path for a trait name, search the GitHub API tree for
  files matching `stacks/traits/*/<name>.md`

**CLAUDE.md**: do NOT overwrite. Only suggest additions for the user to
apply manually. If `.claude/traits/` is newly added, suggest adding this
line to CLAUDE.md:
```
Read `.claude/traits/` for stack-specific best practices before writing code.
```

**CLAUDE.md router-ification** (suggest only, never apply automatically):

Count the lines in the project's `CLAUDE.md`. If it exceeds **500 lines**,
it has almost certainly accumulated catalog content that is being paid for
on every session. Offer the extraction:

```
━━ CLAUDE.md is {N} lines ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CLAUDE.md loads on every session. Under the harness docs standard it is a
router with a ~300-line budget: conventions, one-way decisions, definition
of done, don't-touch list, writing rules, and a map of which doc to read.

Catalog sections I found that belong in docs/architecture/:
  • "{heading}" (lines {a}-{b}) -> docs/architecture/{suggested}.md
    sources: [{globs covering the files that section describes}]

Want me to extract them? Each extracted file gets YAML front-matter with
`sources:` globs, an index row in docs/README.md, and CLAUDE.md keeps a one
line pointer in its map table. Nothing is deleted without a new home.
```

Identify candidate sections by shape, not by topic: a section is a catalog
if it is mostly a table or list enumerating routes, tools, components,
tables, env vars, or files. Conventions, invariants, and rules stay in the
router no matter how long they are.

**Only extract if the user says yes.** When they do:
- create `docs/architecture/<name>.md` with the `sources:` front-matter
- move the content verbatim, do not rewrite it in the same pass
- delete the section from `CLAUDE.md` (one home per fact) and leave a row in
  its map table pointing at the new file
- add the index row to `docs/README.md`
- run `node scripts/check-docs.mjs` and fix what it reports

### 8. Update the version stamp

Update `.harness-version` to reflect the new version, preserving the
existing variant, repo, companion_url, and traits:

```
harness: <VARIANT>
version: <TARGET_VERSION>
repo: <REPO>
companion_url: <COMPANION_URL>
traits: <TRAITS>
```

### 9. Summary

Present a summary organized by category:

- **Required, applied**: infrastructure, skill, and config files updated
- **Starter, created**: missing scaffold files restored from upstream
- **Recommended, applied**: trait files updated
- **Recommended, skipped**: trait changes the user chose not to apply
- **Informational**: other changes in this release
- **Manual review**: CLAUDE.md suggestions or config files where local
  customizations were preserved

Remind the user to:
- Review the changes (`git diff`)
- Test that workflows and hooks still work
- Commit when satisfied
- If traits were updated, review `.claude/traits/` to ensure the new
  practices align with the project's codebase
