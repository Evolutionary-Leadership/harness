---
name: grilling
description: Grill the user relentlessly about a plan, decision, or idea. Use when the user wants to stress-test their thinking, or uses any "grill" trigger phrases. Also the interview engine behind /brainstorm and /feature phase 1.
---

# Grilling

Interview the user relentlessly until you reach a shared understanding. Map
the topic as a **design tree**: every decision branches into the decisions
that hang off it.

Work the tree in **rounds**. The **frontier** is every decision whose
prerequisites are already settled: the questions you can ask *now* without
guessing at answers you have not heard yet. Ask the whole frontier in one
round: number each question and give your recommended answer. Then wait for
the user's answers before the next round.

Format each question like so:

```
Q1 - <question title>: <question body, may be multiple paragraphs,
including multiple choices>

Recommended: <your recommended answer>
```

Every round also carries one **standing option**, offered alongside the
numbered questions, in these words or close to them:

```
Or: take your recommended answer on every remaining question of this grill,
and only come back to me if something is genuinely one-way or risky.
```

That is **grill autonomy**. See below for what taking it changes.

Each round the user answers reshapes the tree. Settled decisions push the
frontier outward and unblock the questions that depended on them. Recompute
the frontier and ask the next round. A question whose answer depends on
another question still open in this round belongs to a *later* round, not
this one.

## Grill autonomy

Recommended answers are most of a grill, and a user who agrees with them
should not have to say so four times. The standing option lets them stop
approving each round.

**Its scope is the rest of this grill.** Not the current round, which would
mean re-granting it every round and buying nothing. Not the whole session,
because a later unrelated grill must not inherit a decision made about this
one. `/brainstorm` and `/feature` phase 1 both run this skill, so both offer
it, and a grant in one does not carry into the other.

**Autonomy changes who answers, never whether the tree gets visited.** Keep
computing the frontier, keep asking the whole of it, keep recording the
answers. The only difference is that you supply them. The "Done" condition
below is unchanged: an empty frontier, every branch visited, nothing silently
assumed.

**Write down what you decided, exactly as if you had asked.** Every
auto-answered decision gets its answer, its reasoning, and the alternatives
you rejected, in whatever durable place this grill is feeding (the feature
context, the idea issue, the spec). A record that says less because the user
was not consulted is the failure mode this rule exists to prevent.

**Break out for a question that is genuinely the user's.** Two bars:

- The decision is **one-way**: a schema, a public interface, a data
  migration, anything whose cost to reverse is real.
- Your recommendation would be a **guess rather than a judgement**: you have
  no basis to prefer either branch, so picking one is a coin toss wearing a
  recommendation's clothes.

"I would rather be safe" is not a bar. Neither is a decision merely being
important; important and reversible still gets decided.

**Breaking out costs one question, not the grant.** Ask that question, take
the answer, and resume autonomy for the rest of the grill. Say plainly why
you broke out, so the user can see the bar being applied rather than guess
at it. A grant that evaporated the first time you were careful would teach
you not to be.

## Facts are yours, decisions are the user's

Finding *facts* is your job, never the user's. When a frontier question
needs a fact from the environment (the codebase, the filesystem, the docs),
dispatch a sub-agent to find it; do not ask the user for anything you could
look up yourself. Do not block on it either: a running exploration is an
unsettled prerequisite, so only the questions downstream of it wait for the
sub-agent to report. Ask the rest of the frontier now. The *decisions* are
the user's: put each one to them and wait.

When a sub-agent's findings are worth keeping past this session, write them
down: route them to their home per `docs/README.md`, or attach them to the
relevant spec or idea issue per the tracker contract in
`docs/agents/issue-tracker.md`. Findings that live only in conversation are
lost when the session ends.

## Done

The session is done when the frontier is empty: every branch of the design
tree visited, nothing left silently assumed. Do not act on the design until
the user confirms you have reached a shared understanding.

---
Adapted from [mattpocock/skills](https://github.com/mattpocock/skills) (MIT).
