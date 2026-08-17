# 6. Actions return failures as values and never throw

- **Status**: Accepted
- **Date**: 2026-08-17

## Context

The UI is optimistic: it renders the expected result on the same frame as the
click and lets the server reconcile afterwards. That choice constrains what the
server boundary is allowed to do when a write fails, and the constraint is not
obvious from reading `src/lib/action.ts`, which only shows the outcome.

An optimistic client has already mutated its cache by the time the server
answers. It needs, on every path, **something to reconcile against**. Two
conventional designs cannot give it that:

- **Throwing across the action boundary.** A thrown error in a Server Action
  surfaces as a rejected promise the framework can turn into an error boundary.
  An error boundary unmounts a subtree, which discards the optimistic cache and
  any in-flight edit the user was typing. The user loses work because the server
  said no to one field.
- **Redirecting on an expired session.** A 307 to `/login` mid-mutation is the
  same problem wearing different clothes: the page navigates away, the cache
  goes with it, and the pending edit is gone. Worse, it is indistinguishable from
  a successful navigation, so the client cannot tell that anything failed.

## Decision

Every Server Action is built by `defineAction` (`src/lib/action.ts`), and it
returns one of exactly two shapes:

```ts
{ ok: true, data } | { ok: false, error: { code, message }, fieldErrors? }
```

**Nothing throws across the action boundary.** Three specific consequences:

1. **Unauthenticated is a VALUE.** `requireSession()` throws internally, and the
   wrapper converts it to `{ ok: false, error: { code: "unauthenticated" } }`.
   The redirect, where one is wanted, is the client's decision to make after it
   has reconciled its cache. Pages still redirect for UX; actions never do.
2. **Unknown throws are logged and flattened** to `code: "unexpected"` with a
   fixed message. A SQL error, a table name, or a stack frame never reaches the
   client.
3. **Soft warnings travel on the SUCCESS path**, as `warnings: Warning[]` beside
   the data. A duplicate note title is kept and reported this way. Rejecting it
   would strand an optimistic row the user can already see, which is the exact
   failure this whole design exists to avoid.

`src/app/notes/mutations.ts` converts a `{ ok: false }` result into a rejection
in exactly one place (`unwrap`), so TanStack Query's `onError` fires and the
rollback strategy runs. That conversion is deliberately at the client edge, not
at the server boundary.

## The `not_found` collapse

A second tradeoff lives in the same wrapper and is worth stating separately,
because it looks like sloppiness and is not: **a row that does not exist and a
row belonging to another user both return `not_found`, with the same message.**

Distinguishing them would leak existence. An attacker iterating ids could
separate "no such note" from "someone else's note", which turns an opaque id
space into an enumerable one and confirms that a given id is real. Services
raise `NotFoundError` for both cases, and
`tests/integration/notes-repository.test.ts` asserts the indistinguishability as
its own set of cases rather than trusting it.

## Consequences

- Optimistic rollback is always possible, because every outcome is a value.
- Error handling is uniform: one wrapper, one shape, one place that maps domain
  errors to codes. No call site invents its own convention.
- Type safety does the enforcing. `ActionResult<T>` is a discriminated union, so
  a caller cannot read `data` without first narrowing on `ok`.
- **The cost:** callers must check `ok` on every call. There is no `try`/`catch`
  shortcut, and a caller who ignores the result gets no warning from the runtime.
  The client-side `unwrap` exists precisely so that discipline lives in one file.
- A genuinely fatal condition (a module that cannot construct, a missing
  `DATABASE_URL`) still throws, because it is not an action failure and no client
  can reconcile it. `getEnv()` and `getDb()` are outside this contract.

## Alternatives considered

- **Throw and catch in an error boundary.** Idiomatic React, and wrong here: an
  error boundary discards exactly the state the optimistic UI depends on.
- **Redirect on unauthenticated.** Conventional, and it silently destroys pending
  work. It also makes "signed out" the one failure the client cannot reconcile.
- **HTTP status codes through route handlers instead of Server Actions.** Would
  give failures a transport-level shape, at the cost of hand-writing fetch calls,
  serialization, and error mapping for every mutation. `defineAction` collapses
  all of that into one wrapper.
- **Returning warnings as errors.** Simpler union, one shape fewer. Rejected
  because it makes the client roll back a write the server actually committed,
  which is a lie to the user about the state of their data.
