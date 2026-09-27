# Release: pushing the release commit (step 9)

Read this from `/release` step 9 on every release. It builds the release
commit, checks authority a second time, pushes, and says what to do when a
push is refused. Two different things can refuse it, and they get different
answers.

## What the commit carries

Always `.release-description.md` (step 8). Also `release-notes/<version>.md`
whenever step 7b ran (the release fails without it), and `CHANGELOG.md` when
step 7 composed one. The message is `chore: release $NEW_VERSION`. **Never
push `VERSION` from here.** `release.yml` writes it, the migration and the
changelog stamp in one commit, from the version in the signal file. Pushing it
here as well would give one number two owners, which is the failure that rule
exists to prevent.

## Verify authority, then build the commit

    bash .claude/scripts/release-authority.sh verify

It exits 0 only when `## Authority`'s `check` passed earlier in this clone.
On exit 1, stand down (`reason: authority-not-granted`) without building
anything. The settings rule below pre-approves the push itself, so this line
is the gate that stops a session with no authority.

Build the commit in a throwaway worktree on `origin/preprod`, so the
session's branch and working tree never change:

    WT=$(mktemp -d) && git worktree add --detach "$WT" origin/preprod
    (cd "$WT" && <write the files above> && git add -A && git commit -q -m "chore: release $NEW_VERSION")

## Try the direct path first, with a dry run

Run each push **as its own command**, never chained with `&&` or `;`, with
the worktree's path in place of `"$WT"`:

    git -C "$WT" push --dry-run origin HEAD:refs/heads/preprod

**On success, push for real:** `git -C "$WT" push origin HEAD:refs/heads/preprod`.

The shipped `.claude/settings.json` pre-approves exactly these two commands in
`permissions.allow`:

    Bash(git -C * push --dry-run origin HEAD:refs/heads/preprod)
    Bash(git -C * push origin HEAD:refs/heads/preprod)

That is the bridge between the harness's authority forms and the Claude Code
permission layer, which knows nothing about them. A rule matches each
subcommand of a chain separately, so a push chained onto anything else is
no longer the command the rule names. A rule's `*` would also match git
options in front of `push`; the shipped `release-push-gate.sh` hook blocks
every command the rules match unless it is exactly the one above, with a
plain worktree path, under a stamp that `verify` accepts.

## When a push is refused, find out which layer refused it

| Refused by | How it shows | Do |
|---|---|---|
| **The git remote** | The command ran and git printed a rejection (in the sandbox, the proxy's HTTP 403) | Take the API route below |
| **The Claude Code permission layer** | The command never ran: the tool call came back denied (in auto mode, a classifier reason such as "CI Bypass") | Stand down, as below. Never take the API route |
| **The harness's gate hook** | The command never ran, and the refusal starts `release-push-gate:` | If it names the command's shape, run the push exactly as above, alone. If it says no check passed, stand down: `verify` is the gate |

**On a remote refusal, push through the GitHub API instead.** In the harness
sandbox, `origin` is a local git proxy that allows pushes only to the
session's own `claude/<branch>`; a push to `preprod` is rejected with HTTP
403, and the dry run learns that before anything is sent. Call
`mcp__github__push_files` with `owner` and `repo` from step 1, `branch`
`preprod`, the message above, and `files` holding the same paths and
contents; it creates a single commit on `origin/preprod` and modifies nothing
locally. The shipped PreToolUse hook `release-push-gate.sh` pre-approves
exactly this call while the authority stamp is present: `branch` `preprod`,
`.release-description.md` among the files, and nothing but it,
`CHANGELOG.md` and `release-notes/*.md`. If the call returns an error, surface
it and stop; the direct push was refused already, so there is nothing to
retry.

**On a permission-layer refusal, stand down; do not route around it.** A
refusal of the push, or of the `mcp__github__push_files` call, is a decision
about this action. Reaching the same outcome by the other route is the same
act. Emit the stand-down block (`getting-started`, Step 3c) with
`reason: authority-not-granted`, a `done:` naming what did land (the merge to
`preprod`, where step 5 ran), and the `unblock:` for the route that was
refused. The git push:

    unblock: add `Bash(git -C * push origin HEAD:refs/heads/preprod)` (and its
      `--dry-run` twin) to `permissions.allow` in `.claude/settings.json`, which
      `/harness-upgrade` brings from the template; or a person types `/release`

The `mcp__github__push_files` call, where no settings rule applies (the hook
is the bridge there, and it already had its say):

    unblock: a person types `/release` in this session

The authority check passed, so the harness allowed the release. The
permission layer is a separate check, and this stand-down names the rule that
bridges the two.

## Afterwards

Whichever path pushed, and on a stand-down too, spend the stamp, remove the worktree, then fetch so the new
commit is visible:

    bash .claude/scripts/release-authority.sh consume
    git worktree remove --force "$WT"
    git fetch origin preprod
    git log origin/preprod -1 --oneline

The latest commit should be `chore: release $NEW_VERSION`. **Remember which
path took the push**; step 10 reports it.
