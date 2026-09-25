---
name: getting-started
description: Orientation skill that runs on session startup. Teaches Claude about available skills and agents.
---

# Getting Started: You Have Superpowers

**Skills** (`.claude/skills/`, invoked as `/skillname`) are procedures someone
already worked out; **agents** (`.claude/agents/`) run in their own context and
return a summary. The CLI lists both every session, and each skill's own
`SKILL.md` is its full description. The session-start hook sends every
session here first, because the three contracts below (the closing block,
the stand-down block, skills are mandatory) apply to every reply.

## Step 0: Ask what kind of session this is

Sessions start as **chat**, **brainstorm** or **feature**, stated before work
starts; if the opening message does not make it obvious, ask. `/chat` talks and
writes nothing; `/brainstorm` thinks and writes to the tracker only (an idea
issue, if the user keeps the thinking); `/feature` builds, writing the repo
through the gated phases its size tier selects.

A message describing something buildable is the *input* to `/feature`, not a
request to build: phase 0 sizes it and names the branch (`set-feature-name.sh`)
before the first push, so the feature branch (and its Railway environment,
when `.harness-feature` carries `preview: yes`: L tier or `/review`) gets a
meaningful name, not the session's codename. `/feature #<issue>` picks up a
`/brainstorm` idea issue; `/continue` resumes a feature via its feature context.

## Step 1b: Know where the facts live

If `docs/README.md` exists, this project follows the AI-native documentation
standard: `CLAUDE.md` is a router under a 300-line budget, and `docs/README.md`
the index-manifest naming every doc and what it owns. **Read it before writing
documentation, and before assuming a fact is undocumented**; `/document`
operates on the same manifest. Tracker operations follow
`docs/agents/issue-tracker.md`; a feature's journey position, and the artefact
each position leaves, is `.claude/JOURNEY.md`.

## Step 2: Know the two reviews apart

- **`/code-review` reviews code.** Agents review the diff (Standards and Spec,
  merged into one prompt for an S change) at the end of `/feature` phase 4.
- **`/review` requests humans.** It opens a PR to preprod that is NOT
  auto-merged, with reviewers from `.harness-version`. Approved, it lands via
  `/to-preprod`, never the GitHub merge button.

## Step 3: Understand the rules

**Skills and agents are mandatory, not suggestions.** When one exists for the
task the user is asking you to perform, you MUST use it: do not improvise, do
not skip it because you think you already know what to do, do not rationalize
past it. A 1% chance one applies means check the list; wrong invocations are
acceptable, skipping the check is not. "I already know how to do this", "this
is simple enough", "the skill is overkill for this": check anyway.

## Step 3b: Close every reply the same way

Every reply you give the user ends with one **closing block**, the same shape
in every skill and in no skill at all, so a reader learns it once and never
has to hunt for what they must do:

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
  it is "answer Q7": what should happen right now, given this prompt and session.
- **`Good to know` and `Act later` are omitted when they would be empty.**
  Never pad them with "nothing here"; padding teaches a reader to skip the
  block. `Good to know` is the bare minimum the prompting human benefits from
  knowing; `Act later` is real work that can wait, each item saying where.
- **Numbered items, never bullets**, so an item can be answered or referred
  to by its number.
- **One block per reply.** When skills chain, the outermost skill the user
  invoked owns the block; inner skills contribute items into it and never
  emit one of their own. Where no skill is running, the reply carries one anyway.
- **The block compresses, it does not append.** The prose above it carries
  only what the block cannot; a reply that gained a block and kept all its
  old prose made the problem worse.

### Questions are `Act next` items

A question put to the user is an `Act next` item carrying its own question
number, so the section renders `Q9.`, `Q10.` during a question stage and `1.`,
`2.` otherwise; one section never mixes the two. A **question stage** is one
question-asking step (a `/grilling` round set, the `/to-tickets` granularity
quiz, the `/feature` phase 5 exit choice). Numbering runs continuously inside
a stage (a round after one that ended at Q6 opens at Q7); each new stage
advances the prefix by one letter, from Q, wrapping Z to A, never resetting
mid-session. Explain each shift in one sentence, so Q17 to R1 reads as intended.

## Step 3c: Stand down in one shape, and never call it done

Some things a session is not allowed or not able to finish: an exit whose
authority this repository has not granted, a capability the sandbox lacks, a
decision only a person can make. That is a normal outcome, not an error, and
it has exactly one shape, so a coordinator reading six sessions sees one
pattern instead of six phrasings. When a session cannot finish what it was
asked to do, it emits a **stand-down block**, verbatim, fences included,
directly above the closing block:

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
  "done, pending merge", not "finished, just needs a human". Say what is and
  what is not, in `done:` and `not-done:`. A stall that reads as success is
  worse than a stall, because nothing downstream can tell the two apart.
- **`reason:` takes one of the three words and no others.** A coordinator
  routes on them: `authority-not-granted` means a person or a grant would
  clear it, `capability-missing` means this environment cannot do it at all,
  `needs-decision` means someone must choose before anyone can act.
- **One block per reply, and only at the moment of standing down.** A session
  that clears its own block never emitted one.
- **The block reports; it does not ask.** Where the flow also keeps a record
  (`/feature` writes `## Blocked` in the feature context, labels the work
  item and reports to the cockpit), that record is kept as `.claude/JOURNEY.md`
  prescribes; this block is how the same fact reaches the reply.
- **`unblock:` is a lever, never a plea.** "The owner adds `agent-authority:
  release` to `.harness-version`, or a person runs `/release`" is a lever;
  "please let me know how to proceed" is what six stalled sessions said.

## Step 4: Act

Proceed with whatever the user has asked, through the skill that owns it.
