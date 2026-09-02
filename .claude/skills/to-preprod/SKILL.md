---
name: to-preprod
description: Merge the current feature branch into preprod, the gate before production. Use when the user says "merge to preprod", "ship it to the gate", or invokes /to-preprod.
disable-model-invocation: true
argument-hint: "[optional: PR title]"
allowed-tools: Bash(git *), Read, Write, Glob, Grep
---

# To preprod

Take the current feature through the gate. `preprod` is the branch between
feature branches and production (ADR 0021): a feature that has been built
and tested waits there until a release promotes it to `main`.

This skill does not merge anything itself. It writes the `.pr-description.md`
signal file, commits it, and pushes; the GitHub Action picks the signal up and
handles PR creation and auto-merge.

It is also how a `/review` PR lands after humans approve it. The workflow
reuses the open PR instead of opening a second one, so run `/to-preprod`
rather than clicking the GitHub merge button.

## The closing block

Every reply carries one, per the contract in `getting-started`. Here it
carries the merge:

- `Good to know`: what the signal push set in motion on the remote (the PR
  the Action opens, the auto-merge, the branch deletions that follow), and
  the docs audit result.
- `Act later`: anything this merge deliberately left undone, naming where it
  should be done.
- `Act next`: what the user must watch or do now, and plainly whether this
  session is finished with them. If the workflow is still running, say that
  is what `Act next` is waiting on.

Run inside `/feature` phase 5, this skill contributes those items into that
skill's block rather than emitting a second one.

## Steps

### 1. Determine the feature name

    BRANCH=$(git branch --show-current)
    FEATURE_NAME=$(bash .claude/scripts/resolve-feature-name.sh "$BRANCH")
    FEATURE_BRANCH="feature/$FEATURE_NAME"

This prefers the slug in `.harness-feature` (set via `set-feature-name.sh`)
and falls back to the random session codename, matching the workflows.

### 2. Gather all changes and sync with preprod

Fetch and diff against preprod to understand what is going through the gate:

    git fetch origin preprod
    git log origin/preprod..HEAD --oneline
    git diff origin/preprod..HEAD --stat

Also check if a `feature/<name>` branch exists and include its commits:

    git fetch origin feature/<name> 2>/dev/null
    git log origin/preprod..origin/feature/<name> --oneline 2>/dev/null

Review ALL changes (not just the latest commit) to write an accurate PR
description.

**Pre-empt merge conflicts with preprod.** The workflow merges this branch
into `preprod` through the PR; if `preprod` has advanced in a conflicting way,
the PR cannot merge and the workflow leaves it open. Merge `preprod` into the
current branch now so any conflict surfaces here, where you can resolve it,
instead of stalling the PR:

    git merge origin/preprod --no-edit

If the merge succeeds cleanly, continue. If it reports conflicts, resolve
them with the discipline below rather than aborting.

#### Resolving conflicts

This section is the harness's one home for merge-conflict discipline;
`/feature` phase 0 and `/continue` point here when their resume merges
conflict.

1. **See the state.** List the conflicted files
   (`git diff --name-only --diff-filter=U`), and read the surrounding
   history so you know what each side was doing.
2. **Find the primary sources for each conflict.** Understand why each
   side changed: read the commit messages, the PRs, and the originating
   spec or ticket issues (per `docs/agents/issue-tracker.md`). Do not
   resolve a hunk whose intent you have not established.
3. **Resolve each hunk.** Preserve both intents where possible. Where
   they are incompatible, pick the side matching this merge's stated goal
   and note the trade-off. Do not invent new behaviour in a resolution.
   For generated, lock, or signal files, prefer the `preprod` version. Always
   resolve; never `--abort`.
4. **Run the checks.** Run the `check:` command from `.harness-version`
   (or the project's typecheck and tests) and fix anything the merge
   broke.
5. **Finish.** Stage everything and complete the merge:

       git add -A
       git commit --no-edit

After resolving, remember what you changed: in your final message to the
user note which files conflicted and how you resolved each one. A clean
merge needs no mention. If a conflict is genuinely ambiguous and you
cannot resolve it safely (two incompatible intents in the same hunk),
stop and ask the user instead of guessing.

**Sweep leaked feature contexts.** If the merge from preprod brought in any
`.harness/feature-context/*.md` for *other* features (leaked past a merge
that bypassed this skill and the cleanup workflow), delete them now; the
deletion rides along with this merge.

### 3. Run docs-updater agent

Before writing the PR description, launch the docs-updater agent so the
documentation lands in the same merge as the code. Use the Agent tool:

    Launch the docs-updater agent with prompt:
    "Delta audit for a merge to preprod. Base is origin/preprod.
     Read docs/README.md as the manifest and route every finding through it.
     Enforce architecture `sources:` globs against the changed paths, verify
     surface-table counts, treat docs/decisions/ as append-only, and flag any
     doc over its budget instead of adding prose. Run
     scripts/check-docs.mjs if it exists."

Wait for the agent to complete. If it committed documentation changes, those
changes will be included in the merge automatically.

Act on the two parts of its report that are not self-resolving:

- **Checker errors**: fix them now. If `node scripts/check-docs.mjs` is in
  the `check:` line of `.harness-version`, they will fail the merge gate
  anyway; fixing them here saves a round trip.
- **"Needs you"**: a suggested ADR, an over-budget doc, or a conflict it
  could not resolve. Handle it, or carry it into the PR description under a
  **Docs** heading so it is visible after the merge. Do not drop it silently.

### 4. Consume and retire the feature context

Read `.harness/feature-context/$FEATURE_NAME.md` (contract in
`.claude/HARNESS.md`) if it exists. It is the input for the PR
description: the decisions, rejections, and scope boundary it records
belong in the body below, and the docs audit above should have promoted
anything permanent into `docs/`.

Then delete it, in its own commit:

    git rm .harness/feature-context/"$FEATURE_NAME".md
    git commit -m "chore: retire feature context for $FEATURE_NAME"

The context lives only while the feature is in flight; it never passes the
gate. (If someone merges around this skill, the cleanup workflow removes the
leftover from `preprod`.)

### 5. Write `.pr-description.md`

Create `.pr-description.md` at the repo root. If `$ARGUMENTS` is provided, use
it as the PR title. Otherwise, generate a concise title from the changes.

Format:

    ---
    title: Short PR title (under 70 characters)
    ---

    ## Summary
    - 3-5 bullet points explaining what changed and why

    ## Spec
    - Link to the spec issue on the tracker, if the feature has one

    ## Code review findings
    - The /code-review findings summary from the end of /feature phase 4,
      including anything deliberately not addressed and why. Omit only if
      /code-review never ran (e.g. quick mode on a trivial change).

    ## What's new
    - User-facing changes described in plain language

    ## Technical changes
    - Key implementation details, files changed, architectural decisions

    ## How to test
    - Steps to verify the feature works correctly

### 6. Commit and push

Push any pending feature work **first**, so the whole branch (including the
conflict resolution from step 2 and the context retirement from step 4) is
on the remote before the signal file triggers the workflow:

    git push -u origin <current-branch>

Then add the signal file as its own commit and push it. `.pr-description.md`
is in `.gitignore` (it is a signal file, and no signal file may pass the gate),
so the `-f` flag is required to stage it on the `claude/` branch:

    git add -f .pr-description.md
    git commit -m "chore: trigger auto-merge to preprod"
    git push -u origin <current-branch>

### 7. Inform the user

Tell the user:
- The auto-merge has been triggered
- The GitHub Action will create a PR from `feature/<name>` to `preprod` and
  merge it (or reuse and merge the open `/review` PR, if one exists)
- Any conflicts with `preprod` were already resolved locally in step 2; report
  which files conflicted and how you resolved them. The PR should now merge
  cleanly. (If the workflow still cannot merge, it leaves a comment on the PR
  with manual resolution steps.)
- The feature branch will be cleaned up automatically
- They can stay in this chat and chain `/release` once the merge lands. The
  release skill works on `preprod` and never re-pushes the `claude/` branch, so
  it will not re-trigger feature branch creation.
- Next time, `/release` on its own would have done both: run from an
  unmerged `claude/` branch it asks one confirmation, follows this
  procedure, waits for `preprod` to settle, and then ships. Mention it once,
  as an option; it is a bigger act than a merge and stays the user's call.

### 8. If the workflow fails

If the GitHub Actions run for this push fails, the recovery path depends on
where it broke. Open the Actions tab in GitHub and find the run titled
"Merge feature branch to preprod (to-preprod)" triggered by the `claude/<branch>`
push.

Common failure modes:

- **Workflow run failed mid-step** (e.g. a transient git push race): re-push
  the local `claude/` branch with `git push -u origin <branch>`. If the remote
  `claude/` branch was already deleted by `claude-to-feature-branch.yml`, the
  push creates a fresh branch and retriggers the chain. The workflow is
  idempotent, so re-runs do not duplicate commits or work.
- **PR opened but could not auto-merge** (conflicts with preprod): the workflow
  leaves a comment on the PR with manual resolution steps. Check out
  `feature/<name>` locally, merge `preprod` into it, resolve the conflicts using
  the discipline in step 2, push, and merge the PR by hand.
- **PR did not open at all**: the workflow errored before PR creation. Read
  the failed step's logs in the Actions tab. Most common cause: a missing or
  empty `PAT_TOKEN` secret. The workflow now fails fast with an explicit
  `::error::PAT_TOKEN is missing or empty...` annotation pointing at
  Settings → Secrets and variables → Actions; the PAT needs `repo` and
  `workflow` scopes (or fine-grained equivalent: Contents r/w, Pull
  requests r/w, Workflows r/w). Other causes: branch protection on `preprod`
  that requires explicit reviewers. **Recovery when `PAT_TOKEN` was
  missing**: add the secret, then re-push the `claude/` branch
  (`git push -u origin <branch>`) to retrigger. Because cleanup now runs
  *after* PR creation, the signal file is still on `feature/<name>` and
  the rerun picks up cleanly.

Do not confuse the recovery push above with the gotcha already documented in
`CLAUDE.md`: after a successful merge, both the `claude/` and `feature/`
branches are deleted remotely, and pushing again re-creates everything from
scratch. That warning applies to post-success pushes, not to recovery from a
failed workflow run.

### 9. Update memory files if warranted

If the session revealed broadly useful lessons (new conventions, gotchas, etc.),
update CLAUDE.md. Do NOT add feature-specific WIP notes.
