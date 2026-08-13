# Security

What this project trusts, what it does not, and which tests prove it. Update
this file in the same commit as any change to auth, sessions, secrets, input
validation, or limits.

This is not a policy document. It is the map an agent needs before touching
anything security-relevant, so it names files and exports rather than
describing intentions.

## Trust boundaries

Every boundary is a place where data crosses from something you do not
control into something you do. Name the entry point and the code that
validates it.

| Boundary | Crosses from | Validated by | Notes |
|---|---|---|---|
| _(e.g. HTTP request body)_ | Public internet | `src/...` | |
| _(e.g. environment)_ | Deployment platform | | Secrets never reach the client bundle |
| _(e.g. third-party webhook)_ | External service | | Signature verified before parsing |

## Authentication

How a caller proves who they are, and **why** it works that way. The
rationale matters more than the mechanics: the mechanics are in the code.

- **Mechanism:**
- **Where the identity is established:** `src/...`
- **Session lifetime and revocation:**
- **Rationale (or ADR):**

## Authorization

How the system decides what an authenticated caller may do.

- **Model:** (role-based, ownership-based, capability-based)
- **Where it is enforced:** the single chokepoint, if there is one. If
  authorization is enforced in more than one place, list every place, because
  a missed one is the bug.
- **Default:** deny or allow, stated explicitly

## Rate limits and quotas

| Surface | Limit | Window | Enforced by | What happens on breach |
|---|---|---|---|---|
| | | | | |

## Which tests assert which property

The point of this table is that a deleted test stops being invisible. If a
security property has no row, it is not tested, and it belongs in Known gaps
below.

| Property | Asserted by |
|---|---|
| _(e.g. unauthenticated requests are rejected)_ | `tests/...` |
| | |

## Known gaps

Explicit, dated, and honest. An empty section here reads as "we checked and
found nothing", which is almost never true. Say what is not defended against
and why that is currently acceptable.

| Gap | Risk | Why acceptable for now | Revisit when |
|---|---|---|---|
| | | | |

## Reporting

How someone reports a vulnerability in this project, and who responds.
