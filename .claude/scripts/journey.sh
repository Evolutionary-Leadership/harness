#!/usr/bin/env bash
# One Bash call per journey write.
#
# A journey write moves the feature's touched-set record to a new position.
# The record lives on the session branch at .harness/journey/<slug>.md while
# the feature is in flight: this script refreshes it there, commits it with
# the sentence in the commit body, and pushes the session branch. The push
# starts journey-sync.yml, which mirrors the record onto the coordination
# branch (features/<slug>.md, `.claude/JOURNEY.md` has the record) and rings
# and reports to the cockpit from the repository's Actions secrets.
#
# That is one tool call for the session, inside the claude.ai sandbox and
# out of it alike: the git proxy lets a session push its own claude/ branch,
# while it refuses the contents-API write this script used to make, which
# cost an MCP call carrying the whole record plus a separate ring. The price
# is 20 to 40 seconds before the cockpit sees a position (a runner start),
# which it polls through anyway.
#
# The file is paths-ignored by the check and feature-merge workflows, so a
# push that carries only a journey commit starts journey-sync.yml and nothing
# else. A push that also carries unpushed code starts what that code starts.
#
# Every command exits 0: a journey write is advisory like every coordination
# write, and a failure is said in one line on stderr, starting `journey:`.
# Nothing is ever printed on stdout for the session to act on.
set -uo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
COORDINATION="$HERE/coordination.sh"
COCKPIT="$HERE/cockpit.sh"
TOUCHED="$HERE/touched-set.mjs"
RESOLVE="$HERE/resolve-feature-name.sh"
BRANCH="${COORDINATION_BRANCH:-coordination}"
REMOTE="${COORDINATION_REMOTE:-origin}"
JOURNEY_DIR=".harness/journey"

# The positions that name work in progress rather than an artefact that
# exists. They are written for the cockpit's in-progress edge, and where no
# cockpit reads them they are dropped from a write unless --all says
# otherwise: a record nobody polls need not say "shaping" before "shaped".
TRANSITIONS="challenging shaping assessing deciding planning building verifying reviewing releasing evaluating"

usage() {
  cat >&2 <<'USAGE'
usage: journey.sh <command> [args]

  phase <pos>[,<pos>...] "<sentence>" [--size=S|M|L] [--all] [--no-push]
                            Move the record to the last position given,
                            appending every one to its history; commit
                            .harness/journey/<slug>.md with the sentence in
                            the body and push the session branch.
                            Transition positions (challenging, shaping, ...,
                            evaluating) are dropped unless a cockpit is
                            configured or --all is passed; states are always
                            written. --size records the tier. --no-push
                            leaves the commit for the next push to carry.

  declare <record file> [--no-push]
                            Capture: the rendered record becomes the journey
                            file, committed and pushed like a phase.

  retire                    Stage the journey file's deletion, for the
                            /to-preprod signal commit to carry; its push is
                            what removes the coordination record.

  --help                    This text.

Every command exits 0, having said any failure in one `journey:` line.
USAGE
}

say() {
  echo "journey: $*" >&2
}

slug_and_branch() {
  BRANCH_NAME=$(git branch --show-current 2>/dev/null || true)
  SLUG=$(bash "$RESOLVE" "$BRANCH_NAME" 2>/dev/null || true)
  [ -n "$SLUG" ] || { say "cannot resolve the feature slug on branch ${BRANCH_NAME:-(none)}"; return 1; }
  RECORD_PATH="features/$SLUG.md"
  JOURNEY_FILE="$JOURNEY_DIR/$SLUG.md"
}

# Exit 0 means a cockpit is configured. Any other answer, including a
# cockpit.sh that does not know the subcommand, means none is.
cockpit_configured() {
  bash "$COCKPIT" configured >/dev/null 2>&1
}

# The positions the journey has, read from the one list that owns them.
known_positions() {
  node --input-type=module -e '
    const { pathToFileURL } = await import("node:url");
    const { POSITIONS } = await import(pathToFileURL(process.argv[1]).href);
    process.stdout.write(POSITIONS.join("\n") + "\n");
  ' "$TOUCHED" 2>/dev/null
}

is_transition() {
  case " $TRANSITIONS " in
    *" $1 "*) return 0 ;;
  esac
  return 1
}

# Once per session, keyed like cockpit.sh's marker: by the repository path,
# so two checkouts sharing one temp directory do not silence each other, and
# by the session id where Claude Code gives one.
states_only_marker() {
  local repo id
  repo=$(git rev-parse --show-toplevel 2>/dev/null) || repo=$PWD
  id=$(printf '%s' "${CLAUDE_CODE_SESSION_ID:-}" | tr -cd 'A-Za-z0-9_-')
  printf '%s/journey-states-only-%s' "${TMPDIR:-/tmp}" \
    "$(printf '%s\n%s' "$repo" "$id" | cksum | cut -d' ' -f1)"
}

say_states_only_once() {
  local marker
  marker=$(states_only_marker)
  [ -f "$marker" ] && return 0
  say "states only (no cockpit)"
  : > "$marker" 2>/dev/null || true
}

# Read the record: whichever of the journey file on this branch and the
# coordination copy is newer by `updated_at`. The branch file is usually the
# newer (journey-sync.yml may not have mirrored the last push yet), but a
# resumed session that merged feature/<name> can hold an older one: a
# journey-only push reaches the feature branch only with the next push that
# carries anything else, while journey-sync.yml has already mirrored it.
# Taking the newer keeps the `phases` history whole. Sets RECORD.
read_record() {
  local mine="" theirs="" mine_at="" theirs_at=""
  [ -f "$JOURNEY_FILE" ] && mine=$(cat "$JOURNEY_FILE")
  bash "$COORDINATION" fetch
  theirs=$(git show "$REMOTE/$BRANCH:$RECORD_PATH" 2>/dev/null) || theirs=""
  mine_at=$(printf '%s\n' "$mine" | sed -n 's/^updated_at: *//p' | head -n 1)
  theirs_at=$(printf '%s\n' "$theirs" | sed -n 's/^updated_at: *//p' | head -n 1)
  if [ -n "$mine" ] && { [ -z "$theirs" ] || [[ ! "$theirs_at" > "$mine_at" ]]; }; then
    RECORD=$mine
  else
    RECORD=$theirs
  fi
  [ -n "$RECORD" ] || { say "no record at $JOURNEY_FILE or $RECORD_PATH on $BRANCH; nothing written"; return 1; }
}

# commit_file <message> <sentence>: commit the journey file alone, whatever
# else is staged, as whoever the session is (the same identity fallback
# set-feature-name.sh uses when git can name nobody).
commit_file() {
  local message=$1 sentence=$2
  local -a ident=()
  if ! git var GIT_AUTHOR_IDENT >/dev/null 2>&1 || ! git var GIT_COMMITTER_IDENT >/dev/null 2>&1; then
    ident=(-c user.name=Claude -c user.email=noreply@anthropic.com)
  fi
  git add -- "$JOURNEY_FILE" 2>/dev/null || { say "cannot stage $JOURNEY_FILE"; return 1; }
  if git diff --cached --quiet -- "$JOURNEY_FILE"; then
    say "$JOURNEY_FILE unchanged; nothing to commit"
    return 1
  fi
  # ${ident[@]+...}: an empty array under set -u is an error on bash 3.2.
  git ${ident[@]+"${ident[@]}"} commit -q -m "$message" -m "$sentence" -- "$JOURNEY_FILE" >/dev/null 2>&1 \
    || { say "commit of $JOURNEY_FILE failed"; return 1; }
}

# push_branch: the session branch, which is the one ref the git proxy lets a
# session write. A failed push leaves the commit for the next push.
push_branch() {
  case "$BRANCH_NAME" in
    claude/*) ;;
    *) say "not on a claude/ branch ($BRANCH_NAME); committed, not pushed"; return 0 ;;
  esac
  git push -q -u "$REMOTE" "HEAD:refs/heads/$BRANCH_NAME" >/dev/null 2>&1 \
    || say "push of $BRANCH_NAME failed; the commit rides the next push"
}

cmd_phase() {
  local list="${1-}" sentence="${2-}" size="" all="" push=1 arg known pos kept last tmp next

  if [ -z "$list" ] || [ -z "$sentence" ]; then usage; return 0; fi
  shift 2
  for arg in "$@"; do
    case "$arg" in
      --size=*) size=${arg#--size=} ;;
      --all) all=1 ;;
      --no-push) push="" ;;
      *) say "unknown flag: $arg"; return 0 ;;
    esac
  done
  case "$size" in
    "" | S | M | L) ;;
    *) say "size is not a tier (S, M or L): $size"; return 0 ;;
  esac

  known=$(known_positions)
  [ -n "$known" ] || { say "cannot read the journey positions from touched-set.mjs"; return 0; }
  kept=""
  for pos in $(printf '%s' "$list" | tr ',' ' '); do
    printf '%s\n' "$known" | grep -qxF -- "$pos" || { say "not a journey position: $pos"; return 0; }
    kept="$kept $pos"
  done

  if [ -z "$all" ] && ! cockpit_configured; then
    say_states_only_once
    list=""
    for pos in $kept; do
      is_transition "$pos" || list="$list${list:+,}$pos"
    done
    [ -n "$list" ] || return 0
  else
    list=$(printf '%s\n' $kept | paste -sd, -)
  fi
  last=${list##*,}

  slug_and_branch || return 0
  read_record || return 0

  tmp=$(mktemp -d "${TMPDIR:-/tmp}/journey.XXXXXX") || { say "cannot create a temp directory"; return 0; }
  printf '%s\n' "$RECORD" > "$tmp/mine.md"
  next="$tmp/next.md"
  if [ -n "$size" ]; then
    node "$TOUCHED" refresh --from="$tmp/mine.md" --phase="$list" --size="$size" > "$next" 2> "$tmp/err"
  else
    node "$TOUCHED" refresh --from="$tmp/mine.md" --phase="$list" > "$next" 2> "$tmp/err"
  fi
  if [ ! -s "$next" ]; then
    say "record not refreshed: $(head -n 1 "$tmp/err" 2>/dev/null)"
    rm -rf "$tmp"
    return 0
  fi
  mkdir -p "$JOURNEY_DIR" && cp "$next" "$JOURNEY_FILE"
  rm -rf "$tmp"

  commit_file "chore(journey): $SLUG at $last" "$sentence" || return 0
  [ -n "$push" ] && push_branch
  return 0
}

cmd_declare() {
  local from="${1-}" push=1 arg
  [ -n "$from" ] || { usage; return 0; }
  shift
  for arg in "$@"; do
    case "$arg" in
      --no-push) push="" ;;
      *) say "unknown flag: $arg"; return 0 ;;
    esac
  done
  [ -s "$from" ] || { say "no record at $from; nothing declared"; return 0; }
  slug_and_branch || return 0
  mkdir -p "$JOURNEY_DIR" && cp "$from" "$JOURNEY_FILE" || { say "cannot write $JOURNEY_FILE"; return 0; }
  commit_file "chore(journey): $SLUG at captured" "captured: the touched set is declared" || return 0
  [ -n "$push" ] && push_branch
  return 0
}

cmd_retire() {
  slug_and_branch || return 0
  if [ ! -f "$JOURNEY_FILE" ] && ! git ls-files --error-unmatch -- "$JOURNEY_FILE" >/dev/null 2>&1; then
    say "no $JOURNEY_FILE on this branch; a coordination record, if any, is swept by the next /feature session"
    return 0
  fi
  # -f: a record widened in place and never committed must still go; a
  # refusal here would let the file ride the merge onto preprod.
  git rm -q -f --ignore-unmatch -- "$JOURNEY_FILE" >/dev/null 2>&1 \
    || { say "cannot stage the deletion of $JOURNEY_FILE"; return 0; }
  return 0
}

case "${1-}" in
  phase)               shift; cmd_phase "$@" ;;
  declare)             shift; cmd_declare "$@" ;;
  retire)              shift; cmd_retire "$@" ;;
  -h | --help | help)  usage; exit 0 ;;
  "")                  usage; exit 0 ;;
  *)                   say "unknown command: $1"; usage; exit 0 ;;
esac
