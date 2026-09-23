#!/usr/bin/env bash
# The one Product Cockpit client the skills share.
#
# An environment holds ONE cockpit credential and configures ONE URL, so it
# gets one client. Four commands, one per thing the cockpit offers a session:
#
#   post     put an ask on the Board
#   read     read the Board
#   ping     tell the cockpit a fact it reads has changed
#   report   say what is happening inside the position a change is at
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
# BOARD_TIMEOUT in seconds (default 20), and nothing else. The two variables
# keep the Board's name because they are the same URL and the same credential
# the Board has always used; renaming them would re-key every configured
# environment to say the same thing. The token is an agent token the cockpit
# minted (`pcb_...`); the author of every message is that credential, never
# anything in the body.
#
# Three failures, told apart by exit code, the same three spec-universe.sh
# uses because they have the same three fixes:
#
#   3  missing-credential   a variable is unset or blank; the message names it
#   4  rejected-credential  the Board answered 401 or 403; replace the token
#   5  board-unreachable    anything else: network, non-2xx, no answer in time.
#                           Prints one sentence naming what did not happen,
#                           passed in by the command rather than shared:
#                           `board unreachable, ask not posted` for a post,
#                           `board unreachable, board not read` for a read.
#
# A post that fails is one line in the closing block and the flow continues:
# the `## Blocked` section in the feature context and the `blocked` label on
# the work item are the record; the Board ask is how a person hears about it
# sooner. Nothing here is fail-closed.
#
# `ping` AND `report` ARE FAIL-SOFT EVEN BY THOSE STANDARDS: neither EVER
# exits non-zero at runtime, in any of the four ways the three above can fail.
# Both sit on a path whose work is already done. A ping only removes latency
# from a poll that runs anyway; a report only says what a session is doing
# while it does it. Neither may add a failure mode to what it describes. A
# scaffold with no cockpit configured pays nothing at all: no stall, no prompt,
# and not even a line, because a line at every seam is a nag that teaches a
# session to skim.
#
#   neither variable set   nothing printed, exit 0. Not configured is not a
#                          fault; there is nothing to report
#   one variable set       one line naming the missing one, exit 0. Half a
#                          cockpit IS a fault, and a silent one would never
#                          be found
#   401 or 403             one line, exit 0. For a report, said ONCE per
#                          session (below)
#   404, report only       said ONCE per session (below), naming the cause:
#                          the cockpit's own `not_found` means no product is
#                          configured against the repository, anything else
#                          means a cockpit that predates the report route
#   any other 4xx          for a ping, one line, exit 0, naming the status:
#                          the fix for a refusal is in the recipe, not in the
#                          environment, so it must not read as an outage. For
#                          a report, said ONCE per session too, naming it
#   anything else          one line, exit 0
#   2xx                    nothing printed, exit 0. For a report that covers
#                          both 201 (written) and 200 (this actor's `ref` was
#                          already there, so nothing was written). Both are
#                          success and neither is worth a line
#
# A REPORT'S REFUSAL IS SAID ONCE PER SESSION, LOUDLY. One downstream session
# sent ten reports into a 404, one easy-to-miss line each, while `ping` stayed
# silent (a refresh accepts any repository), and nothing it reported was ever
# recorded. So the first 4xx of each status in a session is one loud line
# naming the likely cause and the fix, and the same refusal after it is
# silent. A 401, a 403 or a 404 is about every report the session will make
# (the credential, or a repository no product is configured against), so its
# line starts `COCKPIT REPORTS OFF`. Any other 4xx is about what was sent (a
# harness and a cockpit that disagree on a report's shape, or a rate limit),
# so its line starts `COCKPIT REFUSED A REPORT` and claims nothing about the
# reports after it. The session is Claude Code's own id; without one there is
# nothing to remember across calls, and the line is said every time.
#
# One line means one line: no curl diagnostic beneath it, unlike `post`. The
# only loud failure left is a USAGE error (an unknown flag, a source or a
# journey position the receiver does not have, a report with nothing to say),
# which is a bug in the recipe that rings rather than a runtime fault, and is
# the one way a typo is ever noticed.
#
# The two share one timeout, COCKPIT_SOFT_TIMEOUT (default 5 seconds), so a
# phase write never waits out the Board's 20. One knob and not two, because
# they are one class and a second would be a second thing to configure
# identically; and a knob, not a second credential: the environment still
# holds one URL and one token.
#
# WHAT A PING MAY SAY. The receiver keeps exactly `repository`, `changeKey`
# and `sources` and drops the whole rest of the body. So a ping names an
# ADDRESS and can carry no fact even if one were sent, and this client sends
# nothing else: a key the receiver drops would read here as a key that
# arrives. There is no session identity on the wire either. The author of a
# ping is the `pcb_` credential, exactly as it is for a post.
#
# WHAT A REPORT IS FOR. The cockpit can already say which position a change is
# at, and that a session is still working inside it. It cannot say WHAT is
# happening in there, or for how long. A report is one sentence of that, and
# nothing more: the position it names is stored as the PRODUCER'S OWN WORDS
# and the placement resolver never consults it, so a report can no more move a
# change than a Board post can. The author is the credential, as everywhere
# else here; the route has no author field and this client sends none.
#
# WHERE THE SEAMS AND THE SENTENCES ARE WRITTEN DOWN: `.claude/JOURNEY.md`,
# under "Reporting activity". It owns the eight places the harness reports
# from, why there are eight, the `ref` shape each one uses and the voice a
# sentence is written in, and this header does not repeat any of it. What belongs here
# is only what the client itself does with the flags.
#
# `--ref` IS A PROMISE OF A MATCHING FINISH. A pair is derived rather than
# stored (the cockpit keeps no "running" column, exactly as the Board keeps no
# "answered" one), so a `ref` nothing later `completes` reads as an operation
# that is still going. Pass one only where a finish will follow.
#
# THE POSITION is one of the 23 the journey has, and this client refuses an
# unknown one BY NAME rather than leaving it to the route. The route stores
# whatever position it is sent (checked against the live cockpit: an unknown
# one is recorded, not refused), so this is the only check there is, and a
# typo would otherwise land in the stream as the producer's own words. That
# is the one place `report` is strict.
# A `ref` gets no such check, because its correctness is relational rather
# than a vocabulary; what guards it is that each recipe binds the pair to one
# shell variable, so the two halves cannot disagree.
#
# THE SENTENCE is taken as an argument rather than on stdin: a `post` body is
# multi-line markdown that would need quoting, and that reason does not carry
# to one line. Empty is refused, and so is a flag in its place, because
# `report building --key=X` would otherwise file the flag as the sentence and
# drop the key. Length is the route's to bound; a second copy of that bound
# here would only drift from it.
#
# Usage:
#   cockpit.sh post <marker> <subject> [--to=<participantId>] [--product=<id>] < body.md
#   cockpit.sh read
#   cockpit.sh ping [--key=<CHANGE-KEY>] [--repository=<owner/repo>] [--source=<name>]...
#   cockpit.sh report <position> <sentence> [--key=<CHANGE-KEY>] [--branch=<name>]
#                     [--repository=<owner/repo>] [--ref=<id>] [--completes=<id>]
#
# Markers are the Board's own: question, blocked, ready, done, note. The
# stand-down ask is `blocked`. The body comes from stdin so a multi-line ask
# needs no quoting. `--to` narrows the audience to one participant; absent
# means everyone. On success the response body goes to stdout untouched.
#
# `ping` derives the repository from the `origin` remote unless `--repository`
# names one, and omits it when there is nothing to derive. Sources are
# registry, spec_universe, github, railway and tracker; absent means the
# cockpit refetches what it judges right, which is the reader deriving.
#
# `report` derives the same repository and, unless `--branch` names one, the
# checked-out branch; a detached HEAD derives none rather than guessing. The
# repository is the one thing it cannot do without, so a remote it cannot read
# as `owner/repo` costs one line and no report. `--key` is optional and every
# seam in a `/feature` run carries one, because the key is minted in phase 0
# before any seam can fire; a technique skill run on its own has none, and a
# repository-scoped report is honest where a made-up key would not be.
set -uo pipefail

TIMEOUT_SECONDS="${BOARD_TIMEOUT:-20}"
SOFT_TIMEOUT_SECONDS="${COCKPIT_SOFT_TIMEOUT:-5}"

# The 23 journey positions, in the journey's order, spelled as the cockpit's
# lifecycle spells them. This is a third copy of `POSITIONS` in
# `touched-set.mjs`; `tests/cockpit-client.test.mjs` reads both and refuses a
# difference, so the copy cannot drift in silence. Keeping it here is what
# turns a mistyped position from a swallowed 400 into a loud usage error.
POSITIONS=(
  captured challenging challenged shaping shaped assessing assessed
  deciding committed planning planned building built verifying verified
  reviewing reviewed releasing released adoption used evaluating evaluated
)

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

# json_object <key> <value> ...: a JSON object of the pairs whose value is
# non-empty, so a caller lists every key it might send and the empties fall
# out. A key written `raw:<name>` says its value is already JSON and is copied
# through unquoted, which is how a ping's `sources` array rides the same
# builder as its two strings.
#
# The comma bookkeeping lives here once. It is a four-line dance that reads as
# trivial and is where a body builder grows its bug, and both fail-soft
# commands were about to keep a copy of it.
json_object() {
  local out="" sep="" key value
  while [ "$#" -ge 2 ]; do
    key=$1
    value=$2
    shift 2
    [ -n "$value" ] || continue
    case "$key" in
      raw:*) out="$out$sep$(json_string "${key#raw:}"):$value" ;;
      *) out="$out$sep$(json_string "$key"):$(json_string "$value")" ;;
    esac
    sep=","
  done
  printf '{%s}' "$out"
}

# call <method> <path> [body] <unreachable-sentence>
#
# The sentence is an argument rather than a variable each command sets, so a
# command cannot reach this function without having said what did not happen.
# A failed read must never claim an ask was not posted, and `post` must keep
# its sentence verbatim: `.claude/JOURNEY.md` quotes it, and a skill standing
# down repeats it to the user.
call() {
  local method=$1 path=$2 body=${3:-} unreachable=$4
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
      echo "$unreachable" >&2
      { [ -s "$err" ] && sed 's/^/  /' "$err" >&2; } || true
      rm -f "$out" "$err"
      exit 5 ;;
  esac
}

# The repository the ping names, derived from the `origin` remote as
# `owner/repo`, which is the only shape the receiver understands.
#
# A hint that names the WRONG address is worse than one that names none: the
# cockpit refetches something nobody asked about, and the change this was rung
# for still waits for the poll. So every step here refuses rather than guesses.
# A remote with no host is a local path or a mirror; a remote with no owner
# segment is not an `owner/repo` at all; and where a forge nests groups, the
# last two segments are the closest thing to the pair the receiver wants.
derive_repository() {
  local remote path owner name
  remote=$(git remote get-url origin 2>/dev/null) || return 0
  remote=${remote%/}
  remote=${remote%.git}
  case "$remote" in
    file://*) return 0 ;;
    *://*)
      path=${remote#*://}
      path=${path#*/}
      ;;
    *:*) path=${remote#*:} ;;
    *) return 0 ;;
  esac
  # No slash left means the URL carried a host and nothing else, or a single
  # segment where an owner and a name were needed.
  case "$path" in
    */*) ;;
    *) return 0 ;;
  esac
  name=${path##*/}
  path=${path%/*}
  owner=${path##*/}
  case "$owner" in "" | *[!A-Za-z0-9._-]*) return 0 ;; esac
  case "$name" in "" | *[!A-Za-z0-9._-]*) return 0 ;; esac
  printf '%s/%s' "$owner" "$name"
}

# The branch the report names, as the checkout has it. A branch is a fact
# about the producer's own working copy, so there is nothing to guess at and
# no reason to make eight call sites pass it; a detached HEAD, or a repository
# with no commit yet, derives none rather than naming something wrong.
derive_branch() {
  local name
  # `symbolic-ref` and not `rev-parse --abbrev-ref`: it answers on a branch
  # that has no commit yet, which a fresh scaffold's first session is on, and
  # it fails rather than printing the word HEAD when the checkout is detached.
  name=$(git symbolic-ref --short HEAD 2>/dev/null) || return 0
  [ -n "$name" ] || return 0
  printf '%s' "$name"
}

# soft_configured <noun>: 0 to go ahead, 1 to stop having said why. Never
# exits, because both callers owe their flow an exit 0 whatever happens here.
soft_configured() {
  local noun=$1
  if [ -z "${BOARD_URL:-}" ] && [ -z "${BOARD_TOKEN:-}" ]; then
    return 1
  fi
  if [ -z "${BOARD_URL:-}" ]; then
    echo "BOARD_URL is not set; $noun not delivered" >&2
    return 1
  fi
  if [ -z "${BOARD_TOKEN:-}" ]; then
    echo "BOARD_TOKEN is not set; $noun not delivered" >&2
    return 1
  fi
  return 0
}

# soft_request <path> <body> [<out>]: the one POST both fail-soft commands
# make, under the soft timeout, printing the status code. curl's own stderr is
# discarded, because "one line" is the contract and neither caller has a fix a
# resolver error would point at: the fix is the two variables, the recipe, or
# nothing at all. The answer's body goes to <out> only for the one caller that
# reads a field of it; a caller assigns 000 when curl itself fails.
soft_request() {
  local path=$1 body=$2 out=${3:-/dev/null}
  curl -s -o "$out" -w '%{http_code}' --max-time "$SOFT_TIMEOUT_SECONDS" \
    -X POST "${BOARD_URL%/}$path" \
    -H "Authorization: Bearer $BOARD_TOKEN" \
    -H "Content-Type: application/json" \
    --data "$body" 2>/dev/null
}

# soft_post <path> <body> <noun>: the fail-soft half of the client. It reads
# the status code and nothing else, so a hostile receiver can influence one
# line on stderr and nothing more. The noun says which command went unheard,
# since one line is the whole budget and a line that does not name its
# command is one a reader has to go looking for.
soft_post() {
  local path=$1 body=$2 noun=$3 code
  code=$(soft_request "$path" "$body") || code=000
  case "$code" in
    2??) ;;
    401 | 403) echo "cockpit rejected the credential ($code); $noun not delivered" >&2 ;;
    4??) echo "cockpit refused the $noun ($code); nothing recorded" >&2 ;;
    *) echo "cockpit unreachable, $noun not delivered" >&2 ;;
  esac
}

# say_once <key> <line>: the line on stderr, unless this session already said
# it under this key. The state lives in the temp directory under the session's
# id, which is unique, so two sessions sharing one /tmp never silence each
# other. A state file that cannot be written costs a repeat, never a silence.
say_once() {
  local key=$1 line=$2 id state
  id=$(printf '%s' "${CLAUDE_CODE_SESSION_ID:-}" | tr -cd 'A-Za-z0-9_-')
  if [ -z "$id" ]; then
    echo "$line" >&2
    return 0
  fi
  state="${TMPDIR:-/tmp}/cockpit-said-$id"
  if [ -f "$state" ] && grep -qxF -- "$key" "$state"; then
    return 0
  fi
  echo "$line" >&2
  printf '%s\n' "$key" >> "$state" 2>/dev/null || true
}

# soft_report <body> <repository>: a report's delivery. soft_post's contract,
# with one difference: a 4xx is said once per session (the header says why).
# The answer's body is read for one fact, whether a 404 is the cockpit's own
# `not_found`, and only to choose between two sentences written here: nothing
# the receiver sends reaches the line.
soft_report() {
  local body=$1 repository=$2 out code cause
  out=$(mktemp)
  code=$(soft_request /api/activity "$body" "$out") || code=000
  case "$code" in
    404)
      if grep -q '"error"[[:space:]]*:[[:space:]]*"not_found"' "$out" 2>/dev/null; then
        cause="no product in the cockpit is configured against $repository (404); pings still land because a refresh accepts any repository. Fix: link $repository to its product in the cockpit"
      else
        cause="this cockpit has no report route (404), so it predates reports. Fix: upgrade the cockpit"
      fi
      ;;
  esac
  rm -f "$out"
  case "$code" in
    2??) ;;
    401 | 403 | 404)
      [ "$code" = 404 ] || cause="the cockpit rejected the credential ($code). Fix: replace BOARD_TOKEN with a current pcb_ agent token"
      say_once "$code $repository" \
        "COCKPIT REPORTS OFF for this session: nothing it reports is recorded, because $cause. Said once; later reports stay silent"
      ;;
    429)
      say_once "$code $repository" \
        "COCKPIT REFUSED A REPORT (429): the cockpit is limiting this credential's rate, so reports are dropped until it lifts. Fix: none in the session; it lifts on its own. Said once; later refusals like it stay silent"
      ;;
    4??)
      say_once "$code $repository" \
        "COCKPIT REFUSED A REPORT ($code): the cockpit would not take what this client sent, most likely a harness and a cockpit that disagree on a report's shape. Fix: run /harness-upgrade, or ask whoever runs the cockpit. Said once; later refusals like it stay silent"
      ;;
    *) echo "cockpit unreachable, report not delivered" >&2 ;;
  esac
}

cmd_ping() {
  local key="" repository="" derived="" sources="" src arg body
  for arg in "$@"; do
    case "$arg" in
      --key=*) key=${arg#--key=} ;;
      --repository=*) repository=${arg#--repository=} ;;
      --source=*)
        src=${arg#--source=}
        case "$src" in
          registry | spec_universe | github | railway | tracker) ;;
          *)
            echo "not a refresh source: $src (registry, spec_universe, github, railway, tracker)" >&2
            exit 2
            ;;
        esac
        sources="$sources${sources:+,}$(json_string "$src")"
        ;;
      *) echo "unknown flag: $arg" >&2; usage; exit 2 ;;
    esac
  done

  # Everything below this line exits 0. The flow that rang has already done
  # its work; this is only how fast somebody else hears about it.
  soft_configured ping || exit 0

  if [ -z "$repository" ]; then
    derived=$(derive_repository) || derived=""
    repository=$derived
  fi

  body=$(json_object \
    repository "$repository" \
    changeKey "$key" \
    raw:sources "${sources:+[$sources]}")

  soft_post /api/refresh "$body" ping
  exit 0
}

cmd_report() {
  local position=${1:-} sentence=${2:-}
  local key="" repository="" branch="" ref="" completes="" arg body

  # The loud gates, before anything reads a credential. A recipe that cannot
  # say where it is or what it is doing is a bug, and the fail-soft path below
  # would bury it. Both positionals also refuse a flag: `report building
  # --key=X` would otherwise file "--key=X" as the sentence and drop the key,
  # which is a swallowed typo wearing a delivered report's clothes.
  case "$position" in
    "" | --*) usage; exit 2 ;;
  esac
  case " ${POSITIONS[*]} " in
    *" $position "*) ;;
    *)
      echo "not a journey position: $position" >&2
      echo "one of: ${POSITIONS[*]}" >&2
      exit 2
      ;;
  esac
  case "$sentence" in
    "" | --*)
      echo "the sentence is empty; a report says in one line what is happening" >&2
      exit 2
      ;;
  esac
  shift 2
  for arg in "$@"; do
    case "$arg" in
      --key=*) key=${arg#--key=} ;;
      --repository=*) repository=${arg#--repository=} ;;
      --branch=*) branch=${arg#--branch=} ;;
      --ref=*) ref=${arg#--ref=} ;;
      --completes=*) completes=${arg#--completes=} ;;
      *) echo "unknown flag: $arg" >&2; usage; exit 2 ;;
    esac
  done

  # Everything below this line exits 0. The seam that reported has already
  # done its work, and a cockpit nobody can reach must not be able to stop it.
  soft_configured report || exit 0

  [ -n "$repository" ] || repository=$(derive_repository) || repository=""
  if [ -z "$repository" ]; then
    # The one field the route cannot do without, and the one this client
    # refuses to guess at: a report filed against the wrong repository is
    # worse than one that never arrives.
    echo "the origin remote does not name owner/repo; report not delivered" >&2
    exit 0
  fi
  [ -n "$branch" ] || branch=$(derive_branch) || branch=""

  body=$(json_object \
    repository "$repository" \
    position "$position" \
    sentence "$sentence" \
    changeKey "$key" \
    branch "$branch" \
    ref "$ref" \
    completes "$completes")

  soft_report "$body" "$repository"
  exit 0
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
    call POST /api/board "$json" "board unreachable, ask not posted"
    ;;
  read)
    require_env
    call GET /api/board "" "board unreachable, board not read"
    ;;
  ping)
    shift
    cmd_ping "$@"
    ;;
  report)
    shift
    cmd_report "$@"
    ;;
  *)
    usage
    exit 2
    ;;
esac
