#!/usr/bin/env bash
# Give this web session a meaningful feature name. Writes the slug to
# .harness-feature, commits, and pushes so the GitHub Action creates
# feature/<slug> and provisions Railway under that name. Run BEFORE the first
# push. Falls back to the random codename if never called.
#
# --no-push commits without pushing, so the next push carries the name. It is
# how a session restores a name it lost after /to-preprod opened its PR: a
# push of its own would be a naming push, which on Railway provisions the
# preview environment the merge path has just torn down, while the recovery
# push that follows it is one provisioning skips.
set -euo pipefail
NO_PUSH=false
if [ "${1:-}" = "--no-push" ]; then
  NO_PUSH=true
  shift
fi
RAW="${1:-}"
if [ -z "$RAW" ]; then
  echo "Usage: set-feature-name.sh [--no-push] <slug>   (e.g. fix-login-seed)" >&2
  exit 2
fi
# 27, not 40. The slug becomes a Railway environment name in the railway
# variant, and Railway refuses environmentCreate well below 40: a
# 34-character name was rejected with a bare "Error in name - Invalid
# input", while 26 and 27 provisioned. 27 is the longest name MEASURED to
# work, and the refusal threshold is only known to sit somewhere in 28..34,
# so anything above 27 would be a guess in an untested band on the one
# path that has to hold with nobody watching. /feature phase 0 also
# prefixes every slug with the lowercase change key, which spends roughly
# eight of them before the description starts, so the budget was tighter
# than 40 either way.
#
# This is the MINTING cap and it is deliberately stricter than the
# validators in resolve-feature-name.sh and the workflows, which still
# accept the older, longer shape. Tightening those too would make a branch
# named before this cap existed fall back to its session codename
# mid-flight, which orphans the branch it already created.
SLUG_MAX=27
# Sanitise first, measure second. Measuring $RAW would announce a truncation
# for any long input, including one the strip below shortens on its own:
# "fix!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!login" is 40 characters and sanitises to
# "fixlogin", which was never truncated at all.
SANITISED="$(printf '%s' "$RAW" \
  | tr '[:upper:]' '[:lower:]' \
  | tr ' _' '--' \
  | sed -E 's/[^a-z0-9-]//g; s/-+/-/g; s/^-+//; s/-+$//')"
SLUG="$(printf '%s' "$SANITISED" | cut -c"1-$SLUG_MAX" | sed -E 's/-+$//')"
if [ "${#SANITISED}" -gt "$SLUG_MAX" ]; then
  echo "Note: the slug is ${#SANITISED} characters; truncated to $SLUG." >&2
  echo "      Railway will not create an environment named longer than $SLUG_MAX." >&2
fi
if ! printf '%s' "$SLUG" | grep -Eq '^[a-z0-9][a-z0-9-]*$'; then
  echo "Could not derive a valid slug from: $RAW" >&2
  exit 1
fi
case "$SLUG" in
  preprod | dev | main | HEAD) echo "Reserved name: $SLUG" >&2; exit 1 ;;
esac
BRANCH="$(git branch --show-current 2>/dev/null || echo "")"
if [[ "$BRANCH" != claude/* ]]; then
  echo "Not on a claude/* session branch (on '$BRANCH'); nothing to do." >&2
  exit 0
fi
if [ -f .harness-feature ] &&
  [ "$(head -n1 .harness-feature | tr -d '[:space:]')" = "$SLUG" ]; then
  echo "Feature name already set to: $SLUG"
  exit 0
fi
# Commit as whoever this session already is, and never write an identity.
# This script used to set user.name and user.email to a bot. That persisted
# in .git/config, so every later commit in the session carried the bot too,
# and so did every `--author="$(git config user.email)"` a skill derived; an
# environment that verifies committers (Claude Code on the web accepts only
# its own) then refused the lot, including commits already pushed. Only when
# git cannot name anyone at all does this supply a name, and only for this
# one command, so nothing outlives the commit.
IDENTITY=()
if ! git var GIT_AUTHOR_IDENT > /dev/null 2>&1 ||
  ! git var GIT_COMMITTER_IDENT > /dev/null 2>&1; then
  IDENTITY=(-c "user.name=claude-code[bot]"
    -c "user.email=claude-code[bot]@users.noreply.github.com")
fi
printf '%s\n' "$SLUG" > .harness-feature
git add .harness-feature
# The ${a[@]+...} spelling keeps an empty array legal under `set -u` on the
# bash 3.2 macOS still ships.
git ${IDENTITY[@]+"${IDENTITY[@]}"} commit -q -m "chore: set feature name ($SLUG)"
if [ "$NO_PUSH" = true ]; then
  echo "Feature name set: $SLUG (committed, not pushed: the next push carries it)"
  exit 0
fi
if git push -u origin "$BRANCH" 2>&1; then
  echo "Feature name set: $SLUG  ->  feature/$SLUG (Railway environment provisioning)"
else
  (
    for delay in 2 4 8; do
      sleep "$delay"
      git push -u origin "$BRANCH" 2>/dev/null && exit 0
    done
  ) &>/dev/null &
  disown 2>/dev/null || true
  echo "Feature name set: $SLUG (push retrying in background)"
fi
