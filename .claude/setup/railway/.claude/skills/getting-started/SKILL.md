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
`docs/agents/issue-tracker.md`. Where a feature IS on its journey, which
artefact each position leaves, and when a transition is done live in
`.claude/JOURNEY.md`; `/feature` writes that position as it moves.

## Step 2: Know the two reviews apart

Two skills have "review" in their name; learn the pair once:

- **`/code-review` reviews code.** Agents review the diff along two axes
  (Standards and Spec) in parallel sub-agents. It runs automatically at
  the end of `/feature` phase 4.
- **`/review` requests humans.** It opens a PR to preprod that is NOT
  auto-merged and assigns reviewers from `.harness-version`. When humans
  approve, the PR lands via `/to-preprod`, never the GitHub merge button.

The full catalog, for orientation. Process skills (the flow):
`/feature`, `/brainstorm`, `/chat`, `/endchat`, `/continue`, `/to-preprod`,
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

## Step 3b: Close every reply the same way

Every reply you give the user ends with one **closing block**. It is the
same shape in every skill and in no skill at all, so a reader learns it
once and then never has to hunt for what they must do:

```
---

**💡 Good to know**

1. ...

**🗓️ Act later**

1. ...

**➡️ Act next**

1. ...
```

The rules:

- **`Act next` is always present.** There is always a next thing, even when
  it is "answer Q7". It holds what should happen right now, given this
  prompt and this session.
- **`Good to know` and `Act later` are omitted when they would be empty.**
  Never pad them with "nothing here"; padding is what teaches a reader to
  skip the block. `Good to know` is the bare minimum the prompting human
  benefits from knowing. `Act later` is work that is real but can wait, and
  every item says where it should be done.
- **Numbered items, never bullets**, in every section, so an item can be
  answered or referred to by its number.
- **One block per reply.** When skills chain, the outermost skill the user
  invoked owns the block; inner skills contribute items into it and never
  emit one of their own. Where no skill is running, the reply carries one
  anyway.
- **The block compresses, it does not append.** The prose above it carries
  only what the block cannot, and anything that fits in a list item moves
  into the block. A reply that gained a block and kept all its old prose
  has made the problem worse, not better.

### Questions are `Act next` items

A question you put to the user is itself an `Act next` item and carries its
own question number as its list number, so that section renders `Q9.`,
`Q10.` during a question stage and `1.`, `2.` otherwise. One section never
mixes the two.

A **question stage** is one question-asking step of a session: a `/grilling`
round set, the `/to-tickets` granularity quiz, the `/feature` phase 5 exit
choice. Numbering runs continuously inside a stage, so a round following one
that ended at Q6 opens at Q7. Each new stage advances the prefix by one
letter, in the order the session reaches stages, starting at Q and wrapping
from Z back to A. The prefix never resets mid-session. Explain each shift in
one brief sentence, so a jump from Q17 to R1 does not read as a mistake.

## Step 3c: Stand down in one shape, and never call it done

Some things a session is not allowed or not able to finish: an exit whose
authority this repository has not granted, a capability the sandbox does not
have, a decision only a person can make. That is a normal outcome, not an
error, and it has exactly one shape so that a coordinator reading six sessions
sees one pattern instead of six phrasings.

When a session cannot finish what it was asked to do, it emits a **stand-down
block**, verbatim, fences included, directly above the closing block:

```
=== HARNESS BLOCKED ===
skill: <the skill or step that cannot be completed>
reason: <authority-not-granted | capability-missing | needs-decision>
done: <what this session did finish, stated so a reader can check it>
not-done: <what remains, named as an act someone can perform>
unblock: <the smallest thing that would let a session finish it>
=== END HARNESS BLOCKED ===
```

The rules, and the first one is the reason the block exists:

- **A reply carrying this block MUST NOT report the work as complete.** Not
  "done, pending merge", not "finished, just needs a human". The work is not
  complete; say what is and what is not, in `done:` and `not-done:`. A stall
  that reads as success is worse than a stall, because nothing downstream can
  tell the two apart.
- **`reason:` takes one of the three words and no others.** They are what a
  coordinator routes on: `authority-not-granted` means a person or a grant
  would clear it, `capability-missing` means this environment cannot do it at
  all, `needs-decision` means someone must choose before anyone can act.
- **One block per reply, and only at the moment of standing down.** A session
  that clears its own block never emitted one.
- **The block reports; it does not ask.** Where the flow also keeps a record
  (`/feature` writes `## Blocked` in the feature context, labels the work item,
  and reports to the cockpit), that record is kept as `.claude/JOURNEY.md`
  prescribes. This block is how the same fact reaches the reply.

`unblock:` is a lever, never a plea. "The owner adds `agent-authority: release`
to `.harness-version`, or a person runs `/release`" is a lever. "Please let me
know how to proceed" is not, and it is what six stalled sessions said.

## Step 4: Act

Run `bash .claude/scripts/list-skills.sh` RIGHT NOW, then proceed with
whatever the user has asked.
