# Release: landing the release (step 10b)

Read this from `/release` step 10b on every release, whether or not
`.harness-version` carries a `spec_product:` line. Everything here runs before
step 11.

The release is not done when the workflow is: it is done when production
SERVES it. Only then is a change's work item closed, so that an open work item
means unshipped work and a closed one means live, in every repository; and,
connected, only then is a conformance claim honest. Branch and preprod results
are never claimed or closed, from here or anywhere.

## Wait for the release to land on `main`

Poll:

    git fetch origin main
    git merge-base --is-ancestor <the release commit from step 9> origin/main

until it is an ancestor, capped at about ten minutes. On timeout stop, per
"When production does not confirm" below.

## Verify production

The production URL has one home: the `production-url:` line in the body of
the bootstrap cleanup commit on `preprod` (`chore: remove harness bootstrap
files (one-time use)`), which `.claude/HARNESS.md` defines as a contract
parsed by line key:

    PROD_URL=$(git log origin/preprod --format=%B | sed -n 's/^production-url: *//p' | head -1)
    bash .claude/scripts/verify-deploy.sh "$PROD_URL" "$(git rev-parse origin/main)"

Three verdicts, and only one of them stops:

- `deploy-verified:` continues. Production serves the release.
- `deploy-equivalent:` continues, and **is reported as what it is**: no
  watched path differs between the sha production serves and the release sha,
  so no deploy was due and production already serves the same build
  (`docs/architecture/railway-environments.md` owns why). Name both shas and
  say no deploy was expected, so a reader never has to wonder why "verified"
  names a sha that is not the release. Without this verdict every docs-only
  release polls out on `deploy-pending:` and strands its work item open.
- `deploy-pending:` stops this step, per "When production does not confirm"
  below; `serving:` naming an older sha means the previous version is still
  up.

Never reason about equivalence yourself: the verifier decides it, and it is
`deploy-pending:` whenever it cannot. A skill that talks itself past a pending
verdict is the failure this whole step exists to prevent.

## Find the changes this release shipped

For every pull request in the step 3 blast radius (the `(#NN)` references),
read its body (`mcp__github__pull_request_read`) and take the change key and
work item from its `## Spec` section, where `/to-preprod` and `/review` name
them as `<KEY>: <title>` (#N). A body that predates that line: take the work
item from its `Why:` line (its title, `<KEY>: ...`, carries the key), else
the key from a `<KEY>:` prefix on the pull request's title, and find the work
item titled `<KEY>: ...` per `docs/agents/issue-tracker.md`. Either way the
result is a key and its work item. List a pull request none of these name as
"no work item found"; never guess one. Several pull requests naming one key (a
continuation) are one change.

## Claim conformance, connected only

Read the switch first:

    SPEC_PRODUCT=$(sed -n 's/^spec_product: *//p' .harness-version | tail -1)

Set (non-empty): read `CONNECTED.md` beside this file now and work it in
order. It gathers the verdicts, promotes each change and claims its
conformance, and it runs before the close because a claim describes what
production serves. A non-zero exit from its client stops here, with no issue
closed. Empty or absent (dormant): skip it; nothing about the loop is
mentioned to the user.

## Close the changes

For every change key found, close its work item (`<KEY>: ...`) as completed,
with a comment naming the version. Dormant:

    Shipped in <NEW_VERSION>; production serves it.

Connected:

    Shipped in <NEW_VERSION>; production serves it and its conformance is
    claimed in Spec Universe.

A work item already closed is left as it is: a re-run of this step after a
partial close closes only what is still open. `/release` is the only skill
that closes a work item. Tickets were closed by `/implement` as they landed;
the work item closes here, on the strength of production, and nowhere
earlier. Only work items close here: an idea issue or a bug report a work
item links to keeps its own convention (`docs/agents/issue-tracker.md`).

## When production does not confirm

A wait that times out, or a production check that does not confirm the
release, closes nothing and claims nothing. Say plainly that the release was
pushed but production is not yet confirmed to serve it (its workflow is still
running, or stopped before production served it), and that re-running step
10b once it does is the recovery. The release itself is not undone and this
is not a stand-down: carry the re-run as an `Act later` item.

## What the closing block carries

`Good to know` carries which work items were closed under this version, and
every pull request listed with no work item found. Connected, the same item
carries what `CONNECTED.md`, "What the closing block carries", names.
