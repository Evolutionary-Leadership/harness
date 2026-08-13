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

Each round the user answers reshapes the tree. Settled decisions push the
frontier outward and unblock the questions that depended on them. Recompute
the frontier and ask the next round. A question whose answer depends on
another question still open in this round belongs to a *later* round, not
this one.

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
