# ADR number claims

One file per reserved ADR number, named for the number itself, because
the filename is what makes the reservation atomic: writing a path that
already exists fails, and the loser takes the next number and retries.

The candidate number is always:

    max(numbers already on dev, numbers claimed here) + 1

That keeps `dev` the source of truth and this branch a cache over it.
Losing this branch can therefore never re-issue a number that already
landed.

## States

| State | Means |
|---|---|
| `claimed` | Reserved, written nowhere yet |
| `landed` | The ADR is on `dev`. Never modified again |
| `released` | Returned to the pool, only when provably never used |

A number is released only when its feature branch is gone from the
remote AND no ADR carrying that number exists on `dev`. Both true means
nothing ever referenced it.

This branch prevents collisions. It does not guarantee their absence:
the docs checker in CI refuses a duplicate that got here another way.
