---
name: tdd
description: Test-driven development. Use when building features or fixing bugs test-first, when the user mentions "red-green-refactor", or wants integration tests.
---

# Test-Driven Development

TDD is the red to green loop. This skill is the reference that makes the
loop produce tests worth keeping: what a good test is, where tests go, the
anti-patterns, and the rules of the loop. Every section applies on every
cycle; consult them before and during the loop, not after.

When exploring the codebase, read `docs/GLOSSARY.md` so test names and
interface vocabulary match the project's domain language, and respect ADRs
under `docs/decisions/` in the area you are touching. `docs/TESTING.md`
says where a new test file goes.

## What a good test is

Tests verify behavior through public interfaces, not implementation
details. Code can change entirely; tests should not. A good test reads
like a specification ("user can checkout with valid cart" tells you
exactly what capability exists) and survives refactors because it does not
care about internal structure.

See [tests.md](./tests.md) for examples and [mocking.md](./mocking.md) for
mocking guidelines.

## Seams: where tests go

A **seam** is the public boundary you test at: the interface where you
observe behavior without reaching inside. Tests live at seams, never
against internals.

**Test only at pre-agreed seams.** Before writing any test, write down the
seams under test and confirm them with the user (inside `/feature`, the
spec from phase 2 already fixed them). No test is written at an
unconfirmed seam. You cannot test everything; agreeing the seams up front
is how testing effort lands on the critical paths and complex logic
instead of every edge case.

Ask: "What is the public interface, and which seams should we test?"

When the shape of that interface is itself in question (how deep the
module is, where the seam belongs, what the interface should expose), use
the `/codebase-design` skill for the vocabulary. It is the shared source
of the module, interface, depth, seam, adapter, leverage and locality
terms: a reference to consult, not a session to run.

## Anti-patterns

- **Implementation-coupled**: mocks internal collaborators, tests private
  methods, or verifies through a side channel (querying the database
  instead of using the interface). The tell: the test breaks when you
  refactor but behavior has not changed.
- **Tautological**: the assertion recomputes the expected value the way
  the code does (`expect(add(a, b)).toBe(a + b)`, a snapshot derived by
  hand the same way, a constant asserted equal to itself), so it passes by
  construction and can never disagree with the code. Expected values must
  come from an independent source of truth: a known-good literal, a worked
  example, the spec.
- **Horizontal slicing**: writing all tests first, then all
  implementation. Bulk tests verify *imagined* behavior: you test the
  shape of things rather than user-facing behavior, the tests go
  insensitive to real changes, and you commit to test structure before
  understanding the implementation. Work in **vertical slices** instead:
  one test, one implementation, repeat, each test a **tracer bullet** that
  responds to what the last cycle taught you.

## Rules of the loop

- **Red before green.** Write the failing test first, then only enough
  code to pass it. Do not anticipate future tests or add speculative
  features.
- **One slice at a time.** One seam, one test, one minimal implementation
  per cycle.
- **Refactoring is not part of the loop.** It belongs to the review stage
  (see `/code-review`), not the red to green implementation cycle.

---
Adapted from [mattpocock/skills](https://github.com/mattpocock/skills) (MIT).
