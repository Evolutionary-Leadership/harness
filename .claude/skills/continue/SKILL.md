---
name: continue
description: Resume work on an in-progress feature branch. Lists active features with their feature context, lets you pick one, and lands you mid-flow with the reasoning intact.
argument-hint: "[optional: feature name to continue]"
allowed-tools: Bash(git *), Bash(gh *), Read, Glob, Grep
---

# Continue an in-progress feature

List active feature branches, show each one's feature context beside its
git summary, and resume the one the user picks. The feature context (the
committed file `.harness/feature-context/<slug>.md`, contract in
`.claude/HARNESS.md`) is what makes this a real handover: colleague A's
reasoning, not just their commits.

## Steps

### 1. List active feature branches, with their context

    git fetch origin --prune
    git branch -r | grep 'origin/feature/' | sed 's|origin/||'

For each branch, show the git summary:

    for branch in $(git branch -r | grep 'origin/feature/' | sed 's|origin/||'); do
      echo "$branch"
      git log "origin/$branch" -1 --format="  Last commit: %s (%cr)"
    done

    gh pr list --base preprod --state open --json number,title,headRefName --jq '.[] | "  PR #\(.number): \(.title) (\(.headRefName))"'

(Where `gh` is unavailable, list open PRs per the GitHub MCP note in
`docs/agents/issue-tracker.md`.)

A change whose last part already merged has no branch here: its slug was
retired at the merge. Continue it with `/feature`, whose phase 0 section
"Continue a change after its merge" keeps the key and names a new slug.

Then, for each branch, read its feature context without checking anything
out:

    git show "origin/feature/<name>:.harness/feature-context/<name>.md" 2>/dev/null

Show the context's size, phase, next step, and open questions beside the
git summary. A branch without a context file predates the flow or skipped
it; say so rather than guessing at its state.

### 2. Select a feature

If `$ARGUMENTS` is provided, match it against the feature names.
Otherwise, present the list and ask the user which feature to continue.

### 3. Fetch and checkout

    FEATURE="feature/<name>"
    git fetch origin "$FEATURE"
    git checkout -b "claude/<name>-<sessionId>" "origin/$FEATURE"

Where `<sessionId>` is the current session identifier suffix from the
branch name you are on, or a short random suffix.

### 4. Sweep stale contexts

A context file whose feature branch no longer exists on the remote leaked
past a merge that bypassed `/to-preprod` and the cleanup workflow. Delete
any such file under `.harness/feature-context/` in the working tree now
(commit the deletion; it rides along with the next push). This is a
safety net, not the intended path.

### 5. Derive the position, and write it

The touched-set record is the one field a crashed session leaves
wrong, and a resume is the cheapest moment to correct it, so derive the
position from the durable artefacts and WRITE it rather than trusting the
record's own value (`.claude/JOURNEY.md`, "Quick mode and resumption").

Read the work item (titled `<KEY>: ...`, the key being the leading part of
`.harness-feature`) and its size tier from the `## Change key` section, or
from the context's `## Size`. Then the first row that matches, top down:

| Evidence on the work item | Position | Re-enter at |
|---|---|---|
| No work item | fresh feature | `/feature` phase 0 |
| `parked` label | as recorded, parked | nowhere until un-parked |
| S: `## Specification` empty | `captured` | the plan-and-go gate |
| S: `## Specification` holds the paragraph, `## Tickets` empty or absent | `committed` | phase 4 |
| M or L: `## Challenge` empty | `captured` | phase 1 |
| M or L: `## Challenge` has its verdict, `## Specification` empty | `challenged` | the shaping grill (phase 1) |
| M: `## Specification` holds text, `## Tickets` empty | `planned` | the plan gate (tickets missing) |
| L: `## Specification` links a spec issue with no ticket sub-issues | `planned` | phase 3 |
| `## Tickets` has an unticked line (S, M), or an open ticket sub-issue (L) | `building` | phase 4, the frontier |
| Every line ticked (S, M), or every ticket closed (L) | `built` | phase 5 |

Then write it, in one call:

    bash .claude/scripts/journey.sh phase <position> "resumed at <position>"

Nothing follows it: the call commits `.harness/journey/<slug>.md` and
pushes this branch, and `journey-sync.yml` mirrors the record onto
`coordination` and rings the cockpit (`.claude/JOURNEY.md`).

A `## Blocked` section in the context means the last session stood down:
read it first, and clear it (the section, and the `blocked` label on the
work item) only once the block is actually gone. If the context marks the
feature "awaiting human review" (a `/review` PR is open), say so: the
likely work is addressing review comments, and the exit after that is
`/to-preprod` on the same PR.

### 6. Hand over to the feature flow

Delegate to `/feature`'s resume logic (its phase 0): it merges the
feature branch, loads the feature context, and gates at the row's
"re-enter at" before continuing. Do not improvise a separate resume here.

`--quick` and `--ship` are session-scoped: this skill re-arms neither. A
run that was unattended resumes attended unless the user types the flag
again.

### 7. Ready to work

Tell the user:

- You are now on a working branch for this feature
- The size, the position you derived and why, and the recorded next step
- The decisions already settled (so nobody re-litigates them by accident)
- Then confirm the next step before doing it
