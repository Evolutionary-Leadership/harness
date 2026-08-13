---
name: domain-modeling
description: Build and sharpen the project's domain model. Use when the user wants to pin down domain terminology, record an architectural decision, or when another skill (grilling, brainstorm, feature) needs the domain model maintained.
---

# Domain Modeling

Actively build and sharpen the project's domain model as you design:
challenge terms, invent edge-case scenarios, and write vocabulary and
decisions down the moment they crystallise. Merely *reading*
`docs/GLOSSARY.md` for vocabulary is not this skill; that is a one-line
habit any skill can do. This skill is for when you are changing the model,
not just consuming it.

The two homes this skill writes to, both defined by the docs standard
(`docs/README.md` is the manifest):

- **Vocabulary** goes in `docs/GLOSSARY.md`, in that file's own table
  format: one row per term, pointing at the term's canonical home.
- **Decisions** go in `docs/decisions/`, scaffolded with `/document adr`,
  which handles numbering, the template, and the index row.

## During the session

### Challenge against the glossary

When the user uses a term that conflicts with the existing language in
`docs/GLOSSARY.md`, call it out immediately. "The glossary defines
'cancellation' as X, but you seem to mean Y. Which is it?"

### Sharpen fuzzy language

When the user uses vague or overloaded terms, propose a precise canonical
term. "You are saying 'account'. Do you mean the Customer or the User?
Those are different things."

### Discuss concrete scenarios

When domain relationships are being discussed, stress-test them with
specific scenarios. Invent scenarios that probe edge cases and force the
user to be precise about the boundaries between concepts.

### Cross-reference with code

When the user states how something works, check whether the code agrees.
If you find a contradiction, surface it: "The code cancels entire Orders,
but you just said partial cancellation is possible. Which is right?"

### Update the glossary inline

When a term is resolved, add or update its row in `docs/GLOSSARY.md` right
there. Do not batch these up; capture them as they happen. Only domain
terms belong: a concept unique to this project's domain, never a general
programming concept (timeouts, error types, utility patterns), however
often the project uses it. When a term replaces an older one, move the old
term to the glossary's Deprecated table instead of deleting it.

### Offer ADRs sparingly

Only offer to record a decision when it passes the test in
[WHEN-TO-ADR.md](./WHEN-TO-ADR.md). When it passes, scaffold it with
`/document adr <title>`.

One timing rule: during `/brainstorm`, decisions are recorded in the idea
issue on the tracker, not as ADR files; the ADR ships later with the
feature that implements the decision. During `/feature`, write the ADR
when the decision settles.

---
Adapted from [mattpocock/skills](https://github.com/mattpocock/skills) (MIT).
