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

  adr-collisions [<feature-branch>]
                            Print one line per ADR number this branch adds
                            that is also taken elsewhere: on preprod, on
                            another feature branch, or by another feature's
                            claim. Silent when there is none, and when
                            preprod cannot be read. The branch defaults to
                            this session's feature branch.
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

# Decision records among a list of paths, as "NNNN path" lines.
adr_records() {
  sed -n 's|^\(docs/decisions/\([0-9]\{4\}\)-[^/]*\.md\)$|\2 \1|p'
}

# A duplicated ADR number is a conflict git cannot see. Two branches cut from
# the same preprod each compute the same next number, the filenames differ,
# and the merge is clean; check-docs.mjs refuses the pair only at the gate,
# after the second branch has cited its number everywhere. Two parallel
# downstream features once both wrote 0011, and the second renumbered 20
# files by hand. The claim in /document is what prevents it; this is what
# finds the ones that got past, while both branches are still in flight.
#
# "This branch adds" means a decision record in the working tree that preprod
# does not have by path. Each is checked against the three places a number is
# taken: preprod, every other feature branch's own new records, and the
# claims register, where a claim by another feature takes the number before
# its file exists. Best-effort like every read here: nothing is said when
# preprod cannot be read, because then nothing can be called new.
cmd_adr_collisions() {
  local mine="${1-}" preprod ours num path other branch theirs tnum tpath claim who
  if [ -z "$mine" ]; then
    mine="feature/$(bash "$(dirname "$0")/resolve-feature-name.sh" 2>/dev/null || true)"
  fi
  git fetch --quiet "$REMOTE" preprod 2>/dev/null || true
  git rev-parse --verify --quiet "$REMOTE/preprod^{commit}" > /dev/null || return 0
  preprod=$(git ls-tree -r --name-only "$REMOTE/preprod" docs/decisions/ 2>/dev/null | adr_records)
  ours=$(git ls-files --cached --others --exclude-standard -- 'docs/decisions/*.md' 2>/dev/null \
    | sort -u | adr_records | while read -r num path; do
        [ -f "$path" ] || continue
        printf '%s\n' "$preprod" | grep -qxF "$num $path" || printf '%s %s\n' "$num" "$path"
      done)
  [ -n "$ours" ] || return 0

  git fetch --quiet --prune "$REMOTE" "+refs/heads/feature/*:refs/remotes/$REMOTE/feature/*" 2>/dev/null || true
  cmd_fetch
  while read -r num path; do
    printf '%s\n' "$preprod" | while read -r tnum tpath; do
      [ "$tnum" = "$num" ] && printf 'ADR %s: %s here, %s on preprod\n' "$num" "$path" "$tpath"
    done
    for other in $(git for-each-ref --format='%(refname:short)' "refs/remotes/$REMOTE/feature/"); do
      branch=${other#"$REMOTE"/}
      [ "$branch" = "$mine" ] && continue
      theirs=$(git ls-tree -r --name-only "$other" docs/decisions/ 2>/dev/null | adr_records)
      printf '%s\n' "$theirs" | while read -r tnum tpath; do
        [ "$tnum" = "$num" ] || continue
        [ "$tpath" != "$path" ] || continue
        printf '%s\n' "$preprod" | grep -qxF "$tnum $tpath" && continue
        printf 'ADR %s: %s here, %s on %s\n' "$num" "$path" "$tpath" "$branch"
      done
    done
    claim=$(git show "$REMOTE/$BRANCH:claims/adr/$num.md" 2>/dev/null) || continue
    who=$(printf '%s\n' "$claim" | sed -n 's/^claimed_by: *//p' | head -n1 | tr -d '"[:space:]')
    if [ -n "$who" ] && [ "$who" != none ] && [ "feature/$who" != "$mine" ]; then
      printf 'ADR %s: %s here, claimed by %s on the %s branch\n' "$num" "$path" "$who" "$BRANCH"
    fi
  done <<< "$ours"
  return 0
}

case "${1-}" in
  next-adr)            shift; cmd_next_adr "$@" ;;
  fetch)               shift; cmd_fetch "$@" ;;
  list)                shift; cmd_list "$@" ;;
  adr-numbers-on-preprod)  shift; cmd_adr_numbers_on_preprod "$@" ;;
  features)            shift; cmd_features "$@" ;;
  feature)             shift; cmd_feature "$@" ;;
  feature-branches)    shift; cmd_feature_branches "$@" ;;
  adr-collisions)      shift; cmd_adr_collisions "$@" ;;
  -h|--help|help|"")   usage; exit 2 ;;
  *)                   echo "unknown command: $1" >&2; usage; exit 2 ;;
esac
