# Release: the connected half of step 10b

Read this only from `LANDING.md`, "Claim conformance, connected only", once
`.harness-version` carries a non-empty `spec_product:` line. It runs after `LANDING.md`
has established that production serves the release and found the change keys,
and before it closes their work items; nothing here runs when the loop is
dormant.

A conformance claim is honest only once production SERVES the release, so
that the close `LANDING.md` makes next means live means promoted in Spec
Universe. Branch and preprod
results are never claimed, from here or anywhere.

## Gather the verdicts from the gate run records

They survive the merge as committed files, named by the PR bodies. For every
pull request `LANDING.md` found a change key in, take the run record path
from its body's `## Preprod gate` section. Read each record from the tree
production serves, and let the one reader print its rows:

    git show "origin/main:.harness/gate-runs/<KEY>-<n>.json" > /tmp/<KEY>-<n>.json
    node scripts/gate-run.mjs --verdicts-from-record=/tmp/<KEY>-<n>.json

Union the rows. A PR whose body names no run record, or whose record is not
on `origin/main`, shipped without a recorded verdict (a `/to-preprod` older
than this step, or a merge around it): list it as unclaimed rather than
inventing rows.

## Promote each change, before claiming anything

A change whose specification moved ships its amendments as part of shipping
its code, so that "live" and "current in the specification" are one statement
rather than two that drift. Promotion comes FIRST, so every claim below
describes the text that is now current instead of text the release has
already superseded:

    SU="bash .claude/scripts/spec-universe.sh"
    IDEMPOTENCY_KEY="release-$NEW_VERSION-promote-<KEY>" $SU release <KEY>

once per change key `LANDING.md` found. The call is idempotent and is never
refused: it promotes what it can and returns what it left behind, as
`promoted`, `unacceptedAtRelease` and `notPromoted`.

Read that answer and report it. **`promoted` is named node by node** in the
report. **`unacceptedAtRelease` and `notPromoted` are named too, never
swallowed**: a proposal nobody accepted is a decision that was never taken,
and a release that promoted around it must say so, because the preprod gate
only guards drifted-vs-current and a proposal can reach production unaccepted.
A non-zero exit from the client stops `LANDING.md` before its close,
exactly as a failed verification does, with nothing claimed and no issue
closed.

## Claim in one batch, over `/v1`

Every claim is one line of a JSONL file and one call posts them all, through
the shared client, which fails closed on any non-zero exit
(`.claude/SPEC-LOOP.md`), posts with bounded concurrency and prints one line
per failure. The idempotency keys make a re-run after a stop safe. The
evidence every claim carries is the Release page, which exists on both of
`release.yml`'s paths (the direct merge and the PR fallback):

    RELEASE_URL=https://github.com/<owner>/<repo>/releases/tag/$NEW_VERSION

### By verdict

Write `/tmp/verdict-claims.jsonl`, one line per verdict row, in the shape
`scripts/spec-test-claims.mjs` emits (its `--help` shows the fields): the
key `release-<version>-<node>-<criterion>`, the row's node, the row's value
(`matched` or `drifted`), basis `source-code` (the judge read the code and
ran nothing), the criterion the row's `ac-N` (omitted for a whole-node row),
evidence `$RELEASE_URL`.

**A `drifted` verdict is claimed `drifted`, honestly**, and every drifted
claim is reported to the user by node and criterion: a release that carries
known drift is a fact Spec Universe must show, never one the claim step tidies
away. `unverifiable` rows are claimed as nothing (neither value can be
claimed) and listed as anchors to repair.

### By test, from a run at the release commit

The harness asks CI to run no suite, so the run that says which anchored
tests passed is this session's own, at the commit production serves, in a
worktree that is thrown away afterwards. A criterion anchor (`fr-14/ac-3`)
on a test file that PASSED is claimed `matched` with basis `test`; a file
that failed, was skipped or never ran claims nothing and is listed, because a
session without a database fails the integration tier for want of one, and
that is not drift.

    RELEASE_SHA=$(git rev-parse origin/main)
    WT=$(mktemp -d) && git worktree add --detach "$WT" "$RELEASE_SHA"
    REPORT=$(mktemp -t run-report-XXXXXX.json)
    (cd "$WT" && <the project's install command> \
      && node scripts/check-spec.mjs --quiet \
      && <the project's test command, writing a Vitest-shaped JSON report to "$REPORT">) || true

The `|| true` is deliberate: a red tier is expected in a session without a
database, and the script below is what decides what a red file means. The
report's shape is the contract: `{ testResults: [{ name, status }] }`, which
is what `vitest run --reporter=json --outputFile` writes; a runner that emits
something else needs converting to it before this step, not a second format
here. Run the intersection twice, because the evidence is a comment whose URL
the test claims carry:

1. Once to produce the evidence. The markdown goes to stderr:

        node scripts/spec-test-claims.mjs --coverage="$WT/.harness/spec-coverage.json" \
          --report="$REPORT" --root="$WT" --version="$NEW_VERSION" --sha="$RELEASE_SHA" \
          --evidence=pending 2> /tmp/evidence.md > /dev/null

   Post `/tmp/evidence.md` as a comment on the work item `LANDING.md` is
   about to close (the first change key's, when there are several;
   `mcp__github__add_issue_comment`) and take the comment's URL.

2. Once more with that URL as `--evidence`, stdout to
   `/tmp/test-claims.jsonl`. Each line is one claim under the key
   `release-<version>-<node>-<criterion>-test` (distinct from the
   `source-code` key for the same criterion, so both bases stand).

### Post

One call per file, then remove the worktree:

    $SU claims --file=/tmp/verdict-claims.jsonl
    $SU claims --file=/tmp/test-claims.jsonl
    git worktree remove --force "$WT"

A non-zero exit from the client stops the claims where they are; the keys make
the re-run safe. Report the count claimed, the count not claimed, and the
evidence URL.

## What the closing block carries

`Good to know` carries what was promoted, then the claim write-back: how many
criteria were claimed and every `drifted` claim by node and criterion (the
work items closed are `LANDING.md`'s to report). The same item carries the test
claims: how many criteria a passed test claimed, and how many anchored tests
did not pass and so claimed nothing, with the link to the evidence comment.
