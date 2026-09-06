# The conflict protocol

Reached from `/feature` (any phase) and from `/to-spec`'s conflict sweep. It
is the one home for the conflict card, the A/B/C fork, the strict pause and
where a decision is recorded. Read it when a feature's intent collides with
a node of the specification; nothing else in the flow needs it.

A feature can collide with the specification as it stands: a node whose
text says the opposite of what the feature intends, a rule another system
is bound by, a criterion the change would make false. That collision can
surface at any phase (a grill answer in phase 1, the conflict sweep in
phase 2, a ticket in phase 3, a judge's `drifted` in phase 4), and
whenever it does, **STOP and render the conflict card.** Never build
around a conflict, never resolve one by picking the reading that lets the
session continue.

## The conflict card

Read the node live (`bash .claude/scripts/spec-universe.sh node <id>`)
and render:

```
CONFLICT: <product>.<slug>  <name>
Text (verbatim):        <behaviour, and the rule or criterion in question>
Effective strictness:   <free | committed | contractual | legal>  (<place that binds it, or "none">)
Criticality:            <low | medium | high>
Citing nodes:           <capabilities and interfaces that cite it, with their conformance>
Bound systems:          <systems whose requirements must comply with it, or "none">
The collision:          <what this feature intends, and which line it contradicts>
```

Text is quoted, never paraphrased: the user is deciding about a sentence.

## The forced choice

Then put exactly three options to the user and wait:

- **A) Amend the node.** Draft the amending proposal against the fields
  the feature changes, plus a companion proposal for every same-product
  node the amendment makes false (the citing nodes are where to look), all
  under the feature's change key with `change_url` = the work item.
  Cross-product ripple is not yours to draft: Spec Universe raises impacts
  on the bound systems at draft, and their owners answer them.
- **B) Retire the node.** A status proposal to `retired`, under the change
  key, never a delete: nothing in Spec Universe is deleted, and a
  retirement can be argued back.
- **C) Conform.** The feature bends: restate its intent so it no longer
  collides, and record the restatement.

The card and the choice are **user decisions**. They are exempt from
phase autopilot and from grill autonomy, and are never self-answered,
even when every other gate of the session is auto-advanced.

## Record the decision, and let it bind

Write the decision in three places: the feature context (under a
"Conflict decisions" heading: the node, the option taken, the reason), a
comment on the work item, and the rationale of every proposal it produced.
**A decision at one phase binds later phases**: a judge in phase 4 does not
reopen a conflict phase 2 settled, it judges against the proposed text
that decision produced.

## The strict pause

Where the node's effective strictness is `legal` or `contractual` and the
choice was A or B, Spec Universe refuses acceptance over MCP and over
`/v1`: the amendment can only be accepted by a person, signed in, on the
node's own page. So after drafting, STOP with exactly this shape:

> {node} is {legal/contractual} ({place}). Its amendment is drafted and
> waiting in Spec Universe: {deep link}. Accept it there to continue, or
> decline it with a reason and I will rework.

The deep link is `{SPEC_UNIVERSE_URL}/nodes/{node key}`. Write the waiting
state into the feature context ("Strict pause waiting: proposal `prp_...`
on `<slug>`, drafted <date>") and push it, because the wait may outlive
the session.

**On resume** (this session or a later one), re-read the proposal
(`spec-universe.sh proposals <node-id>` or `change-proposals <KEY>`) and
act on its state:

| State | Do |
|---|---|
| `accepted` | Clear the waiting state and proceed with the phase that paused |
| `declined` | Bring the `declineReason` into the conversation verbatim, and re-open the A/B/C fork with it: the amendment can be reworked (an amended proposal returns to draft), the node can be retired instead, or the feature can conform |
| `draft` | Say the proposal is still waiting, keep the waiting state, and stop again |

A `free` or `committed` node needs no pause: the proposal is drafted,
recorded, and the phase continues; acceptance is still owed before the
preprod gate lets a drifted-vs-current node through (`/to-preprod`).

