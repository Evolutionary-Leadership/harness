#!/usr/bin/env bash
# setup.sh: the deterministic spine of the one-shot /setup skill.
#
# The /setup skill (.claude/skills/setup/SKILL.md) owns the questions and
# the handoff prose; every step that needs no human judgment lives here.
# Three subcommands:
#
#   setup.sh guard
#       Read-only. Classifies the repository's setup state so the skill
#       knows which questions to ask BEFORE anything fires:
#       configured | fresh | half-applied | retry-after-failed-preflight.
#       Never mutates anything (a quiet fetch of origin/preprod aside).
#
#   setup.sh prepare [--railway yes|no|unknown] [--poll-only]
#       Verifies the template sync landed, guarantees the three branches
#       (dispatching harness-bootstrap.yml via a sentinel push when they
#       are missing), and, when --railway yes, runs the secrets preflight
#       (harness-preflight.yml) and parses its result commit: the verdict
#       and every workspace line. With --railway unknown or no, the
#       preflight is skipped; if the railway answer later turns out yes,
#       run prepare again with --railway yes (it is idempotent: the
#       branch wait short-circuits and only the preflight runs).
#       --poll-only skips the dispatch pushes, for an agent that already
#       dispatched the workflows through the GitHub MCP server.
#
#   setup.sh apply --railway yes|no --foundation yes|no --mcp yes|no \
#                  [--workspace <id>] [--first-time yes|no]
#       Applies the chosen configuration: quarantine copies, the one
#       package.json name substitution, the .harness-version rewrite,
#       the self-delete (this script included), the provisioning
#       sentinel, the single configuration commit pushed to preprod, the
#       provisioning watch, and the liveness check. On the foundation
#       path the verify chain runs CONCURRENTLY with the provisioning
#       watch: the payload ships forge-verified, so the local chain
#       mostly validates the local toolchain and overlaps the wait
#       instead of preceding the push (forge decision record 0022).
#       --first-time drives nothing; it is echoed back in the status so
#       the skill can branch its handoff without remembering.
#
# Every exit prints a status block the invoking agent parses:
#
#   --- setup-status ---
#   phase: <guard|prepare|apply>
#   outcome: <see the subcommands>
#   ...key: value detail lines...
#   --- end setup-status ---
#
# Exit code 0 means the phase completed (the block may still carry
# non-fatal notes). Non-zero means the agent takes over: the block
# carries what it needs to recover without re-deriving anything.
#
# PARSED CONTRACTS. The literals below pair with harness-railway.yml,
# harness-preflight.yml and harness-bootstrap.yml (forge decision
# records 0004, 0007, 0009, 0010). The forge's
# scripts/check-template-overlay.mjs reads these assignments and their
# usage sites and fails its merge gate when either side drifts. Change
# them only together with the workflows.
BOOTSTRAP_SENTINEL=".harness-bootstrap"
PREFLIGHT_SENTINEL=".harness-preflight"
PREFLIGHT_SUBJECT="chore: harness preflight result"
CLEANUP_SUBJECT="chore: remove harness bootstrap files (one-time use)"
FOUNDATION_KEY="foundation: "
WORKSPACE_KEY="workspace: "

set -uo pipefail

# ---------------------------------------------------------------- plumbing

# Poll budgets in seconds, overridable for tests. The totals match the
# attempt-count budgets the /setup skill used before the spine moved here.
BRANCH_BUDGET="${SETUP_BRANCH_BUDGET:-60}"
PREFLIGHT_BUDGET="${SETUP_PREFLIGHT_BUDGET:-200}"
PROVISION_BUDGET="${SETUP_PROVISION_BUDGET:-360}"
LIVENESS_BUDGET="${SETUP_LIVENESS_BUDGET:-180}"
# Percentage applied to real sleeps; tests set 0 to run a whole poll
# schedule instantly while the budget arithmetic stays intact.
POLL_SCALE="${SETUP_POLL_SCALE:-100}"

PHASE="none"
STATUS_LINES=""
PUSH_LAST_ERROR=""

status_add() {
  # status_add <key> <value...>
  local key="$1"; shift
  STATUS_LINES="${STATUS_LINES}${key}: $*
"
}

status_lines_verbatim() {
  # status_lines_verbatim <text>: appends lines that are already in
  # key: value shape (probe results, workspace lines) untouched.
  [ -n "$1" ] || return 0
  STATUS_LINES="${STATUS_LINES}$1
"
}

finish() {
  # finish <outcome> <exit-code>
  printf -- '--- setup-status ---\n'
  printf 'phase: %s\n' "$PHASE"
  printf 'outcome: %s\n' "$1"
  printf '%s' "$STATUS_LINES"
  printf -- '--- end setup-status ---\n'
  exit "$2"
}

say() { printf '%s\n' "$*"; }

# need_value <flag> <argc>: a flag given without its value must land in
# invalid-arguments, not spin the parse loop (shift 2 on one remaining
# argument shifts nothing).
need_value() {
  if [ "$2" -lt 2 ]; then
    status_add "detail" "$1 needs a value"
    finish "invalid-arguments" 1
  fi
}

# The probe lines a preflight result body carries, and its verdict.
probe_lines() {
  printf '%s\n' "$1" | grep '^railway-token: \|^pat-secrets: \|^pat-workflows: ' || true
}
verdict_of() {
  printf '%s\n' "$1" | grep '^preflight: ' | head -1 | sed 's/^preflight: //'
}

do_sleep() {
  local s=$(( $1 * POLL_SCALE / 100 ))
  [ "$s" -gt 0 ] && sleep "$s"
  return 0
}

# poll <budget-seconds> <command...>: runs the command until it succeeds
# or the budget is spent. Progressive backoff: 2s, 3s, 5s, 8s, then 15s
# per tick. The first attempt is immediate, so a state that is already
# true costs nothing.
poll() {
  local budget="$1"; shift
  local spent=0 i=0 d
  while true; do
    if "$@"; then return 0; fi
    case "$i" in
      0) d=2 ;; 1) d=3 ;; 2) d=5 ;; 3) d=8 ;; *) d=15 ;;
    esac
    i=$((i + 1))
    if [ $((spent + d)) -gt "$budget" ]; then return 1; fi
    spent=$((spent + d))
    do_sleep "$d"
  done
}

utc_now() { date -u +%Y-%m-%dT%H:%M:%SZ; }

git_quiet_fetch_preprod() { git fetch -q origin preprod 2>/dev/null || true; }

remote_branch_exists() {
  git ls-remote --exit-code --heads origin "$1" >/dev/null 2>&1
}

# The newest commit on origin/preprod whose subject is exactly $1:
# sha to stdout, empty when none. git's --grep matches per line over the
# whole message, so anchor it; the subjects hold no basic-regex
# metacharacters (parentheses are literal there).
newest_subject_sha() {
  git log origin/preprod -1 --format='%H' --grep="^$1\$" 2>/dev/null || true
}

body_of() { git show -s --format='%b' "$1" 2>/dev/null || true; }

# push_preprod: pushes HEAD to preprod, absorbing a moving remote. Any
# concurrent push (a workflow's sentinel-clear, a result commit) makes a
# plain push non-fast-forward, so between attempts fetch and rebase the
# local branch onto origin/preprod, then try again.
push_preprod() {
  local attempt out
  for attempt in 1 2 3 4; do
    if out=$(git push origin HEAD:preprod 2>&1); then return 0; fi
    PUSH_LAST_ERROR=$(printf '%s' "$out" | tail -3 | tr '\n' ' ')
    git_quiet_fetch_preprod
    if ! git rebase -q origin/preprod >/dev/null 2>&1; then
      git rebase --abort >/dev/null 2>&1 || true
    fi
    do_sleep $((attempt * 2))
  done
  return 1
}

repo_slug() {
  # owner/repo from the origin URL, empty when it cannot be derived
  # (tests use filesystem remotes).
  local url slug
  url=$(git remote get-url origin 2>/dev/null || true)
  slug=$(printf '%s' "$url" | sed -E 's#^(git@[^:/]+:|[a-z+]+://[^/]+/)##; s#\.git$##')
  case "$slug" in
    */*) printf '%s' "$slug" ;;
    *) printf '' ;;
  esac
}

actions_url() {
  local slug
  slug=$(repo_slug)
  if [ -n "$slug" ]; then
    printf 'https://github.com/%s/actions/workflows/%s' "$slug" "$1"
  else
    printf '(origin is not a github.com URL; open the Actions tab by hand)'
  fi
}

# ------------------------------------------------------------------ guard

# Read-only classification. Emits the state and, per state, what the
# skill needs to act on it. Also reused by prepare and apply as their
# own precondition check.
guard_state=""
guard_classify() {
  git_quiet_fetch_preprod

  if [ ! -d .claude/setup ]; then
    # The quarantine is gone: either the repo is configured, or a
    # configuration commit exists locally and never reached preprod.
    if git rev-parse --verify -q origin/preprod >/dev/null 2>&1 \
      && [ -n "$(git log origin/preprod..HEAD --oneline 2>/dev/null)" ] \
      && git diff --name-only origin/preprod..HEAD 2>/dev/null | grep -q '^\.claude/setup/'; then
      guard_state="half-applied"
      status_add "unpushed-config-commit" "yes"
      status_add "detail" "a configuration commit exists locally but is not on origin/preprod; push HEAD:preprod to finish"
      return 0
    fi
    guard_state="configured"
    return 0
  fi

  local inferred_railway=no inferred_foundation=no inferred_mcp=no
  [ -f .github/workflows/harness-railway.yml ] && inferred_railway=yes
  [ -f next.config.ts ] && inferred_foundation=yes
  [ -f src/app/api/mcp/route.ts ] && inferred_mcp=yes

  local variant_rewritten=no
  if [ -f .harness-version ] && ! head -1 .harness-version | grep -qx 'harness: unconfigured'; then
    variant_rewritten=yes
  fi

  if [ "$inferred_railway" = yes ] || [ "$inferred_foundation" = yes ] \
    || [ "$inferred_mcp" = yes ] || [ "$variant_rewritten" = yes ]; then
    guard_state="half-applied"
    status_add "inferred-railway" "$inferred_railway"
    status_add "inferred-foundation" "$inferred_foundation"
    status_add "inferred-mcp" "$inferred_mcp"
    status_add "variant-line-rewritten" "$variant_rewritten"
    status_add "detail" "a previous /setup was interrupted mid-apply; infer the answers above, do not re-ask them, and rerun apply with those answers (apply is idempotent)"
    return 0
  fi

  # A clean, unapplied tree whose newest preflight result says fail is
  # the documented retry path: the user fixed a token and reran /setup.
  if [ -z "$(git status --porcelain 2>/dev/null)" ]; then
    local sha body verdict probes
    sha=$(newest_subject_sha "$PREFLIGHT_SUBJECT")
    if [ -n "$sha" ]; then
      body=$(body_of "$sha")
      verdict=$(verdict_of "$body")
      if [ "$verdict" = "fail" ]; then
        guard_state="retry-after-failed-preflight"
        probes=$(probe_lines "$body")
        status_lines_verbatim "$probes"
        return 0
      fi
    fi
  fi

  guard_state="fresh"
  return 0
}

cmd_guard() {
  PHASE="guard"
  guard_classify
  finish "$guard_state" 0
}

# ---------------------------------------------------------------- prepare

verify_sync() {
  # The template sync must have delivered the tree; never recreate
  # missing files by hand, they come from the sync or not at all.
  local missing="" f
  for f in \
    .github/workflows/claude-to-feature-branch.yml \
    .github/workflows/harness-bootstrap.yml \
    .claude/settings.json \
    .claude/skills/to-preprod/SKILL.md \
    .harness-version \
    .claude/setup/railway/.github/workflows/harness-railway.yml \
    .claude/setup/foundation/package.json \
    .claude/setup/mcp/src/app/api/mcp/route.ts \
  ; do
    [ -e "$f" ] || missing="$missing $f"
  done
  if [ -n "$missing" ]; then
    local m
    for m in $missing; do status_add "missing" "$m"; done
    status_add "detail" "the template sync did not deliver these files; report an upstream sync bug and stop, never recreate them by hand"
    return 1
  fi
  return 0
}

branches_ready() {
  remote_branch_exists main && remote_branch_exists coordination
}

dispatch_by_sentinel() {
  # dispatch_by_sentinel <file> <subject>: a push touching the sentinel
  # path fires the matching workflow. /setup sessions always have a
  # shell and a clone (docs/setup-prompt.md), so this dispatch works
  # everywhere the skill is supported, with no MCP dependency; the
  # --poll-only escape exists for an agent that dispatched via MCP.
  local file="$1" subject="$2"
  utc_now > "$file"
  git add "$file"
  git commit -q -m "$subject"
  push_preprod
}

preflight_result_sha=""
run_preflight() {
  # Dispatches harness-preflight.yml and waits for a result commit NEWER
  # than whatever result already sits on preprod: a retry leaves the old
  # fail result there, and matching the newest subject alone would read
  # the stale verdict the instant polling starts.
  #
  # Under --poll-only the dispatch happened outside this invocation, so
  # "newer than what this run saw first" would misread a fast workflow's
  # fresh result as stale. The dispatch-failed status hands the agent
  # the then-newest result sha as stale-result:, and --stale-result
  # passes it back; empty means any result is acceptable.
  local pre_sha
  git_quiet_fetch_preprod
  if [ "$POLL_ONLY" = yes ]; then
    pre_sha="$STALE_RESULT"
  else
    pre_sha=$(newest_subject_sha "$PREFLIGHT_SUBJECT")
  fi

  # A passing preflight deletes its own workflow file, so an absent file
  # plus a passing result is settled state: reuse the result rather than
  # dispatching a workflow that no longer exists.
  if [ ! -f .github/workflows/harness-preflight.yml ]; then
    if [ -n "$pre_sha" ] && body_of "$pre_sha" | grep -q '^preflight: pass'; then
      preflight_result_sha="$pre_sha"
      status_add "preflight-reused" "yes"
      return 0
    fi
    status_add "detail" "harness-preflight.yml is not in the tree and no passing result exists on preprod; the template sync is incomplete or the workflow was removed by hand"
    return 1
  fi

  if [ "$POLL_ONLY" != yes ]; then
    say "Dispatching the secrets preflight (about a minute)..."
    if ! dispatch_by_sentinel "$PREFLIGHT_SENTINEL" "chore: fire harness preflight"; then
      status_add "push-error" "$PUSH_LAST_ERROR"
      status_add "stale-result" "${pre_sha:-none}"
      status_add "detail" "could not push the ${PREFLIGHT_SENTINEL} sentinel to preprod; dispatch harness-preflight.yml via the GitHub MCP tool actions_run_trigger (ref preprod) instead, then rerun prepare with --poll-only (append --stale-result with the sha above when it is not none, so the poll waits out the result that already sat on preprod)"
      return 1
    fi
  fi

  preflight_done() {
    git_quiet_fetch_preprod
    local sha
    sha=$(newest_subject_sha "$PREFLIGHT_SUBJECT")
    [ -n "$sha" ] && [ "$sha" != "$pre_sha" ]
  }
  if ! poll "$PREFLIGHT_BUDGET" preflight_done; then
    status_add "run-url" "$(actions_url harness-preflight.yml)"
    status_add "detail" "no preflight result commit appeared on preprod within the budget; known causes: PAT_TOKEN lacking Contents: Read and write (the workflow cannot push its result), or Actions disabled on the repository"
    return 1
  fi
  preflight_result_sha=$(newest_subject_sha "$PREFLIGHT_SUBJECT")
  return 0
}

cmd_prepare() {
  PHASE="prepare"
  local RAILWAY="unknown" POLL_ONLY=no STALE_RESULT=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --railway) need_value --railway $#; RAILWAY="$2"; shift 2 ;;
      --poll-only) POLL_ONLY=yes; shift ;;
      --stale-result) need_value --stale-result $#; STALE_RESULT="$2"; shift 2 ;;
      *) status_add "detail" "unknown argument: $1"; finish "invalid-arguments" 1 ;;
    esac
  done
  case "$RAILWAY" in yes|no|unknown) ;; *)
    status_add "detail" "--railway must be yes, no or unknown"
    finish "invalid-arguments" 1 ;;
  esac

  guard_classify
  case "$guard_state" in
    configured)
      status_add "detail" "this repository is already configured; there is nothing for /setup to do"
      finish "configured" 1 ;;
    half-applied)
      finish "half-applied" 1 ;;
    retry-after-failed-preflight)
      # A preflight only ever ran on the railway path, so the retry
      # settles the answer. Drop the stale probe lines the guard quoted:
      # this run reports its own preflight, and last run's failures next
      # to a fresh pass would only mislead the reader.
      STATUS_LINES=""
      RAILWAY="yes"
      status_add "retry" "yes" ;;
  esac
  status_add "railway" "$RAILWAY"

  if ! verify_sync; then finish "sync-missing" 1; fi

  # Bring the local branch up to the remote before committing sentinels
  # on top of it (a fresh clone is a no-op; a stale one would make every
  # push non-fast-forward on the first try).
  git_quiet_fetch_preprod
  if git rev-parse --verify -q origin/preprod >/dev/null 2>&1; then
    if ! git rebase -q origin/preprod >/dev/null 2>&1; then
      git rebase --abort >/dev/null 2>&1 || true
    fi
  fi

  # The three branches. preprod is the scaffold's default and always
  # exists; harness-bootstrap.yml guarantees main and the orphan
  # coordination branch, and is idempotent.
  if branches_ready; then
    status_add "branches" "present"
  else
    if [ "$POLL_ONLY" != yes ]; then
      say "Dispatching the branch bootstrap..."
      if ! dispatch_by_sentinel "$BOOTSTRAP_SENTINEL" "chore: fire harness bootstrap"; then
        status_add "push-error" "$PUSH_LAST_ERROR"
        status_add "detail" "could not push the ${BOOTSTRAP_SENTINEL} sentinel to preprod; dispatch harness-bootstrap.yml via the GitHub MCP tool actions_run_trigger (ref preprod) instead, then rerun prepare with --poll-only"
        finish "dispatch-failed" 1
      fi
    fi
    if poll "$BRANCH_BUDGET" branches_ready; then
      status_add "branches" "created"
    else
      # Setup does not depend on the branches; the first ADR and the
      # first release do. Note it and continue, exactly as before.
      status_add "branches" "timeout"
      status_add "branches-note" "main or coordination did not appear within the budget; setup continues, but mention it in one line (dispatch harness-bootstrap.yml again later if a branch stays missing)"
    fi
  fi

  if [ "$RAILWAY" = "yes" ]; then
    if ! run_preflight; then finish "preflight-timeout" 1; fi
    local body verdict
    body=$(body_of "$preflight_result_sha")
    verdict=$(verdict_of "$body")
    status_add "preflight" "$verdict"
    if [ "$verdict" = "pass" ]; then
      # On pass the result commit deleted the preflight workflow file
      # and any sentinel on preprod; sync the local branch with that.
      git_quiet_fetch_preprod
      git merge -q origin/preprod --no-edit >/dev/null 2>&1 || true
      local ws_lines ws_count=0
      ws_lines=$(printf '%s\n' "$body" | grep "^${WORKSPACE_KEY}" || true)
      if [ -n "$ws_lines" ]; then
        ws_count=$(printf '%s\n' "$ws_lines" | wc -l | tr -d ' ')
      fi
      status_lines_verbatim "$ws_lines"
      status_add "workspace-count" "$ws_count"
    else
      local probes
      probes=$(probe_lines "$body")
      status_lines_verbatim "$probes"
      status_add "detail" "fix the token under Settings > Secrets and variables > Actions (see www.harnesscompanion.com/firsttime), then rerun /setup; nothing was mutated"
      finish "preflight-fail" 1
    fi
  else
    status_add "preflight" "skipped"
  fi

  finish "ok" 0
}

# ------------------------------------------------------------------ apply

node_pnpm_usable() {
  command -v node >/dev/null 2>&1 || return 1
  command -v pnpm >/dev/null 2>&1 || return 1
  # The foundation needs Node 22.11+.
  node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=11)?0:1)' \
    >/dev/null 2>&1
}

substitute_package_name() {
  # Exactly ONE substitution in the payload: package.json "name" becomes
  # this repository's name, npm-safe (lowercased, leading . and _
  # stripped, truncated to 214 characters). Everything else stays
  # byte-for-byte as shipped. Rewriting through JSON.parse doubles as
  # the pre-push validity guard for the one file this session edits;
  # without node, an awk fallback edits in place and the status says the
  # file was not re-validated.
  local raw safe
  raw=$(basename "$(git remote get-url origin 2>/dev/null)" .git 2>/dev/null || true)
  [ -n "$raw" ] || raw=$(basename "$(pwd)")
  safe=$(printf '%s' "$raw" | tr '[:upper:]' '[:lower:]' | sed 's/^[._]*//' | cut -c1-214)
  if command -v node >/dev/null 2>&1; then
    if ! node -e '
      const fs = require("fs");
      const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
      pkg.name = process.argv[1];
      fs.writeFileSync("package.json", JSON.stringify(pkg, null, 2) + "\n");
    ' "$safe"; then
      status_add "detail" "package.json failed to parse while setting its name; the payload on disk is damaged, nothing was pushed"
      return 1
    fi
    status_add "package-name" "$safe"
    status_add "package-json-validated" "yes"
  else
    awk -v n="$safe" '
      !done && /"name"[[:space:]]*:/ {
        sub(/"name"[[:space:]]*:[[:space:]]*"[^"]*"/, "\"name\": \"" n "\"")
        done = 1
      }
      { print }
    ' package.json > package.json.setup-tmp && mv package.json.setup-tmp package.json
    status_add "package-name" "$safe"
    status_add "package-json-validated" "no (node unavailable)"
  fi
  return 0
}

cmd_apply() {
  PHASE="apply"
  local RAILWAY="" FOUNDATION="" MCP="" WORKSPACE_ID="" FIRST_TIME="unset"
  while [ $# -gt 0 ]; do
    case "$1" in
      --railway) need_value --railway $#; RAILWAY="$2"; shift 2 ;;
      --foundation) need_value --foundation $#; FOUNDATION="$2"; shift 2 ;;
      --mcp) need_value --mcp $#; MCP="$2"; shift 2 ;;
      --workspace) need_value --workspace $#; WORKSPACE_ID="$2"; shift 2 ;;
      --first-time) need_value --first-time $#; FIRST_TIME="$2"; shift 2 ;;
      *) status_add "detail" "unknown argument: $1"; finish "invalid-arguments" 1 ;;
    esac
  done
  local flag
  for flag in "$RAILWAY" "$FOUNDATION" "$MCP"; do
    case "$flag" in yes|no) ;; *)
      status_add "detail" "--railway, --foundation and --mcp are required and must be yes or no (the skill normalizes non-applicable answers to no before calling apply)"
      finish "invalid-arguments" 1 ;;
    esac
  done
  if [ "$FOUNDATION" = yes ] && [ "$RAILWAY" = no ]; then
    status_add "detail" "--foundation yes requires --railway yes"
    finish "invalid-arguments" 1
  fi
  if [ "$MCP" = yes ] && [ "$FOUNDATION" = no ]; then
    status_add "detail" "--mcp yes requires --foundation yes (the MCP payload overlays the foundation)"
    finish "invalid-arguments" 1
  fi
  status_add "railway" "$RAILWAY"
  status_add "foundation" "$FOUNDATION"
  status_add "mcp" "$MCP"
  status_add "first-time" "$FIRST_TIME"
  [ -n "$WORKSPACE_ID" ] && status_add "workspace" "$WORKSPACE_ID"

  guard_classify
  if [ "$guard_state" = "configured" ]; then
    status_add "detail" "this repository is already configured; there is nothing for /setup to apply"
    finish "configured" 1
  fi
  # half-applied is fine here: apply is idempotent, so resuming IS
  # rerunning it with the inferred answers. The existence guards on the
  # copies below are what make a resume after the self-delete safe.

  # Start from the remote tip (brings in the preflight's self-delete).
  git_quiet_fetch_preprod
  if git rev-parse --verify -q origin/preprod >/dev/null 2>&1; then
    if ! git rebase -q origin/preprod >/dev/null 2>&1; then
      git rebase --abort >/dev/null 2>&1 || true
      status_add "detail" "the local branch diverged from origin/preprod and cannot be rebased automatically; reconcile by hand, then rerun apply"
      finish "local-diverged" 1
    fi
  fi

  say "Applying configuration (railway=$RAILWAY, foundation=$FOUNDATION, mcp=$MCP)..."
  if [ "$RAILWAY" = yes ]; then
    if [ -d .claude/setup/railway ]; then
      # The quarantine holds final repo-relative paths, so this copy IS
      # the activation. The chmod restores executable bits in the
      # working tree; git tracks them from the quarantine already.
      cp -R .claude/setup/railway/. .
      chmod +x .claude/scripts/*.sh .claude/hooks/*.sh 2>/dev/null || true
    fi
    if [ "$FOUNDATION" = yes ]; then
      if [ -d .claude/setup/foundation ]; then
        # Deliberately overwrites the overlay's package.json,
        # .gitignore, .env.example, railway.json and docs/README.md;
        # that is the design, not a conflict.
        cp -R .claude/setup/foundation/. .
        # The payload replaces the starter app and ships a full
        # CLAUDE.md, so the snippet has no job. Other paths keep both.
        rm -f server.js claude-md-snippet.md
      fi
      if [ "$MCP" = yes ] && [ -d .claude/setup/mcp ]; then
        # AFTER the foundation copy: the MCP payload deliberately
        # overrides several foundation files whole (forge decision
        # record 0011). Copying it first would let the foundation
        # overwrite all of it.
        cp -R .claude/setup/mcp/. .
      fi
      if ! substitute_package_name; then finish "payload-damaged" 1; fi
    fi
  fi

  # Record the variant on line 1; /harness-upgrade filters migrations by
  # it. The foundation path also records the CI check chain, the same
  # chain the concurrent verification below runs.
  local variant="harness-plain"
  [ "$RAILWAY" = yes ] && variant="harness-railway"
  if [ -f .harness-version ]; then
    { printf 'harness: %s\n' "$variant"; tail -n +2 .harness-version; } > .harness-version.setup-tmp
    mv .harness-version.setup-tmp .harness-version
    if [ "$FOUNDATION" = yes ] && ! grep -q '^check:' .harness-version; then
      printf 'check: pnpm install --frozen-lockfile && pnpm typecheck && pnpm lint && pnpm check:docs\n' >> .harness-version
    fi
  fi
  status_add "variant" "$variant"

  # Self-delete: the quarantine, the skill, the plain path's preflight
  # workflow, and this script itself. The skill's presence is the
  # "unconfigured" marker, and the spine must not outlive the skill it
  # serves. Deleting a running bash script is safe here: the interpreter
  # holds the file open, only the path goes away.
  git rm -r -q --ignore-unmatch .claude/setup .claude/skills/setup
  git rm -q --ignore-unmatch .github/workflows/harness-preflight.yml
  git rm -q --ignore-unmatch .claude/scripts/setup.sh

  # The provisioning sentinel, railway only. Lines 2 and 3 are parsed
  # contracts with harness-railway.yml: the foundation marker gates the
  # application variables (only an exact "foundation: yes" provisions
  # them), and the workspace line exists only when the user had a
  # choice to make; a single-workspace account writes no third line.
  if [ "$RAILWAY" = yes ]; then
    {
      utc_now
      printf '%s%s\n' "$FOUNDATION_KEY" "$FOUNDATION"
      if [ -n "$WORKSPACE_ID" ]; then
        printf '%s%s\n' "$WORKSPACE_KEY" "$WORKSPACE_ID"
      fi
    } > "$BOOTSTRAP_SENTINEL"
  fi

  git add -A
  # An idempotent rerun may stage nothing new; that is not an error.
  git commit -q -m "chore: configure harness (railway=$RAILWAY, foundation=$FOUNDATION, mcp=$MCP)" || true
  say "Pushing the configuration commit to preprod..."
  if ! push_preprod; then
    status_add "push-error" "$PUSH_LAST_ERROR"
    status_add "detail" "the configuration commit could not be pushed to preprod after retries; check network and permissions, then push HEAD:preprod by hand or rerun apply"
    finish "push-failed" 1
  fi

  # Move the checkout off any claude/ branch so the session cannot end
  # there and be nudged into pushing it (which would fire the
  # feature-branch machinery for a branch containing no feature).
  git checkout -q preprod 2>/dev/null || git checkout -q -b preprod
  git reset -q --hard origin/preprod 2>/dev/null || true

  if [ "$RAILWAY" = no ]; then
    finish "ok" 0
  fi

  # Provisioning watch, with verification overlapped on the foundation
  # path (forge decision record 0022): the slow local chain runs while
  # Railway provisions, and both outcomes land in the status.
  local VERIFY="not-applicable" VERIFY_LOG="" verify_pid=""
  if [ "$FOUNDATION" = yes ]; then
    if node_pnpm_usable; then
      VERIFY_LOG=$(mktemp)
      say "Verification (install, typecheck, lint, check:docs) runs while Railway provisions..."
      ( pnpm install --frozen-lockfile && pnpm typecheck && pnpm lint && pnpm check:docs ) \
        > "$VERIFY_LOG" 2>&1 &
      verify_pid=$!
    else
      VERIFY="skipped (Node 22.11+ or pnpm unavailable in this session)"
    fi
  fi

  say "Watching provisioning (the cleanup commit carries the URLs)..."
  provisioning_done() {
    git_quiet_fetch_preprod
    local sha
    sha=$(newest_subject_sha "$CLEANUP_SUBJECT")
    [ -n "$sha" ] && body_of "$sha" | grep -q '^production-url: '
  }
  local provisioned=yes
  if ! poll "$PROVISION_BUDGET" provisioning_done; then
    provisioned=no
  fi

  local PROD_URL="" PREPROD_URL=""
  if [ "$provisioned" = yes ]; then
    local body
    body=$(body_of "$(newest_subject_sha "$CLEANUP_SUBJECT")")
    PROD_URL=$(printf '%s\n' "$body" | grep '^production-url: ' | head -1 | sed 's/^production-url: //')
    PREPROD_URL=$(printf '%s\n' "$body" | grep '^preprod-url: ' | head -1 | sed 's/^preprod-url: //')
    status_add "production-url" "$PROD_URL"
    status_add "preprod-url" "$PREPROD_URL"

    # Liveness, not just provisioning: Railway still has to build and
    # deploy, and a bare 200 can be a placeholder page. Both shipped
    # apps send "x-harness: live" for exactly this check. The
    # x-harness-sha header is deliberately NOT compared here: the
    # bootstrap deploy predates the cleanup commit, so a sha match
    # would fail forever by design.
    if [ -n "$PROD_URL" ] && [ "$PROD_URL" != "(unknown)" ]; then
      liveness_ok() {
        curl -sfI --max-time 10 "$PROD_URL" 2>/dev/null | grep -qi '^x-harness: live'
      }
      say "Waiting for production to serve the app (x-harness: live)..."
      if poll "$LIVENESS_BUDGET" liveness_ok; then
        status_add "liveness" "live"
      else
        status_add "liveness" "unconfirmed"
        status_add "liveness-note" "provisioning succeeded and the deploy may simply still be rolling; check the URL again in a couple of minutes (an app that later drops the header only disables this check, nothing else)"
      fi
    else
      status_add "liveness" "skipped (no production URL in the cleanup commit)"
    fi
  fi

  if [ -n "$verify_pid" ]; then
    if wait "$verify_pid"; then
      VERIFY="pass"
    else
      VERIFY="fail"
      local tail_lines
      tail_lines=$(tail -20 "$VERIFY_LOG" | sed 's/^/verify-log: /')
      status_lines_verbatim "$tail_lines"
    fi
    rm -f "$VERIFY_LOG"
  fi
  status_add "verify" "$VERIFY"

  # Bring the cleanup commit (or whatever else landed) into the local
  # checkout so the session ends aligned with the remote.
  git_quiet_fetch_preprod
  git reset -q --hard origin/preprod 2>/dev/null || true

  if [ "$provisioned" = no ]; then
    status_add "run-url" "$(actions_url harness-railway.yml)"
    status_add "detail" "no cleanup commit appeared on preprod within the budget; read the run's conclusion before diagnosing: a FAILED provisioning step means provisioning itself failed (see the skill's causes), while a run whose log shows the URLs but went red on its cleanup step means provisioning SUCCEEDED and only the cleanup push failed; in that case read production-url and preprod-url from the run log and finish the cleanup by deleting .github/workflows/harness-railway.yml and .harness-bootstrap from preprod in one commit"
    finish "provisioning-timeout" 1
  fi

  if [ "$VERIFY" = "fail" ]; then
    status_add "detail" "provisioning succeeded and the configuration commit is on preprod, but the local verify chain failed; the cause is almost always the local toolchain (Node or pnpm version) rather than the payload, and the same chain runs in CI on every future merge; diagnose from the verify-log lines above"
    finish "verify-failed" 1
  fi

  finish "ok" 0
}

# ------------------------------------------------------------------- main

cd "$(git rev-parse --show-toplevel 2>/dev/null || pwd)" || exit 1

case "${1:-}" in
  guard) shift; cmd_guard "$@" ;;
  prepare) shift; cmd_prepare "$@" ;;
  apply) shift; cmd_apply "$@" ;;
  *)
    PHASE="none"
    status_add "detail" "usage: setup.sh guard | prepare [--railway yes|no|unknown] [--poll-only] | apply --railway yes|no --foundation yes|no --mcp yes|no [--workspace <id>] [--first-time yes|no]"
    finish "invalid-arguments" 1
    ;;
esac
