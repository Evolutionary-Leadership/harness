#!/usr/bin/env bash
# Mirror a session's journey file onto the coordination branch, then ring
# and report to the cockpit. Run by journey-sync.yml on a push to claude/**
# that touches .harness/journey/, from a checkout of the pushed commit.
#
# The session wrote the record with `journey.sh phase` (one commit, one
# push); this is the other half, so the session never makes a contents-API
# or MCP write for a position.
#
#   .harness/journey/<slug>.md present  write it to features/<slug>.md on
#                                       coordination when it differs, then
#                                       ping and report the new position
#   absent (retired by /to-preprod)     delete features/<slug>.md
#
# The sentence is the body of the newest commit that touched the file. The
# write is a git push under the workflow's token, retried against a moving
# coordination branch (key mints, ADR claims and other features write it
# too). Exit 1 only when that push still fails after the retries, so a
# record that did not land shows as a red run; everything else exits 0.
#
# Environment: COORDINATION_BRANCH (default coordination), COORDINATION_REMOTE
# (default origin), JOURNEY_BRANCH (default: $GITHUB_REF_NAME, else the
# checked-out branch), and the cockpit's BOARD_URL and BOARD_TOKEN, which
# cockpit.sh reads itself and which may be absent.
set -uo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
COCKPIT="$HERE/cockpit.sh"
RESOLVE="$HERE/resolve-feature-name.sh"
BRANCH="${COORDINATION_BRANCH:-coordination}"
REMOTE="${COORDINATION_REMOTE:-origin}"
SESSION_BRANCH="${JOURNEY_BRANCH:-${GITHUB_REF_NAME:-$(git branch --show-current 2>/dev/null)}}"
ATTEMPTS="${JOURNEY_SYNC_ATTEMPTS:-5}"

say() { echo "journey-sync: $*" >&2; }

SLUG=$(bash "$RESOLVE" "$SESSION_BRANCH" 2>/dev/null || true)
[ -n "$SLUG" ] || { say "cannot resolve the feature slug for $SESSION_BRANCH"; exit 0; }
FILE=".harness/journey/$SLUG.md"
RECORD_PATH="features/$SLUG.md"
SOURCE=$(pwd)

if [ -f "$FILE" ]; then
  MODE=write
  # The sentence is the body of the newest journey commit, not of whatever
  # commit last touched the file (a context commit can carry a widened
  # record with a body that means something else).
  SENTENCE=$(git log -1 --grep='^chore(journey):' --format=%b -- "$FILE" 2>/dev/null | sed '/^$/d' | head -n 1)
  POSITION=$(sed -n 's/^phase: *//p' "$FILE" | head -n 1)
  KEY=$(sed -n 's/^key: *//p' "$FILE" | head -n 1 | tr -d '"[:space:]')
  [ -n "$SENTENCE" ] || SENTENCE="$SLUG at $POSITION"
else
  # Absent is a retirement only when this branch's history removed it: a
  # push that touched some other journey path (sweeping another feature's
  # leaked file, a merge from preprod) must not delete this feature's live
  # record, which may exist only on coordination.
  last=$(git log -1 --format=%H -- "$FILE" 2>/dev/null)
  removed=$(git log -1 --diff-filter=D --format=%H -- "$FILE" 2>/dev/null)
  if [ -z "$last" ] || [ "$last" != "$removed" ]; then
    say "$FILE is not on this branch and was not removed by it; nothing to do"
    exit 0
  fi
  MODE=delete
fi

WORK=$(mktemp -d "${TMPDIR:-/tmp}/journey-sync.XXXXXX")
cleanup() { git -C "$SOURCE" worktree remove --force "$WORK/tree" >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT

# apply: make the coordination tree say what the session branch says.
# Prints "changed" or "same". Runs inside the worktree.
apply() {
  if [ "$MODE" = write ]; then
    mkdir -p features
    if [ -f "$RECORD_PATH" ] && cmp -s "$SOURCE/$FILE" "$RECORD_PATH"; then echo same; return; fi
    cp "$SOURCE/$FILE" "$RECORD_PATH"
    git add -- "$RECORD_PATH"
  else
    [ -f "$RECORD_PATH" ] || { echo same; return; }
    git rm -q -- "$RECORD_PATH"
  fi
  echo changed
}

landed=""
for attempt in $(seq 1 "$ATTEMPTS"); do
  if ! git fetch -q "$REMOTE" "$BRANCH" 2>/dev/null; then
    say "cannot fetch $BRANCH; nothing mirrored"
    # A first-attempt failure mirrored nothing and changed nothing; after a
    # refused push it means the record did not land, which must show red.
    [ "$attempt" -eq 1 ] && exit 0
    exit 1
  fi
  git worktree remove --force "$WORK/tree" >/dev/null 2>&1 || true
  git worktree add -q --detach "$WORK/tree" "$REMOTE/$BRANCH" >/dev/null 2>&1 \
    || { say "cannot check out $BRANCH"; exit 0; }
  state=$(cd "$WORK/tree" && apply)
  if [ "$state" = same ]; then
    say "$RECORD_PATH already says what $FILE says; nothing to do"
    exit 0
  fi
  if [ "$MODE" = write ]; then message="journey: $SLUG at $POSITION"; else message="journey: $SLUG retired at the merge"; fi
  (
    cd "$WORK/tree" &&
    git -c user.name="github-actions[bot]" -c user.email="41898282+github-actions[bot]@users.noreply.github.com" \
      commit -q -m "$message" &&
    git push -q "$REMOTE" "HEAD:refs/heads/$BRANCH"
  ) >/dev/null 2>&1 && { landed=1; break; }
  say "push to $BRANCH refused (attempt $attempt of $ATTEMPTS)"
  [ "$attempt" -lt "$ATTEMPTS" ] && sleep "$attempt"
done

if [ -z "$landed" ]; then
  say "$RECORD_PATH did not land on $BRANCH after $ATTEMPTS attempts"
  exit 1
fi

if [ "$MODE" = delete ]; then
  say "$RECORD_PATH retired"
  exit 0
fi
say "$RECORD_PATH at $POSITION"

# The ring after the write, never before: the ping says where to look, so a
# ring that went first would send the cockpit to the old position.
if bash "$COCKPIT" configured; then
  if [ -n "$KEY" ]; then
    bash "$COCKPIT" ping --key="$KEY" || true
    bash "$COCKPIT" report "$POSITION" "$SENTENCE" --key="$KEY" || true
  else
    bash "$COCKPIT" ping || true
    bash "$COCKPIT" report "$POSITION" "$SENTENCE" || true
  fi
fi
exit 0
