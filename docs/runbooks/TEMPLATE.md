# Runbook: <what went wrong>

<!--
Copy to docs/runbooks/<slug>.md and add a row to the Runbooks table in
docs/README.md.

A runbook exists because a procedure has already bitten someone. It is not a
tutorial and not a design doc. If nobody has been paged for it, it does not
belong here yet.

Write it to be executed at 3am by an agent with no context.
-->

## Symptom

What you observe, verbatim where possible: the error string, the alert name,
the failing check. This is the grep anchor. Someone finds this file by
pasting the symptom, so put the exact text here.

## Preconditions

What must be true before you start: access, credentials, which branch,
whether traffic is served.

## Procedure

1. Numbered, copy-pasteable steps. One command per step.
2. State what a correct result looks like after each step that can fail.
3. Never say "verify it works". Say what output proves it worked.

## Verification

The single command or check that proves the incident is over.

## Rollback

How to undo the procedure if it makes things worse. If there is no way back,
say so explicitly and say at which step the point of no return is.

## Root cause and follow-up

One paragraph on why this happens, and a link to the ADR or issue tracking
the permanent fix. If the permanent fix lands, delete this runbook. Git
history is the archive.
