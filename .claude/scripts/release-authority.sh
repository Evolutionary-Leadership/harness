#!/usr/bin/env bash
# The release authority check, made mechanical. `/release`'s `## Authority`
# names three forms and nothing else; this script is the gate that refuses a
# session holding none of them, because once `.claude/settings.json`
# pre-approves the release push to `preprod`, the Claude Code permission layer
# no longer does. The permission layer and these forms are separate checks:
# the settings rule bridges the first so the second is the one that decides.
#
# Usage:
#   release-authority.sh check [--context=<feature context>] [--asked=<the user's words>]
#   release-authority.sh verify
#   release-authority.sh consume
#
# check    Exit 0 when a form holds, printing `release-authority: <form>`,
#          tried in this order:
#            grant  `release` is in `agent-authority:` in .harness-version
#            ship   the feature context, as committed at HEAD, carries the
#                   line `Invoked with: ... --ship ...` under `## Autonomy
#                   granted`, which `/feature` phase 0 writes under the flag
#                   (a resumed session rewrites it)
#            asked  --asked carries the user's words from this turn, recorded
#                   on one line
#          `grant` is read from a file the owner commits; `ship` and `asked`
#          are what the session recorded, so they stop a session releasing by
#          mistake, not one set on lying to itself.
#          On success it stamps the session (a file inside the git dir, never
#          committed or pushed) and, with --context, records the form in the
#          feature context under `## Release authority`. Exit 1 when no form
#          holds: nothing is stamped, and the caller stands down with
#          `reason: authority-not-granted`.
# verify   Exit 0, printing the stamped form, when `check` passed in this
#          clone, on this branch, within the last six hours; exit 1 otherwise. `/release` step 9 runs it before any
#          push, and the push_files hook reads the same stamp.
# consume  Remove the stamp. Step 9 runs it once the release commit landed,
#          so one check authorizes one release push.
set -uo pipefail

stamp_path() {
  local dir
  dir=$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null) ||
    dir=$(cd "$(git rev-parse --git-common-dir 2>/dev/null || echo .git)" 2>/dev/null && pwd) ||
    return 1
  printf '%s/harness-release-authority\n' "$dir"
}

record_in_context() {
  local context=$1 line=$2 tmp
  [ -f "$context" ] || return 0
  tmp=$(mktemp)
  # Drop any earlier `## Release authority` section, then append the new one,
  # so the file carries one current record rather than a log.
  RECORD_LINE=$line awk '
    /^## Release authority[[:space:]]*$/ { skip = 1; next }
    skip && /^## / { skip = 0 }
    !skip { out[++n] = $0 }
    END {
      while (n > 0 && out[n] ~ /^[[:space:]]*$/) n--
      for (i = 1; i <= n; i++) print out[i]
      print ""
      print "## Release authority"
      print ""
      print ENVIRON["RECORD_LINE"]
    }
  ' "$context" > "$tmp"
  mv "$tmp" "$context"
}

cmd=${1:-}
[ $# -gt 0 ] && shift
CONTEXT=""
ASKED=""
for arg in "$@"; do
  case "$arg" in
    --context=*) CONTEXT=${arg#--context=} ;;
    --asked=*) ASKED=$(printf '%s' "${arg#--asked=}" | tr '\r\n' '  ') ;;
    *) echo "release-authority: unknown argument: $arg" >&2; exit 64 ;;
  esac
done

STAMP=$(stamp_path) || { echo "release-authority: not inside a git repository" >&2; exit 1; }

case "$cmd" in
  check)
    FORM=""
    DETAIL=""
    AUTHORITY=""
    [ -f .harness-version ] && AUTHORITY=$(sed -n 's/^agent-authority: *//p' .harness-version | tail -1)
    if printf '%s' "$AUTHORITY" | tr ',' ' ' | tr -s '[:space:]' '\n' | grep -qx 'release'; then
      FORM=grant
      DETAIL="agent-authority: $AUTHORITY"
    fi
    if [ -z "$FORM" ] && [ -n "$CONTEXT" ]; then
      REL=${CONTEXT#"$(git rev-parse --show-toplevel 2>/dev/null)"/}
      REL=${REL#./}
      if git show "HEAD:$REL" 2>/dev/null |
        awk '/^## /{ in_autonomy = ($0 ~ /^## Autonomy granted[[:space:]]*$/) } in_autonomy' |
        grep -Eq '^Invoked with:.*(^|[[:space:]])--ship([[:space:]]|$)'; then
        FORM=ship
        DETAIL="--ship in the /feature invocation, committed in $REL"
      fi
    fi
    if [ -z "$FORM" ] && [ -n "$(printf '%s' "$ASKED" | tr -d '[:space:]')" ]; then
      FORM=asked
      DETAIL="the user asked in the turn: \"$ASKED\""
    fi
    if [ -z "$FORM" ]; then
      echo "release-authority: none of the three forms holds (no \`agent-authority: release\`, no committed \`Invoked with: --ship\` in the feature context, no user ask in this turn)" >&2
      rm -f "$STAMP"
      exit 1
    fi
    AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
    printf 'form=%s\nat=%s\nepoch=%s\nbranch=%s\ndetail=%s\n' \
      "$FORM" "$AT" "$(date -u +%s)" "$(git branch --show-current 2>/dev/null)" "$DETAIL" > "$STAMP"
    [ -n "$CONTEXT" ] && record_in_context "$CONTEXT" "Release authority: $FORM ($DETAIL; checked $AT)"
    echo "release-authority: $FORM"
    ;;
  verify)
    if [ -f "$STAMP" ]; then
      FORM=$(sed -n 's/^form=//p' "$STAMP")
      EPOCH=$(sed -n 's/^epoch=//p' "$STAMP")
      STAMPED_BRANCH=$(sed -n 's/^branch=//p' "$STAMP")
      case "$EPOCH" in ''|*[!0-9]*) EPOCH=0 ;; esac
      AGE=$(( $(date -u +%s) - EPOCH ))
      if [ -n "$FORM" ] && [ "$AGE" -ge 0 ] && [ "$AGE" -le 21600 ] &&
        [ "$STAMPED_BRANCH" = "$(git branch --show-current 2>/dev/null)" ]; then
        echo "release-authority: $FORM"
        exit 0
      fi
    fi
    echo "release-authority: no authority check passed in this clone; run \`release-authority.sh check\` (the \`## Authority\` step) first" >&2
    exit 1
    ;;
  consume)
    rm -f "$STAMP"
    ;;
  *)
    echo "usage: release-authority.sh check [--context=<file>] [--asked=<words>] | verify | consume" >&2
    exit 64
    ;;
esac
