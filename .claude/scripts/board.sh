#!/usr/bin/env bash
# The one Board client the skills share for the Product Cockpit.
#
# The Board is the cockpit's message surface: a thread has a marker, a
# subject, a body, and it waits on whoever has not answered. A session posts
# to it in exactly one situation the journey defines (`.claude/JOURNEY.md`,
# "Blocked"): it is standing down on a blocker that only a person can clear,
# and the ask names the change, the position, what blocks and what would
# unblock. The Board carries the ASK; it never carries a position. Where a
# feature is comes from the touched-set record and from GitHub, and a post
# here changes nothing about that.
#
# It reads BOARD_URL and BOARD_TOKEN from the environment, plus an optional
# BOARD_TIMEOUT in seconds (default 20), and nothing else. The token is an
# agent token the cockpit minted (`pcb_...`); the author of every message is
# that credential, never anything in the body.
#
# Three failures, told apart by exit code, the same three spec-universe.sh
# uses because they have the same three fixes:
#
#   3  missing-credential   a variable is unset or blank; the message names it
#   4  rejected-credential  the Board answered 401 or 403; replace the token
#   5  board-unreachable    anything else: network, non-2xx, no answer in time.
#                           Prints exactly: board unreachable, ask not posted
#
# A post that fails is one line in the closing block and the flow continues:
# the `## Blocked` section in the feature context and the `blocked` label on
# the work item are the record; the Board ask is how a person hears about it
# sooner. Nothing here is fail-closed.
#
# Usage:
#   board.sh post <marker> <subject> [--to=<participantId>] [--product=<id>] < body.md
#   board.sh read
#
# Markers are the Board's own: question, blocked, ready, done, note. The
# stand-down ask is `blocked`. The body comes from stdin so a multi-line ask
# needs no quoting. `--to` narrows the audience to one participant; absent
# means everyone. On success the response body goes to stdout untouched.
set -uo pipefail

TIMEOUT_SECONDS="${BOARD_TIMEOUT:-20}"
UNREACHABLE="board unreachable, ask not posted"

usage() {
  sed -n '/^# Usage:/,/^set -uo/p' "$0" | sed '$d' | sed 's/^# \{0,1\}//' >&2
}

require_env() {
  if [ -z "${BOARD_URL:-}" ]; then
    echo "BOARD_URL is not set" >&2
    exit 3
  fi
  if [ -z "${BOARD_TOKEN:-}" ]; then
    echo "BOARD_TOKEN is not set" >&2
    exit 3
  fi
}

# json_string <text>: a JSON string literal, escaped by hand so the script
# needs nothing beyond bash and curl. Backslash and quote first, then every
# C0 control character: the three a markdown body can carry by name, and the
# rest as \u00XX, so no input can produce a body the server refuses as
# malformed and this script then misreports as unreachable.
json_string() {
  local s=$1 out="" i c
  s=${s//\\/\\\\}
  s=${s//\"/\\\"}
  s=${s//$'\n'/\\n}
  s=${s//$'\r'/\\r}
  s=${s//$'\t'/\\t}
  for ((i = 0; i < ${#s}; i++)); do
    c=${s:i:1}
    if [[ $c < $' ' ]]; then
      out+=$(printf '\\u%04x' "'$c")
    else
      out+=$c
    fi
  done
  printf '"%s"' "$out"
}

call() {
  local method=$1 path=$2 body=${3:-}
  local base=${BOARD_URL%/}
  local out err code
  out=$(mktemp)
  err=$(mktemp)
  local args=(-sS -o "$out" -w '%{http_code}' --max-time "$TIMEOUT_SECONDS"
    -X "$method" "$base$path" -H "Authorization: Bearer $BOARD_TOKEN")
  if [ -n "$body" ]; then
    args+=(-H "Content-Type: application/json" --data "$body")
  fi
  code=$(curl "${args[@]}" 2>"$err") || code=000
  case "$code" in
    2??) cat "$out"; rm -f "$out" "$err"; return 0 ;;
    401|403) rm -f "$out" "$err"; echo "board rejected the credential ($code)" >&2; exit 4 ;;
    *)
      # The sentence first, because it is what a skill matches on; curl's own
      # line after it, because "unreachable" alone cannot tell DNS from TLS
      # from a timeout, and that difference is the fix.
      echo "$UNREACHABLE" >&2
      { [ -s "$err" ] && sed 's/^/  /' "$err" >&2; } || true
      rm -f "$out" "$err"
      exit 5 ;;
  esac
}

cmd=${1:-}
case "$cmd" in
  post)
    marker=${2:-}
    subject=${3:-}
    if [ -z "$marker" ] || [ -z "$subject" ]; then usage; exit 2; fi
    case "$marker" in
      question|blocked|ready|done|note) ;;
      *) echo "not a board marker: $marker (question, blocked, ready, done, note)" >&2; exit 2 ;;
    esac
    to=""
    product=""
    shift 3
    for arg in "$@"; do
      case "$arg" in
        --to=*) to=${arg#--to=} ;;
        --product=*) product=${arg#--product=} ;;
        *) echo "unknown flag: $arg" >&2; usage; exit 2 ;;
      esac
    done
    body=$(cat)
    if [ -z "$body" ]; then echo "the body is empty; pipe the ask on stdin" >&2; exit 2; fi
    require_env
    json="{\"marker\":$(json_string "$marker"),\"subject\":$(json_string "$subject"),\"body\":$(json_string "$body")"
    [ -n "$to" ] && json="$json,\"audienceParticipantId\":$(json_string "$to")"
    [ -n "$product" ] && json="$json,\"productId\":$(json_string "$product")"
    json="$json}"
    call POST /api/board "$json"
    ;;
  read)
    require_env
    call GET /api/board
    ;;
  *)
    usage
    exit 2
    ;;
esac
