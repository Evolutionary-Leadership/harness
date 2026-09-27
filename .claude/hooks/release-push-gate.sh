#!/usr/bin/env bash
set -uo pipefail

# PreToolUse hook (Bash, and the GitHub MCP write matcher): the harness half of
# the bridge between `/release`'s authority and the Claude Code permission
# layer (release/SKILL.md, "## Authority"; release/PUSH.md).
#
# Bash. `permissions.allow` pre-approves `git -C * push [--dry-run] origin
# HEAD:refs/heads/preprod`, and a permission `*` matches any run of
# characters, git options included. So every command piece that rule would
# match is checked here, and BLOCKED (exit 2) unless it is exactly
#   git -C <one plain path> push [--dry-run] origin HEAD:refs/heads/preprod
# and `release-authority.sh verify` passes. A piece the rule would not match
# is none of this hook's business.
#
# mcp__github__push_files. Never a `permissions.allow` entry, since it can
# write any branch of any repository the token reaches. This hook prints an
# `allow` decision only for the release commit: `branch` `preprod`, `owner`
# and `repo` naming this clone's `origin`, files `.release-description.md`
# plus at most `CHANGELOG.md` and `release-notes/<name>.md`, and a passing
# `release-authority.sh verify`. Anything else: exit 0 with no output, so the
# normal permission flow decides.

INPUT=$(cat)

TOOL=$(printf '%s' "$INPUT" | jq -r '.tool_name // empty' 2>/dev/null)
ROOT=$(printf '%s' "$INPUT" | jq -r '.cwd // empty' 2>/dev/null)
[ -n "$ROOT" ] || ROOT=$PWD
SCRIPT="$ROOT/.claude/scripts/release-authority.sh"

authorized() {
  [ -f "$SCRIPT" ] && (cd "$ROOT" && bash "$SCRIPT" verify >/dev/null 2>&1)
}

case "$TOOL" in
  Bash)
    COMMAND=$(printf '%s' "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)
    [ -n "$COMMAND" ] || exit 0
    # One piece per simple command, split where Claude Code splits a chain.
    PIECES=$COMMAND
    for sep in '&&' '||' ';' '|'; do PIECES=${PIECES//"$sep"/$'\n'}; done
    # Loose on purpose: a leading subshell, env assignments or trailing
    # parentheses must not carry a looser command past this check.
    LOOSE='^[[:space:](]*([A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*[[:space:]]+)*git[[:space:]]+-C[[:space:]].*[[:space:]]push[[:space:]].*origin[[:space:]]+HEAD:refs/heads/preprod[[:space:])]*$'
    PATHTOKEN='("[A-Za-z0-9._/~+@=-]+"|"[$][A-Za-z_][A-Za-z0-9_]*"|[A-Za-z0-9._/~+@=-]+)'
    STRICT="^[[:space:]]*git -C ${PATHTOKEN} push( --dry-run)? origin HEAD:refs/heads/preprod[[:space:]]*$"
    while IFS= read -r piece; do
      printf '%s\n' "$piece" | grep -Eq "$LOOSE" || continue
      if ! printf '%s\n' "$piece" | grep -Eq "$STRICT"; then
        echo "release-push-gate: only 'git -C <worktree> push [--dry-run] origin HEAD:refs/heads/preprod', run as its own command, may push /release's commit to preprod" >&2
        exit 2
      fi
      if ! authorized; then
        echo "release-push-gate: no release authority check passed in this clone; run release-authority.sh check (/release, ## Authority) or stand down" >&2
        exit 2
      fi
    done <<< "$PIECES"
    exit 0
    ;;
  mcp__github__push_files) ;;
  *) exit 0 ;;
esac

BRANCH=$(printf '%s' "$INPUT" | jq -r '.tool_input.branch // empty' 2>/dev/null)
BRANCH=${BRANCH#refs/heads/}
[ "$BRANCH" = preprod ] || exit 0

OWNER=$(printf '%s' "$INPUT" | jq -r '.tool_input.owner // empty' 2>/dev/null)
REPO=$(printf '%s' "$INPUT" | jq -r '.tool_input.repo // empty' 2>/dev/null)
ORIGIN=$(git -C "$ROOT" config --get remote.origin.url 2>/dev/null)
ORIGIN=${ORIGIN%.git}
ORIGIN_REPO=${ORIGIN##*/}
ORIGIN_OWNER=${ORIGIN%/*}
ORIGIN_OWNER=${ORIGIN_OWNER##*[/:]}
lower() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]'; }
[ -n "$OWNER" ] && [ "$(lower "$OWNER")" = "$(lower "$ORIGIN_OWNER")" ] || exit 0
[ -n "$REPO" ] && [ "$(lower "$REPO")" = "$(lower "$ORIGIN_REPO")" ] || exit 0

PATHS=$(printf '%s' "$INPUT" | jq -r '.tool_input.files[]?.path // empty' 2>/dev/null) || exit 0
[ -n "$PATHS" ] || exit 0
has_signal=no
while IFS= read -r path; do
  case "$path" in
    .release-description.md) has_signal=yes ;;
    CHANGELOG.md) ;;
    release-notes/*/*) exit 0 ;;
    release-notes/*.md) ;;
    *) exit 0 ;;
  esac
done <<< "$PATHS"
[ "$has_signal" = yes ] || exit 0

authorized || exit 0

printf '%s\n' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow","permissionDecisionReason":"release-push-gate: the release commit to preprod, under a passed release-authority check"}}'
