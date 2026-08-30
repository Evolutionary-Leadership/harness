#!/usr/bin/env bash
# Read the coordination branch, and choose the next free ADR number.
#
# ADR 0014: the coordination branch carries only what exists nowhere else.
# ADR 0015: an ADR number is claimed here before the file is written, and
# the candidate is always max(numbers on preprod, numbers claimed) + 1, which
# keeps preprod the source of truth and this branch a cache over it.
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

case "${1-}" in
  next-adr)            shift; cmd_next_adr "$@" ;;
  fetch)               shift; cmd_fetch "$@" ;;
  list)                shift; cmd_list "$@" ;;
  adr-numbers-on-preprod)  shift; cmd_adr_numbers_on_preprod "$@" ;;
  -h|--help|help|"")   usage; exit 2 ;;
  *)                   echo "unknown command: $1" >&2; usage; exit 2 ;;
esac
