# Skill mechanics

The skill-specific branch of [writing-for-agents](./SKILL.md): what
changes when the document is a skill: frontmatter, the invocation choice,
and router skills. Everything else about writing it is the universal
reference in `SKILL.md`.

## Invocation

Two choices, trading the two loads:

- A **model-invoked** skill keeps a `description`, so the agent can fire
  it autonomously, and other skills can reach it. You can still type its
  name: model-invocation always *includes* user reach; a description only
  ever adds agent discovery, never removes the human's. The description is
  the skill's top-level context pointer, forced to stay loaded at all
  times: permanent context load in exchange for discoverability. A
  model-invoked skill whose content is all reference is also one home for
  shared reference: another skill can invoke it, so reference needed by
  several skills lives in one place. Mechanics: omit
  `disable-model-invocation`, and write a model-facing description
  carrying the trigger branches (the pointer-writing rules in `SKILL.md`
  apply in full).
- A **user-invoked** skill strips the description from the agent's reach:
  only the human typing its name can invoke it, and no other skill can.
  Zero context load, but it spends cognitive load: you are the index that
  must remember it exists. Mechanics: set
  `disable-model-invocation: true`; the `description` becomes
  human-facing: a one-line summary, trigger lists stripped.

Pick model-invocation only when the agent must reach the skill on its own,
or another skill must. If it only ever fires by hand, make it user-invoked
and pay no context load.

In this harness every shipped skill is model-invocable except
`/endchat`, which carries `disable-model-invocation: true` because it only
ever cleans up a session the human ended. Process skills (`/feature`,
`/brainstorm`, `/to-preprod`, `/review` and the rest) reach each other by
name; technique skills (`/grilling`, `/to-spec`, `/to-tickets`,
`/implement`, `/tdd`, `/code-review`, `/domain-modeling`,
`/codebase-design`) carry trigger-bearing descriptions so `/feature` can
chain them. A new process skill follows the same rule: no flag.

Shared reference that a user-invoked skill needs cannot live in that
skill: with no description, nothing else can fire it. Push it to a
model-invoked skill, or to a plain file outside the skill system that any
skill can point at (in this harness, typically a doc indexed in
`docs/README.md`).

## Splitting by invocation

The invocation cut of splitting (the sequence cut lives in `SKILL.md`):
split off a model-invoked skill when you have a distinct leading word that
should trigger it on its own (a trigger word you actually use in your
prompts), or another skill must reach it. You pay context load for the new
always-loaded description, so that independent reach has to be worth it.

## Router skills

When skills multiply past what you can remember, that piled-up
cognitive load is cured by a **router skill**: one skill that names the
others and when to reach for each, so the human has one skill to remember
instead of many. It hints rather than fires: the router orients the human,
and the skills it names reach each other by name when the flow needs it.
(`/getting-started` is this harness's router.)

---
Adapted from [mattpocock/skills](https://github.com/mattpocock/skills) (MIT).
