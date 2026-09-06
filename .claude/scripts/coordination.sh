#!/usr/bin/env bash
# Read the coordination branch, and choose the next free ADR number.
#
# The coordination branch carries only what exists nowhere else (forge
# decision record 0014). An ADR number is claimed here before the file is
# written, and the candidate is always max(numbers on preprod, numbers
# claimed) + 1, which keeps preprod the source of truth and this branch a
# cache over it (forge decision record 0015). Both ids are spelled out
# because this file lands in a downstream scaffold, where a bare `ADR 0014`
# would name that project's own record and not this one.
#
# This script only READS. Writing a claim needs the GitHub contents API,
# whose per-path SHA check is the compare-and-swap, and a shell script
# cannot call MCP. Web sessions also get a 403 from the git proxy on any
# push outside their own claude/<branch>. So: the script reads, the skill
# writes.
#
# Every subcommand is best-effort. A missing branch, a missing remote or a
# dead network prints nothing and exits 0. Reading a coordination register
# must never stall a session; the hard guarantee lives in check-docs.mjs.
#
# Nothing here checks out a branch, creates a worktree, or touches the
# index. A session must stay exactly where it was.
set -uo pipefail

BRANCH="${COORDINATION_BRANCH:-coordination}"
REMOTE="${COORDINATION_REMOTE:-origin}"

usage() {
  cat >&2 <<'USAGE'
usage: coordination.sh <command> [args]

  next-adr <on-preprod> <claimed>
                            Print max(on-preprod, claimed) + 1, zero-padded
                            to four digits. Both arguments are lists of
                            numbers separated by whitespace. Pure: no
                            network, no git, no filesystem.

  fetch                     Fetch the coordination ref. Silent, never fatal.

  list <namespace>          Print the claimed tokens in claims/<namespace>,
                            one per line, sorted. Empty when the branch,
                            the namespace or the remote is absent.

  adr-numbers-on-preprod    Print the ADR numbers present on preprod, one per
                            line. Falls back to the local working tree
                            when preprod cannot be read.

  features                  Print the slugs of the features that have
                            declared a touched set, one per line, sorted.
                            Empty when the branch, the namespace or the
                            remote is absent.

  feature <slug>            Print one feature's touched-set record. Empty
                            when that feature has declared none.

  feature-branches          Print the feature/* branches that exist on the
                            remote, one per line. The staleness rule reads
                            it, so an empty answer means "could not read"
                            and never "nothing is live".
USAGE
}

# Keep only well-formed four-digit tokens, de-duplicated and sorted. Anything
# else in the input (TEMPLATE, README, a stray path) is not a number and must
# not influence the maximum.
normalise() {
  tr -cs '0-9' '\n' | grep -E '^[0-9]{4}$' || true
}

cmd_next_adr() {
  local on_preprod="${1-}" claimed="${2-}" highest
  highest=$(
    { printf '%s\n%s\n' "$on_preprod" "$claimed" | normalise; printf '0000\n'; } \
      | sort -n | tail -1
  )
  printf '%04d\n' "$((10#$highest + 1))"
}

cmd_fetch() {
  git fetch --quiet "$REMOTE" "$BRANCH" 2>/dev/null || return 0
}

cmd_list() {
  local ns="${1-}"
  [ -n "$ns" ] || { usage; return 2; }
  cmd_fetch
  git ls-tree -r --name-only "$REMOTE/$BRANCH" "claims/$ns/" 2>/dev/null \
    | sed -n 's|^claims/'"$ns"'/\(.*\)\.md$|\1|p' \
    | grep -v '^README$' \
    | sort || true
}

cmd_adr_numbers_on_preprod() {
  local listing
  git fetch --quiet "$REMOTE" preprod 2>/dev/null || true
  listing=$(git ls-tree -r --name-only "$REMOTE/preprod" docs/decisions/ 2>/dev/null || true)
  # No readable preprod (offline, fresh clone, no remote): the local tree is the
  # best view available, and a too-low answer is caught by the CI checker.
  [ -n "$listing" ] || listing=$(ls docs/decisions/ 2>/dev/null || true)
  printf '%s\n' "$listing" | sed -n 's|.*/\{0,1\}\([0-9]\{4\}\)-.*|\1|p' | sort -u
}

# The features/ namespace: one record per in-flight feature, named by the
# feature slug, holding what that branch declares it will touch. One file per
# slug means one writer per file, so nothing here needs a compare-and-swap;
# only claims/ does. Reading it is best-effort like every other read here.
cmd_features() {
  cmd_fetch
  git ls-tree -r --name-only "$REMOTE/$BRANCH" "features/" 2>/dev/null \
    | sed -n 's|^features/\(.*\)\.md$|\1|p' \
    | grep -v '^README$' \
    | sort || true
}

cmd_feature() {
  local slug="${1-}"
  [ -n "$slug" ] || { usage; return 2; }
  cmd_fetch
  git show "$REMOTE/$BRANCH:features/$slug.md" 2>/dev/null || true
}

# Which feature branches are alive. A touched-set record whose branch is gone
# from the remote has no writer left, so any reader may sweep it; that is the
# same rule claims/adr uses before it releases a number. Printing nothing on a
# failed read is what keeps the sweep from mistaking an outage for a merge.
cmd_feature_branches() {
  git ls-remote --heads "$REMOTE" 'refs/heads/feature/*' 2>/dev/null \
    | sed -n 's|.*refs/heads/\(feature/.*\)$|\1|p' \
    | sort || true
}

case "${1-}" in
  next-adr)            shift; cmd_next_adr "$@" ;;
  fetch)               shift; cmd_fetch "$@" ;;
  list)                shift; cmd_list "$@" ;;
  adr-numbers-on-preprod)  shift; cmd_adr_numbers_on_preprod "$@" ;;
  features)            shift; cmd_features "$@" ;;
  feature)             shift; cmd_feature "$@" ;;
  feature-branches)    shift; cmd_feature_branches "$@" ;;
  -h|--help|help|"")   usage; exit 2 ;;
  *)                   echo "unknown command: $1" >&2; usage; exit 2 ;;
esac
