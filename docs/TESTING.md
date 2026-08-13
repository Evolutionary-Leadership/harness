# Testing

How this project tests, where a new test goes, and what CI does **not** run.
Update this file when you add a tier, change the runner, or discover a gap in
what CI covers.

## Tiers

| Tier | Runs | Speed | Depends on |
|---|---|---|---|
| Unit | | fast | nothing external |
| Integration | | medium | a real database or service |
| End to end | | slow | a running app |

Keep the tier boundary about **dependencies**, not about file size. A test
that needs a database is an integration test even if it asserts one thing.

## Conventions

| Convention | Rule |
|---|---|
| File naming | |
| Location | Next to the code, or under `tests/`. Pick one and state it here |
| Test naming | Describe the behavior and the condition, not the function name |
| Fixtures | Where they live and who owns them |
| What must never be mocked | The thing under test, and the boundary you claim to verify |

## Where does a new test go

| What you changed | Test tier | Where |
|---|---|---|
| Pure function or helper | Unit | |
| Route, handler, or command | Integration | |
| Anything reading or writing the database | Integration | |
| A security property (authn, authz, limits) | Integration | Also add a row to `docs/SECURITY.md` |
| A user-visible flow across pages | End to end | |
| A bug fix | The tier that would have caught it | A regression test named after the bug |

## Running them

```
# whole suite
# single tier
# single file
```

## What CI does not run

The most useful section in this file. CI is configured by the `check:` line
in `.harness-version`; anything not in that chain runs only on someone's
machine, or not at all.

| Not run in CI | Why | How to run it locally |
|---|---|---|
| _(e.g. end to end suite)_ | Needs a live deployment | |
| | | |

A test that CI does not run is a test that will break silently. Either wire
it into `check:` or accept that it is documentation, not verification.
