# When to offer an ADR

The format and mechanics are not this file's job: `/document adr <title>`
scaffolds the file from `docs/decisions/TEMPLATE.md` and adds the index
row. This file owns the judgment call: which decisions deserve one.

## The test

All three must be true:

1. **Hard to reverse.** The cost of changing your mind later is meaningful.
2. **Surprising without context.** A future reader will look at the code
   and wonder "why on earth did they do it this way?"
3. **The result of a real trade-off.** There were genuine alternatives and
   you picked one for specific reasons.

If a decision is easy to reverse, skip the ADR; you will just reverse it.
If it is not surprising, nobody will wonder why. If there was no real
alternative, there is nothing to record beyond "we did the obvious thing."

## What qualifies

- **Architectural shape.** "We are using a monorepo." "The write model is
  event-sourced, the read model is projected into Postgres."
- **Integration patterns between subsystems.** "Ordering and Billing
  communicate via domain events, not synchronous HTTP."
- **Technology choices that carry lock-in.** Database, message bus, auth
  provider, deployment target. Not every library; just the ones that would
  take a quarter to swap out.
- **Boundary and scope decisions.** "Customer data is owned by the
  Customer module; other modules reference it by ID only." The explicit
  no-s are as valuable as the yes-s.
- **Deliberate deviations from the obvious path.** "We are using manual
  SQL instead of an ORM because X." Anything where a reasonable reader
  would assume the opposite. These stop the next engineer from "fixing"
  something that was deliberate.
- **Constraints not visible in the code.** "We cannot use AWS because of
  compliance requirements." "Response times must stay under 200ms because
  of the partner API contract."
- **Rejected alternatives when the rejection is non-obvious.** If you
  considered GraphQL and picked REST for subtle reasons, record it;
  otherwise someone will suggest GraphQL again in six months.

---
Adapted from [mattpocock/skills](https://github.com/mattpocock/skills) (MIT).
