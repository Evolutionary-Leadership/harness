#!/usr/bin/env bash
set -euo pipefail

# Verify that a Railway environment is serving the code that was just
# pushed, not merely answering HTTP.
#
# The app bakes RAILWAY_GIT_COMMIT_SHA into the x-harness-sha response
# header (starter: server.js middleware; foundation: next.config.ts
# headers()). The sha that DEPLOYS is the tip of feature/<name>: the
# GitHub Action merges the claude/ push into the feature branch, so the
# deployed commit is that merge commit, never the local HEAD. This
# script therefore compares the served header against the freshly
# fetched feature-branch tip, re-fetching every attempt in case the
# merge lands mid-poll.
#
# Usage:
#   .claude/scripts/verify-deploy.sh                # feature flow: derive branch, resolve URL
#   .claude/scripts/verify-deploy.sh <url> <sha>    # explicit target (other skills)
#
# Output (stdout, stable lines for the calling skill):
#   deploy-verified: <url> sha=<short>
#   deploy-equivalent: <url> serving=<short> expected=<short>
#   deploy-pending: <url> serving=<short|none>
# Progress goes to stderr. Exit 0 always, so callers never hard-fail.
#
# EQUIVALENCE. Railway rebuilds only when a changed path matches a
# watchPattern in railway.json. A change confined to .claude/ or docs/
# matches none of them, so the environment goes on serving the previous
# commit and a sha compare waits forever for a deploy that will never
# happen. That is not a pending deploy: the running build is the build the
# expected commit would produce. So when the served commit and the expected
# one differ in NO watched path, this reports deploy-equivalent instead of
# polling out, and the caller may treat it as verified.
#
# The patterns are read from railway.json, never copied here, so the two
# cannot drift apart. railway.json itself counts as watched even when its
# patterns do not name it, because a change to the start command alters the
# deploy without rebuilding it.
#
# Equivalence is a claim about two commits producing the same build. It is
# never a way to skip the check: no answer, no served sha, no readable
# patterns, or a commit git cannot resolve all stay pending.

# x 15s = 8 minutes; a first push provisions a whole environment. Both are
# overridable so the poll can be exercised in a test without waiting it out.
ATTEMPTS="${VERIFY_DEPLOY_ATTEMPTS:-32}"
INTERVAL="${VERIFY_DEPLOY_INTERVAL:-15}"

URL="${1:-}"
EXPECTED="${2:-}"
FEATURE_BRANCH=""

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)

if [[ -z "$URL" ]]; then
  BRANCH=$(git branch --show-current 2>/dev/null || echo "")
  if [[ ! "$BRANCH" == claude/* ]]; then
    echo "Not on a claude/ branch and no URL argument given." >&2
    echo "Usage: $0 [<url> <sha>]" >&2
    exit 0
  fi
  FEATURE_NAME=$(bash "$SCRIPT_DIR/resolve-feature-name.sh" "$BRANCH")
  FEATURE_BRANCH="feature/$FEATURE_NAME"
  URL=$(bash "$SCRIPT_DIR/get-railway-url.sh" "$FEATURE_BRANCH")
  if [[ -z "$URL" ]]; then
    echo "deploy-pending: (no-url) serving=none"
    exit 0
  fi
fi

expected_sha() {
  if [[ -n "$EXPECTED" ]]; then
    echo "$EXPECTED"
    return
  fi
  git fetch -q origin "$FEATURE_BRANCH" 2>/dev/null || true
  git rev-parse "origin/$FEATURE_BRANCH" 2>/dev/null || echo ""
}

# Prefix-tolerant compare: either side may be the short form.
sha_match() {
  local a="$1" b="$2"
  [[ -n "$a" && -n "$b" ]] || return 1
  [[ "$a" == "$b"* || "$b" == "$a"* ]]
}

# Every path that differs between two commits, filtered to the watched set.
# Prints nothing when the two builds are equivalent; prints the offending
# paths otherwise. Returns non-zero when the question cannot be answered at
# all, which is never equivalence.
watched_diff() {
  local got="$1" want="$2" config="$SCRIPT_DIR/../../railway.json"
  [[ -f "$config" ]] || return 1
  command -v python3 >/dev/null 2>&1 || return 1

  # mapfile carries its own status, never the process substitution's, so the
  # empty array below is the guard and the exits inside python only shape it.
  local -a patterns
  mapfile -t patterns < <(python3 -c '
import json, sys
try:
    build = json.load(open(sys.argv[1])).get("build", {})
except Exception:
    sys.exit(1)
patterns = build.get("watchPatterns")
if not isinstance(patterns, list) or not patterns:
    sys.exit(1)   # no patterns means every change rebuilds: never equivalent
for p in patterns:
    if isinstance(p, str) and p.strip():
        print(p.strip())
' "$config")
  [[ ${#patterns[@]} -gt 0 ]] || return 1

  # A commit git cannot resolve cannot be diffed. Try one fetch (the feature
  # branch too, since its merge commit is what a preview serves), then give up.
  local sha
  for sha in "$got" "$want"; do
    if ! git cat-file -e "$sha^{commit}" 2>/dev/null; then
      git fetch -q origin main preprod ${FEATURE_BRANCH:+"$FEATURE_BRANCH"} 2>/dev/null || true
      git cat-file -e "$sha^{commit}" 2>/dev/null || return 1
    fi
  done

  # railway.json is watched whether or not it names itself: changing the
  # start command changes the deploy without changing the build.
  local -a spec=(":(glob)railway.json")
  local pattern
  for pattern in "${patterns[@]}"; do
    # A negation would reach git as a literal path and silently WIDEN
    # equivalence, which is the one direction this must never fail in.
    [[ "$pattern" == !* ]] && return 1
    spec+=(":(glob)$pattern")
  done

  git diff --name-only "$got" "$want" -- "${spec[@]}" 2>/dev/null || return 1
}

SEEN="none"
for i in $(seq 1 "$ATTEMPTS"); do
  WANT=$(expected_sha)
  HDRS=$(curl -sfI --max-time 10 "$URL" 2>/dev/null || true)
  if [[ -n "$HDRS" ]] && echo "$HDRS" | grep -qi '^x-harness: live'; then
    GOT=$(echo "$HDRS" | grep -i '^x-harness-sha:' | awk '{print $2}' | tr -d '\r' || true)
    [[ -n "$GOT" ]] && SEEN="$GOT"
    if sha_match "$GOT" "$WANT"; then
      echo "deploy-verified: $URL sha=${GOT:0:7}"
      exit 0
    fi
    if [[ -n "$GOT" && -n "$WANT" ]] && DIFFERS=$(watched_diff "$GOT" "$WANT"); then
      if [[ -z "$DIFFERS" ]]; then
        echo "deploy-equivalent: $URL serving=${GOT:0:7} expected=${WANT:0:7}"
        exit 0
      fi
    fi
  fi
  if (( i % 4 == 0 )); then
    echo "Still waiting for the deploy ($(( i * INTERVAL ))s elapsed; serving: ${SEEN:0:7})..." >&2
  fi
  if (( i < ATTEMPTS )); then sleep "$INTERVAL"; fi
done

echo "deploy-pending: $URL serving=${SEEN:0:7}"
exit 0
