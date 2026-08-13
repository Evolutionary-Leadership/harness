---
name: getting-started
description: Orientation skill that runs on session startup. Teaches Claude about available skills and agents.
---

# Getting Started: You Have Superpowers

You have **skills** and **agents** available in this project.

- **Skills** (`.claude/skills/`) are predefined procedures that give you
  step-by-step instructions for common tasks. Invoke them with `/skillname`.
- **Agents** (`.claude/agents/`) are autonomous specialists that run in their
  own context. They handle explorative, multi-step work independently and
  return a summary. Use the Agent tool to launch them when the task matches
  their description.

They exist because someone already figured out the right way to do these things.

## Step 0: Ask what kind of session this is

Sessions here start in one of three flavors, and the user states which,
explicitly, before work starts. If the opening message does not make it
obvious, ask: is this **chat**, **brainstorm**, or **feature**?

| Flavor | Skill | What it writes |
|---|---|---|
| Talk | `/chat` | Nothing |
| Think | `/brainstorm` | The issue tracker only (an idea issue, if the user keeps the thinking) |
| Build | `/feature` | The repo, through five gated phases |

Do not start building because a message describes something buildable;
that description is the *input* to `/feature`, whose phase 1 grills it
before any code gets written. `/feature #<issue>` picks up where a
`/brainstorm` idea issue left off. `/continue` resumes an in-flight
feature mid-flow, reasoning intact, via its feature context.

If the session is going to build, `/feature` phase 0 names the branch
(`set-feature-name.sh`) before the first push, so the feature branch and
its Railway environment get a meaningful name instead of the session's
random codename. Naming also provisions Railway in the background.

## Step 1: Discover your skills and agents

Run this now:

    bash .claude/scripts/list-skills.sh

This lists every skill and agent available in this project along with its
description.

## Step 1b: Know where the facts live

If `docs/README.md` exists, this project follows the AI-native documentation
standard: `CLAUDE.md` is a router under a 300-line budget, and `docs/README.md`
is the index-manifest naming every doc and what it owns.

**Read `docs/README.md` before writing documentation, and before assuming a
fact is undocumented.** It is how you find the one home for a fact instead of
creating a second copy. `/document` operates on the same manifest. All
issue-tracker operations go through the contract in
`docs/agents/issue-tracker.md`.

## Step 2: Know the two reviews apart

Two skills have "review" in their name; learn the pair once:

- **`/code-review` reviews code.** Agents review the diff along two axes
  (Standards and Spec) in parallel sub-agents. It runs automatically at
  the end of `/feature` phase 4.
- **`/review` requests humans.** It opens a PR to dev that is NOT
  auto-merged and assigns reviewers from `.harness-version`. When humans
  approve, the PR lands via `/mergedev`, never the GitHub merge button.

The full catalog, for orientation. Process skills (the flow):
`/feature`, `/brainstorm`, `/chat`, `/endchat`, `/continue`, `/mergedev`,
`/review`, `/release`, `/hotfix`, `/rollback`, `/status`, `/changelog`,
`/deps`, `/document`, `/harness-upgrade`, `/getting-started` (this one).
Technique skills (chained by the flow, also usable directly):
`/grilling`, `/domain-modeling`, `/to-spec`, `/to-tickets`, `/implement`,
`/tdd`, `/code-review`, `/diagnosing-bugs`, `/codebase-design`,
`/writing-for-agents`.

## Step 3: Understand the rules

**Skills and agents are mandatory, not suggestions.**

When a skill or agent exists for a task the user is asking you to perform, you
MUST use it. Do not improvise a different approach. Do not skip it because you
think you already know what to do. Do not rationalize past it.

If you think there is even a 1% chance a skill or agent applies to what the
user is asking, check the list. Wrong invocations are acceptable. Skipping
the check is not.

Red flags that you are about to violate this rule:
- "I already know how to do this": check anyway
- "This is simple enough to do directly": check anyway
- "The skill is overkill for this": check anyway

## Step 4: Act

Run `bash .claude/scripts/list-skills.sh` RIGHT NOW, then proceed with
whatever the user has asked.
