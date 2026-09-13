#!/usr/bin/env bash
# The one /v1 client the skills share for the System Registry.
#
# The registry is the estate's list of systems. Each entry is one system, and
# each system owns one change-key prefix (`MYPR`, giving keys like `MYPR-7`).
# A prefix is issued once and never released, because the keys minted under it
# exist forever. This client exists so a repository can ask one question before
# it mints anything: does this prefix belong to the system I think it does?
#
# It is READ-ONLY, and that is the registry's design rather than this file's
# restraint: a machine token is refused on every write, naming the token, and
# every entry changes only through a signed-in human. There is no `create` to
# add here. A prefix can be verified, never issued.
#
# It reads REGISTRY_URL and REGISTRY_TOKEN from the environment, plus an
# optional REGISTRY_TIMEOUT in seconds (default 20), and nothing else. The same
# shape spec-universe.sh and cockpit.sh use, for the same reason: a session and a
# workflow are configured identically, and no skill carries its own curl line.
#
# Exits. The three failure exits are the ones its two siblings use, because
# they have the same three fixes:
#
#   0  resolved             the registry answered and the entry exists
#   1  not-found            the registry answered and it does NOT exist. This
#                           is an ANSWER, not a failure: the caller asked a
#                           yes-or-no question and got no
#   2  usage                the arguments are wrong, or the prefix is a shape
#                           no key could be built from. Nothing was sent
#   3  missing-credential   a variable is unset or blank; the message names it
#   4  rejected-credential  the registry answered 401 or 403; replace the token
#   5  unreachable          anything else: network, non-2xx, no answer in time.
#                           Prints exactly: registry unreachable, prefix not verified
#
# **Exits 1 and 2 are the only exits that may stop a Capture**, and they are the
# only two that say something true about the prefix: the registry does not know
# it, or no change key could be built from it. A caller that cannot reach the
# registry (3, 4, 5) knows nothing about the prefix, and blocking on ignorance
# would fail every feature in the estate during an outage. The prefix in
# `.harness-version` was verified when it was written and cannot have become
# less true since; see `.claude/HARNESS.md` under `change-prefix`.
#
# On success the response body goes to stdout untouched, and on a 404 the
# registry's own answer goes to stdout too. **This file never parses the body.**
# A caller reads the JSON as the service shaped it, so a field this script has
# never seen cannot be silently misread as a field it has. The HTTP status is
# the only thing interpreted here.
#
# Usage:
#   registry.sh prefix <PREFIX>          GET /v1/systems/by-prefix/{prefix}
#   registry.sh system <key-or-slug>     GET /v1/systems/{key-or-slug}
#
# `prefix` is case-insensitive and includes retired systems, both on the
# registry's side. Retired matters: a retired system's prefix is still taken,
# because the keys minted under it are still out there, so a retired hit is a
# match and never a free prefix.
#
# The list is the surface. There is no generic pass-through, for the reason
# spec-universe.sh gives: an escape hatch that outlives its reason is how a
# client stops being the one way in. A call this file cannot make is a command
# to add here, with a test.
set -uo pipefail

TIMEOUT_SECONDS="${REGISTRY_TIMEOUT:-20}"
UNREACHABLE="registry unreachable, prefix not verified"

usage() {
  sed -n '/^# Usage:/,/^# `prefix`/p' "$0" | sed '$d' | sed 's/^# \{0,1\}//' >&2
  exit 2
}

fail_missing() {
  echo "$1 is not set, so the skill has no credential to read the registry with. This is a configuration fault, not an outage: set the variable and run again." >&2
  exit 3
}

credentials() {
  URL="${REGISTRY_URL:-}"
  TOKEN="${REGISTRY_TOKEN:-}"
  [ -n "${URL// /}" ] || fail_missing REGISTRY_URL
  [ -n "${TOKEN// /}" ] || fail_missing REGISTRY_TOKEN
  URL="${URL%/}"
}

# urlencode one path segment. A prefix reaching the path unencoded could
# smuggle a query separator or a second path segment into the lookup, and the
# answer would then be about something else entirely.
enc() {
  local s="$1" out="" c i
  for (( i = 0; i < ${#s}; i++ )); do
    c="${s:i:1}"
    case "$c" in
      [A-Za-z0-9._~-]) out+="$c" ;;
      *) out+=$(printf '%%%02X' "'$c") ;;
    esac
  done
  printf '%s' "$out"
}

# Refuse a prefix no change key could be built from, before anything is sent.
# Only two shapes are refused, and both are refused because THIS harness cannot
# use them, never because the registry would not like them: an empty prefix,
# and one containing a hyphen, which would make `<PREFIX>-<n>` ambiguous about
# where the prefix ends. Whitespace and slashes fall under the same rule. Every
# other judgement about what a prefix may look like belongs to the registry,
# which is the one place that knows.
check_prefix_shape() {
  local p="$1"
  if [ -z "${p// /}" ]; then
    echo "the prefix is empty" >&2
    exit 2
  fi
  case "$p" in
    *-* | *[[:space:]]* | */*)
      echo "not a usable prefix: $p" >&2
      echo "A change key is <PREFIX>-<n>, so a prefix carrying a hyphen, whitespace or a slash would make the key ambiguous about where the prefix ends." >&2
      exit 2 ;;
  esac
}

# get <path> <not-found-sentence>
# Prints the body on 2xx and on 404. Maps every other status to one of the
# three failure exits.
get() {
  local path="$1" not_found="$2"
  local tmp err status
  tmp=$(mktemp)
  err=$(mktemp)
  status=$(curl -sS -o "$tmp" -w '%{http_code}' \
    --max-time "$TIMEOUT_SECONDS" \
    -H "authorization: Bearer $TOKEN" \
    -H "accept: application/json" \
    "$URL$path" 2>"$err") || status="000"
  case "$status" in
    2??)
      cat "$tmp"; rm -f "$tmp" "$err"; return 0 ;;
    404)
      # The registry answered. Its body goes to stdout as the answer it is,
      # and the sentence goes to stderr as the copy a skill matches on.
      cat "$tmp"; rm -f "$tmp" "$err"
      echo "$not_found" >&2
      exit 1 ;;
    401|403)
      rm -f "$tmp" "$err"
      echo "The registry answered $status to GET $path. REGISTRY_TOKEN is set but not accepted, so it is expired, revoked, or for another registry. This is a configuration fault, not an outage: replace the token." >&2
      exit 4 ;;
    *)
      # The sentence first, because it is what a skill matches on. Then the
      # detail, because "unreachable" alone cannot tell DNS from TLS from a
      # timeout from a 502, and that difference is the fix.
      echo "$UNREACHABLE" >&2
      if [ "$status" = "000" ]; then
        echo "(GET $path: no answer within ${TIMEOUT_SECONDS}s, or the network failed)" >&2
        { [ -s "$err" ] && sed 's/^/  /' "$err" >&2; } || true
      else
        echo "(GET $path answered $status)" >&2
        # The answer body is the only place the registry says WHY it refused.
        # Without it an unexpected status is indistinguishable from an outage.
        [ -s "$tmp" ] && head -c 2000 "$tmp" >&2 && echo >&2
      fi
      rm -f "$tmp" "$err"
      exit 5 ;;
  esac
}

cmd="${1-}"; shift || true
case "$cmd" in
  -h|--help|help|"") usage ;;
esac

case "$cmd" in
  prefix)
    [ $# -ge 1 ] || usage
    check_prefix_shape "$1"
    credentials
    get "/v1/systems/by-prefix/$(enc "$1")" "no system has this prefix" ;;
  system)
    [ $# -ge 1 ] || usage
    [ -n "${1// /}" ] || { echo "the key or slug is empty" >&2; exit 2; }
    credentials
    get "/v1/systems/$(enc "$1")" "no system has this key or slug" ;;
  *)
    echo "unknown command: $cmd" >&2; usage ;;
esac
