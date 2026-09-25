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
# Reads go through git: one fetch of the coordination ref per process, then
# `git show` against the fetched ref. Writes go through the GitHub contents
# API, whose per-path SHA check is the compare-and-swap, because web sessions
# get a 403 from the git proxy on any push outside their own claude/<branch>.
# `write` and `delete` need a token (GH_TOKEN, GITHUB_TOKEN, or `gh auth
# token`); with none they exit 2 and the caller (the stale-record sweep in
# /feature phase 0) makes the write with the session's MCP tool instead. The
# claude.ai sandbox proxy refuses every contents-API write with a 403 even
# when a token is set, and that refusal is treated exactly like having no
# token: exit 2, same fallback. A journey write does not come through here:
# journey.sh commits the record to the session branch, and journey-sync.yml
# mirrors it onto coordination under the workflow's token.
#
# Every read subcommand is best-effort. A missing branch, a missing remote or
# a dead network prints nothing and exits 0. Reading a coordination register
# must never stall a session; the hard guarantee lives in check-docs.mjs.
#
# Nothing here checks out a branch, creates a worktree, or touches the
# index. A session must stay exactly where it was.
set -uo pipefail

BRANCH="${COORDINATION_BRANCH:-coordination}"
REMOTE="${COORDINATION_REMOTE:-origin}"
API="${GITHUB_API_URL:-https://api.github.com}"
CURL_TIMEOUT_SECONDS=20
WRITE_ATTEMPTS=3

usage() {
  cat >&2 <<'USAGE'
usage: coordination.sh <command> [args]

  next-adr <on-preprod> <claimed>
                            Print max(on-preprod, claimed) + 1, zero-padded
                            to four digits. Both arguments are lists of
                            numbers separated by whitespace. Pure: no
                            network, no git, no filesystem.

  fetch                     Fetch the coordination ref. Silent, never fatal,
                            and once per process: every read below shares it.

  write <path> --from=<file> --sha=<sha|none> [--message=<msg>]
                            Put <file> at <path> on the coordination branch
                            through the contents API, with <sha> as the
                            compare-and-swap (none: the path is new). Token:
                            GH_TOKEN, GITHUB_TOKEN, then gh auth token. Exit 0
                            on 200 or 201; on 409 or 422 the sha is re-read
                            after a fresh fetch and the put retried, three
                            attempts in all; exit 2 with no token, or when
                            the proxy refuses the write (the sandbox), so the
                            caller can write through MCP instead; exit 1 with
                            one line on anything else.

  delete <path> [--message=<msg>]
                            Delete <path> on the coordination branch through
                            the contents API, sha read from the fetched ref.
                            Same token rule and exit codes as write. A path
                            already absent is nothing to do: exit 0.

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

# One fetch per process. A command that reads the record, then the register,
# then a claim would otherwise pay the round trip three times for one answer;
# the variable makes the second and third calls free. A write that must
# re-read the sha after a lost compare-and-swap resets it (refetch) so the
# retry sees the branch as it is now.
FETCHED=""
cmd_fetch() {
  [ -z "$FETCHED" ] || return 0
  FETCHED=1
  git fetch --quiet "$REMOTE" "$BRANCH" 2>/dev/null || return 0
}

refetch() {
  FETCHED=""
  cmd_fetch
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

# ---------------------------------------------------------------------------
# Writes: the contents API
# ---------------------------------------------------------------------------

# The token, in the order a session is likely to hold one. It reaches curl's
# argument list and nothing else: no echo, no log line, no error message.
api_token() {
  local found=""
  if [ -n "${GH_TOKEN:-}" ]; then
    found=$GH_TOKEN
  elif [ -n "${GITHUB_TOKEN:-}" ]; then
    found=$GITHUB_TOKEN
  elif command -v gh >/dev/null 2>&1; then
    found=$(gh auth token 2>/dev/null) || found=""
  fi
  [ -n "$found" ] || return 1
  printf '%s' "$found"
}

# owner/repo from the remote's URL, whatever its form: https://host/o/r.git,
# git@host:o/r.git, ssh://git@host/o/r, or the proxied URL a web session
# sees. The last two path segments are the pair, with any .git dropped.
origin_repo() {
  local url pair
  url=$(git remote get-url "$REMOTE" 2>/dev/null) || return 1
  url=${url%/}
  url=${url%.git}
  pair=$(printf '%s\n' "$url" | tr ':' '/' | awk -F/ 'NF >= 2 { print $(NF-1) "/" $NF }')
  printf '%s' "$pair" | grep -Eq '^[^/[:space:]]+/[^/[:space:]]+$' || return 1
  printf '%s' "$pair"
}

# A JSON string literal. Backslash and quote are escaped; a newline, return
# or tab becomes a space, because every value here is a one-line message, a
# branch name or a sha, and none may carry a control character.
json_string() {
  printf '"%s"' "$(printf '%s' "$1" | tr '\n\r\t' '   ' | sed 's/\\/\\\\/g; s/"/\\"/g')"
}

# api_call <method> <repo path> <json file> <out file> <token>: one request
# under the hard timeout, printing the status code. curl's own stderr is
# dropped: the line a caller prints names the path and the status, which is
# what a reader can act on.
api_call() {
  local method=$1 path=$2 json=$3 out=$4 token=$5 code
  code=$(curl -sS -o "$out" -w '%{http_code}' --max-time "$CURL_TIMEOUT_SECONDS" \
    -X "$method" "$API/repos/$path" \
    -H "Authorization: Bearer $token" \
    -H "Accept: application/vnd.github+json" \
    -H "Content-Type: application/json" \
    --data-binary @"$json" 2>/dev/null) || code=000
  printf '%s' "${code:-000}"
}

# The first 120 characters of the answer's `message` field, or of the body
# when there is none, on one line with every control character dropped.
refusal_excerpt() {
  local file=$1 text
  text=$(tr -d '\000-\037' < "$file" 2>/dev/null |
    sed -n 's/.*"message"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)
  [ -n "$text" ] || text=$(tr -d '\000-\037' < "$file" 2>/dev/null)
  printf '%s' "${text:0:120}"
}

# The claude.ai sandbox proxy answers every contents-API write with this 403
# body while reads and a set token both work. It is the "no token" case in
# every way that matters to a caller: the write must go through MCP.
proxy_refused() {
  grep -q 'not permitted through this proxy' "$1" 2>/dev/null
}

# The blob sha of <path> on the fetched ref, or `none` when it is not there.
# It is the sha the contents API wants as its compare-and-swap, computed
# locally, so no read of the API precedes a write.
blob_sha() {
  git rev-parse --verify --quiet "$REMOTE/$BRANCH:$1" 2>/dev/null || printf 'none'
}

cmd_write() {
  local path="${1-}" from="" sha="" message="" arg token repo json out code why attempt
  [ -n "$path" ] || { usage; return 1; }
  shift
  for arg in "$@"; do
    case "$arg" in
      --from=*) from=${arg#--from=} ;;
      --sha=*) sha=${arg#--sha=} ;;
      --message=*) message=${arg#--message=} ;;
      *) echo "unknown flag: $arg" >&2; usage; return 1 ;;
    esac
  done
  if [ -z "$from" ] || [ -z "$sha" ]; then usage; return 1; fi
  [ -f "$from" ] || { echo "coordination: $from is not a file; nothing written" >&2; return 1; }
  token=$(api_token) || return 2
  repo=$(origin_repo) || { echo "coordination: cannot read owner/repo from the $REMOTE url; nothing written" >&2; return 1; }
  [ -n "$message" ] || message="coordination: write $path"
  json=$(mktemp)
  out=$(mktemp)
  attempt=0
  while :; do
    attempt=$((attempt + 1))
    {
      printf '{"message":%s,"branch":%s,"content":"%s"' \
        "$(json_string "$message")" "$(json_string "$BRANCH")" "$(base64 < "$from" | tr -d '\n')"
      [ "$sha" = none ] || printf ',"sha":%s' "$(json_string "$sha")"
      printf '}'
    } > "$json"
    code=$(api_call PUT "$repo/contents/$path" "$json" "$out" "$token")
    case "$code" in
      200 | 201) rm -f "$json" "$out"; return 0 ;;
      409 | 422)
        # A lost compare-and-swap: someone wrote the path since the sha was
        # read. Re-read it from a fresh fetch and try again, a bounded number
        # of times, so two sessions refreshing one namespace both land.
        if [ "$attempt" -lt "$WRITE_ATTEMPTS" ]; then
          refetch
          sha=$(blob_sha "$path")
          continue
        fi
        ;;
      403)
        if proxy_refused "$out"; then rm -f "$json" "$out"; return 2; fi
        ;;
    esac
    break
  done
  why=$(refusal_excerpt "$out")
  rm -f "$json" "$out"
  echo "coordination: write of $path refused ($code); nothing written${why:+: $why}" >&2
  return 1
}

cmd_delete() {
  local path="${1-}" message="" arg token repo sha json out code why attempt
  [ -n "$path" ] || { usage; return 1; }
  shift
  for arg in "$@"; do
    case "$arg" in
      --message=*) message=${arg#--message=} ;;
      *) echo "unknown flag: $arg" >&2; usage; return 1 ;;
    esac
  done
  cmd_fetch
  sha=$(blob_sha "$path")
  # Already gone is the state a delete asks for. Checked before the token, so
  # a session with no token is not sent to MCP to delete what is not there.
  [ "$sha" != none ] || return 0
  token=$(api_token) || return 2
  repo=$(origin_repo) || { echo "coordination: cannot read owner/repo from the $REMOTE url; nothing deleted" >&2; return 1; }
  [ -n "$message" ] || message="coordination: delete $path"
  json=$(mktemp)
  out=$(mktemp)
  attempt=0
  while :; do
    attempt=$((attempt + 1))
    printf '{"message":%s,"branch":%s,"sha":%s}' \
      "$(json_string "$message")" "$(json_string "$BRANCH")" "$(json_string "$sha")" > "$json"
    code=$(api_call DELETE "$repo/contents/$path" "$json" "$out" "$token")
    case "$code" in
      200) rm -f "$json" "$out"; return 0 ;;
      409 | 422)
        if [ "$attempt" -lt "$WRITE_ATTEMPTS" ]; then
          refetch
          sha=$(blob_sha "$path")
          [ "$sha" != none ] || { rm -f "$json" "$out"; return 0; }
          continue
        fi
        ;;
      403)
        if proxy_refused "$out"; then rm -f "$json" "$out"; return 2; fi
        ;;
    esac
    break
  done
  why=$(refusal_excerpt "$out")
  rm -f "$json" "$out"
  echo "coordination: delete of $path refused ($code); nothing deleted${why:+: $why}" >&2
  return 1
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
  write)               shift; cmd_write "$@" ;;
  delete)              shift; cmd_delete "$@" ;;
  -h|--help|help|"")   usage; exit 2 ;;
  *)                   echo "unknown command: $1" >&2; usage; exit 2 ;;
esac
