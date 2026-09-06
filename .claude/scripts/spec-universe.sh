#!/usr/bin/env bash
# The one /v1 client the skills share for Spec Universe.
#
# Every skill that reads or writes the specification goes through this file,
# so no skill carries its own curl line and every one of them fails closed the
# same way. It reads SPEC_UNIVERSE_URL and SPEC_UNIVERSE_TOKEN from the
# environment and nothing else: the same two variables CI exports for
# check:spec, so a session and a workflow are configured identically.
#
# Three failures, told apart by exit code, because they have different fixes
# (check-spec.mjs makes the same distinction):
#
#   3  missing-credential   a variable is unset or blank; the message names it
#   4  rejected-credential  Spec Universe answered 401 or 403; replace the token
#   5  spec-unreachable     anything else: network, non-2xx, no answer in time.
#                           Prints exactly: spec unreachable, cannot verify
#
# A caller that cannot read the specification must never guess. Exit 5 is the
# signal to stop; the sentence is the copy a skill repeats to the user.
#
# On success the response body goes to stdout untouched, so a skill reads the
# JSON (or the markdown of a snapshot) exactly as the service shaped it.
#
# Usage:
#   spec-universe.sh nodes <product> [status] [kind]
#   spec-universe.sh node <id>                        id: nod_... or product.local-slug
#   spec-universe.sh dependencies <id> <in|out>
#   spec-universe.sh proposals <node-id> [state]
#   spec-universe.sh change-proposals <change-id>
#   spec-universe.sh snapshot <product> [markdown|json] [--proposals]
#   spec-universe.sh claim <node-id> <matched|drifted> <basis> [criterion] [evidence]
#   spec-universe.sh propose            < body.json    POST  /v1/proposals
#   spec-universe.sh patch-proposal <id> < body.json   PATCH /v1/proposals/{id}
#   spec-universe.sh release <change-id>               POST  /v1/changes/{id}/released
#
# The list is the surface. There is no generic pass-through: one existed while
# the named write commands were unproven, and it went the day they ran, because
# an escape hatch that outlives its reason is how a client stops being the one
# way in. A call this file cannot make is a command to add here, with a test.
#
# Writes take an optional IDEMPOTENCY_KEY in the environment, sent as the
# Idempotency-Key header, so a retried claim or release does not land twice.
#
# The write dialect, proven against live /v1 on 2026-09-05 and NOT what the
# MCP tool schema implies. A proposal body is:
#
#   {"node": "<product>.<local-slug>",        (not node_id)
#    "changeId": "<KEY>", "changeUrl": "...", (not change_id / change_url)
#    "rationale": "...",                      (required)
#    "fields": {"behaviour": "...", "rulesAndEdgeCases": "...",
#               "acceptanceCriteria": [{"id": "ac-1", "text": "..."}]}}
#
# patch-proposal takes any of state, fields, rationale, changeId, changeUrl,
# with ONE combination refused: `state` and `fields` together answer 400
# validation ("Some fields need fixing"), so an acceptance and an edit are two
# calls, never one.
#
# A patch that DOES carry `fields` replaces them rather than merging into them,
# so it drops every field it does not name: send the whole set every time. A
# patch that omits `fields` leaves them untouched, which is what makes the
# state-only acceptance safe.
#
# The endpoint is NOT strict: an unrecognised key is accepted and DROPPED, so
# a body written in the MCP spelling lands with no change key and can never be
# promoted, a write that fails as a success. `propose` and `patch-proposal`
# therefore refuse the three known wrong spellings before sending.
#
# The claim body is exactly {value, basis, criterionId?, evidence?}: the field
# names the /v1 conformance endpoint reads, and a project's client test pins
# them as a set. The endpoint DROPS a key it does
# not know rather than refusing it, so a misspelt criterion key does not fail:
# it silently widens every per-criterion claim to the whole node, which is
# what every claim of the v0.7.0 release suffered under the old `criterion`.
set -uo pipefail

TIMEOUT_SECONDS="${SPEC_UNIVERSE_TIMEOUT:-20}"
UNREACHABLE="spec unreachable, cannot verify"

usage() {
  sed -n '/^# Usage:/,/^# Writes/p' "$0" | sed 's/^# \{0,1\}//' | sed '$d' >&2
  exit 2
}

fail_missing() {
  echo "$1 is not set, so the skill has no credential to read the specification with. This is a configuration fault, not an outage: set the variable and run again." >&2
  exit 3
}

credentials() {
  URL="${SPEC_UNIVERSE_URL:-}"
  TOKEN="${SPEC_UNIVERSE_TOKEN:-}"
  [ -n "${URL// /}" ] || fail_missing SPEC_UNIVERSE_URL
  [ -n "${TOKEN// /}" ] || fail_missing SPEC_UNIVERSE_TOKEN
  URL="${URL%%/}"
}

# urlencode one path segment (slugs and keys are plain, but a state filter or a
# change key must not be able to smuggle a query separator).
enc() {
  local s="$1" out="" c
  for (( i = 0; i < ${#s}; i++ )); do
    c="${s:i:1}"
    case "$c" in
      [A-Za-z0-9._~-]) out+="$c" ;;
      *) out+=$(printf '%%%02X' "'$c") ;;
    esac
  done
  printf '%s' "$out"
}

# Quote one value as a JSON string. An evidence URL or a criterion id carrying a
# quote or a backslash would otherwise produce a malformed body, and the service
# would refuse a claim the caller believes it wrote.
json_string() {
  printf '%s' "$1" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))' 2>/dev/null \
    || printf '"%s"' "$(printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g')"
}

# Refuse a write body naming a key /v1 does not read. The proposals endpoint
# accepts unknown keys and silently drops them, so a body in the MCP spelling
# lands with changeId null: it looks like a success and leaves a proposal no
# release can promote. Refusing beats writing something unpromotable.
guard_write_body() {
  # No python3 is not a reason to stop checking: a coarse grep on the key form
  # is worth more here than silence, because the failure it prevents is silent
  # and permanent while a false refusal is loud and one edit away.
  if ! command -v python3 >/dev/null 2>&1; then
    if printf '%s' "$1" | grep -qE '"(node_id|nodeId|change_id|change_url)"[[:space:]]*:'; then
      echo "This body names keys /v1 does not read (node_id and nodeId are node, change_id is changeId, change_url is changeUrl)." >&2
      echo "Checked without python3, so the match is on the key form alone. Rename them and run again." >&2
      exit 2
    fi
    return 0
  fi
  local bad
  bad=$(printf '%s' "$1" | python3 -c '
import json, sys
wrong = {"node_id": "node", "nodeId": "node", "change_id": "changeId", "change_url": "changeUrl"}
try:
    body = json.load(sys.stdin)
except Exception:
    sys.exit(0)
if isinstance(body, dict):
    print("\n".join("  %s should be %s" % kv for kv in wrong.items() if kv[0] in body))
' 2>/dev/null) || return 0
  [ -n "${bad// /}" ] || return 0
  echo "This body names keys /v1 does not read:" >&2
  echo "$bad" >&2
  echo "The endpoint accepts unknown keys and drops them, so the write would report success with the value missing. Rename them and run again." >&2
  exit 2
}

# call <method> <path> [body-from-stdin]
# Prints the body on success. Maps every failure to one of the three exits.
call() {
  local method="$1" path="$2" with_body="${3:-}"
  local tmp status
  tmp=$(mktemp)
  local -a args=(
    -sS -o "$tmp" -w '%{http_code}'
    --max-time "$TIMEOUT_SECONDS"
    -X "$method"
    -H "authorization: Bearer $TOKEN"
    -H "accept: application/json, text/markdown;q=0.9"
  )
  if [ -n "$with_body" ]; then
    args+=(-H "content-type: application/json" --data-binary @-)
    [ -n "${IDEMPOTENCY_KEY:-}" ] && args+=(-H "Idempotency-Key: $IDEMPOTENCY_KEY")
  fi
  status=$(curl "${args[@]}" "$URL$path" 2>/dev/null) || status="000"
  case "$status" in
    2??)
      cat "$tmp"; rm -f "$tmp"; return 0 ;;
    401|403)
      rm -f "$tmp"
      echo "Spec Universe answered $status to $method $path. SPEC_UNIVERSE_TOKEN is set but not accepted, so it is expired, revoked, or for another universe. This is a configuration fault, not an outage: replace the token." >&2
      exit 4 ;;
    *)
      echo "$UNREACHABLE" >&2
      if [ "$status" = "000" ]; then
        echo "($method $path: no answer within ${TIMEOUT_SECONDS}s, or the network failed)" >&2
      else
        echo "($method $path answered $status)" >&2
        # The answer body is the only place the service says WHY it refused. Without
        # it a rejected write body is indistinguishable from an outage, which is how
        # a caller ends up guessing at field names instead of reading the refusal.
        [ -s "$tmp" ] && head -c 2000 "$tmp" >&2 && echo >&2
      fi
      rm -f "$tmp"
      exit 5 ;;
  esac
}

query() {
  # query k1 v1 k2 v2 ... ; empty values are skipped; prints "?k=v&k=v" or ""
  local out="" k v
  while [ $# -ge 2 ]; do
    k="$1"; v="$2"; shift 2
    [ -n "$v" ] || continue
    out+="${out:+&}$(enc "$k")=$(enc "$v")"
  done
  [ -n "$out" ] && printf '?%s' "$out"
}

cmd="${1-}"; shift || true
case "$cmd" in
  -h|--help|help|"") usage ;;
esac
credentials

case "$cmd" in
  nodes)
    [ $# -ge 1 ] || usage
    call GET "/v1/products/$(enc "$1")/nodes$(query status "${2-}" kind "${3-}")" ;;
  node)
    [ $# -ge 1 ] || usage
    call GET "/v1/nodes/$(enc "$1")" ;;
  dependencies)
    [ $# -ge 2 ] || usage
    case "$2" in in|out) ;; *) usage ;; esac
    call GET "/v1/nodes/$(enc "$1")/dependencies$(query direction "$2")" ;;
  proposals)
    [ $# -ge 1 ] || usage
    call GET "/v1/nodes/$(enc "$1")/proposals$(query state "${2-}")" ;;
  change-proposals)
    [ $# -ge 1 ] || usage
    call GET "/v1/changes/$(enc "$1")/proposals" ;;
  snapshot)
    [ $# -ge 1 ] || usage
    fmt="${2:-markdown}"; inc=""
    [ "${3-}" = "--proposals" ] && inc="proposals"
    call GET "/v1/snapshots/$(enc "$1")$(query format "$fmt" include "$inc")" ;;
  claim)
    [ $# -ge 3 ] || usage
    case "$2" in matched|drifted) ;; *) usage ;; esac
    body="{\"value\":$(json_string "$2"),\"basis\":$(json_string "$3")"
    [ -n "${4-}" ] && body+=",\"criterionId\":$(json_string "$4")"
    [ -n "${5-}" ] && body+=",\"evidence\":$(json_string "$5")"
    body+='}'
    printf '%s' "$body" | call POST "/v1/nodes/$(enc "$1")/conformance" body ;;
  propose)
    body=$(cat)
    guard_write_body "$body"
    printf '%s' "$body" | call POST "/v1/proposals" body ;;
  patch-proposal)
    [ $# -ge 1 ] || usage
    body=$(cat)
    guard_write_body "$body"
    printf '%s' "$body" | call PATCH "/v1/proposals/$(enc "$1")" body ;;
  release)
    [ $# -ge 1 ] || usage
    printf '{}' | call POST "/v1/changes/$(enc "$1")/released" body ;;
  *)
    echo "unknown command: $cmd" >&2; usage ;;
esac
