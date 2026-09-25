---
name: rollback
description: Revert production to the previous release tag and create a tracking issue.
argument-hint: "[optional: tag to revert to, e.g. v1.2.3]"
allowed-tools: Bash(git *), Bash(gh *), Read, Write, Glob, Grep
---

# Rollback production

Revert `main` to a previous release tag when the current production deploy is
broken. Creates a tracking issue for the incident.

## Authority

**This skill reaches production, so a session may complete it only under
authority.** It moves production back to an earlier release tag, which is a
deploy like any other and undoes work somebody shipped deliberately.

**Check this first, before any other step.** Work you are not allowed to file
is work you should not start, and discovering the block at the exit is the
failure this section exists to remove (the forge decision record on granting
exit authority in configuration).

    AUTHORITY=$(sed -n 's/^agent-authority: *//p' .harness-version | tail -1)

Authority is satisfied by **either** of these, and by nothing else:

1. **A grant.** `rollback` appears in that `agent-authority:` list. The person
   who owns this repository granted it ahead of time, in a commit.
2. **A user asking, in this turn.** They typed `/rollback`, or said in words to
   do it, or picked it at a `/feature` phase 5 exit gate. A relayed report
   that somebody once approved releases is not this; the ask is in the turn.

`--ship` is not a third form here. On a `/feature` run it is release
authority for the change that run built and gated through `preprod`; a
rollback undoes a release rather than making one, so no flag on a feature run
reaches it. A session inside `/feature --ship` that finds a bad deploy stops
and asks, in words, in this turn.

**If neither holds, stop here and stand down.** Do not compute anything, do not
write a signal file, do not push. Emit the stand-down block
(`getting-started`, Step 3c) with `reason: authority-not-granted`, and say
plainly what this session did finish and that it is not complete.

**Performing these steps by hand is the same act, and is refused the same
way.** The forge decision record on reaching a user-invoked skill by its file lets
a session reach this procedure by reading this file rather than invoking the
skill, and that route is still open; what it is not is a way around this
section. Writing the signal file, committing it and pushing it
without authority IS this skill, whatever it is called at the time. A guard
that stopped only the literal invocation would guard nothing.

## Steps

### 1. Identify the target version

    git fetch origin main --tags

List recent tags:

    git tag --sort=-version:refname | head -10

If `$ARGUMENTS` is provided, use it as the target tag. Otherwise, default to
the second-most-recent tag (the one before the current release):

    CURRENT_TAG=$(git describe --tags --abbrev=0 origin/main)
    PREVIOUS_TAG=$(git tag --sort=-version:refname | sed -n '2p')

Confirm with the user: "Roll back from $CURRENT_TAG to $PREVIOUS_TAG?"

### 2. Create revert

    git checkout main
    git pull origin main
    git revert --no-commit "$PREVIOUS_TAG"..HEAD
    git commit -m "revert: rollback to $PREVIOUS_TAG"
    git push origin main

This reverts all commits between the target tag and HEAD on main, keeping
full git history (no force push).

### 3. Create tracking issue

    gh issue create \
      --title "Rollback: $CURRENT_TAG → $PREVIOUS_TAG" \
      --body "## Rollback Summary

    **From:** $CURRENT_TAG
    **To:** $PREVIOUS_TAG
    **Date:** $(date -u +%Y-%m-%dT%H:%M:%SZ)
    **Trigger:** [describe what went wrong]

    ## Reverted changes
    $(git log $PREVIOUS_TAG..$CURRENT_TAG --oneline)

    ## Action items
    - [ ] Investigate root cause
    - [ ] Fix the issue on preprod
    - [ ] Re-release with fix
    "

### 4. Inform the user

Tell the user:
- Production has been rolled back to `$PREVIOUS_TAG`
- A tracking issue has been created
- The revert commit is on `main`, so no history was lost
- Next steps: investigate the issue, fix it on preprod, then do a new release
- If using Railway: production will redeploy automatically from the updated main
