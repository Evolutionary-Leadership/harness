# Security

Trust boundaries, authn and authz mechanics, limits, and known gaps.

## The boundary, stated once

**The security boundary is `requireSession()` in `src/lib/auth-server.ts`, called by
every Server Action and data route.** Nothing else is.

| Looks like a boundary | Is actually |
|---|---|
| `src/proxy.ts` (middleware) | Rate limiting and redirect UX. It checks only that a session COOKIE is PRESENT, never that it is valid, and its matcher does not cover Server Actions, which are directly callable HTTP endpoints |
| A session check in a layout | Convenience, so a signed out visitor is not shown a page that then bounces. A Server Action runs without any layout ever rendering |
| Hiding a button or a form | Presentation. The control has to be server side |

Every signed in page, action, and route re-verifies for itself. `src/proxy.ts` says
this in a comment at the top of the file, because the shape of a middleware file
invites the opposite assumption.

## Authentication

| Property | Choice | Why |
|---|---|---|
| Password hashing | argon2id via `@node-rs/argon2`, 19 MiB / 2 passes / 1 lane | OWASP baseline. No bcrypt, no PBKDF2 |
| Session storage | Database rows, not stateless tokens | Revocation is a DELETE |
| Cookie cache | Explicitly DISABLED | With it on, a revoked session keeps working until the cache expires. Off, every request re-reads the row, so revocation is immediate |
| Account linking | Disabled | No OAuth providers are configured |
| Email verification | Off | No mail is sent. The `verification` table exists but is unused |

Hashing lives in `src/lib/password.ts`, deliberately separate from the Better Auth
instance, so `scripts/seed.ts` can hash without pulling in auth and a connection
pool.

Asserted by `tests/integration/auth.test.ts`: the digest is `$argon2id$`, hashes are
salted, a wrong password is refused, a corrupted digest reads as "wrong password"
rather than a 500, and a deleted session row stops validating immediately.

## Authorization

Single-tenant per user. **Every repository query has `userId` in its WHERE clause.**
Rows are never fetched and then filtered in application code.

A missing row and another user's row both return `not_found` with the same message,
so probing cannot distinguish "does not exist" from "not yours".

`tests/integration/notes-repository.test.ts` asserts another user's note is
invisible, unreadable by id, unupdatable, unarchivable, undeletable, not reachable
through the id-list query, and that a note cannot be created in someone else's
notebook. Each is a separate case, and each also asserts the target row is
genuinely unchanged.

## Agent access (MCP)

`/api/mcp` is an OAuth 2.1 **protected resource**, and the only way in. There
is no shared token and no unauthenticated mode, on any environment.

- A caller presents a bearer token this app's own authorization server issued.
  `requireMcpAuth` verifies signature, issuer, audience and expiry against the
  JWKS, so a token minted elsewhere, or for a different resource, is refused.
- Tokens are **audience-bound** to the endpoint's resource identifier, and
  carry a specific user as `sub`. An agent therefore acts as exactly one
  person and reaches exactly that person's data, through the same
  `userId`-scoped queries the UI uses.
- A valid token is **not** blanket permission: the `mcp` scope is required, and
  a token without it gets a 403 naming the missing scope.
- The endpoint never forwards a caller's token to an upstream service. Tool
  code never receives the raw token at all, only a narrow caller record.
- Tool arguments are validated by a schema at the tool boundary before
  reaching a service, and results are returned as structured data.

`tests/integration/mcp.test.ts` asserts the unauthenticated rejection carries
the challenge a client needs, that an unverifiable token is refused, and that
the discovery documents name this resource.
`tests/e2e/mcp-oauth.spec.ts` walks the whole chain and asserts the tool
reports the account the token was minted for.

Mechanics and the protocol contract:
[architecture/mcp-server.md](./architecture/mcp-server.md). Rationale:
[ADR 0007](./decisions/0007-serve-mcp-modern-only-with-per-user-oauth.md).

## Input trust

Every external input is validated with Zod at the boundary: form data and action
arguments (`defineAction`'s `input` schema), search params
(`src/app/notes/page.tsx`), and environment variables (`src/lib/env.ts`). There is
no path into a service that skips a parse.

`any` is banned by eslint; the escape hatch is `unknown` plus a parse.

## Secrets

| Rule | Detail |
|---|---|
| `.env*` is never committed | `.gitignore` excludes all of it except `.env.example` |
| `BETTER_AUTH_SECRET` is per environment | Minimum 32 characters, enforced by the schema. Generate with `openssl rand -base64 32` |
| Logs redact | `src/lib/logger.ts` redacts `password`, `token`, `cookie`, and `authorization` |
| Internals never reach the client | Unrecognised throws are logged server side and flattened to `unexpected` |

## Demo login

`SHOW_DEMO_LOGIN` must be exactly `"true"` to activate, and must never be set on
production.

The protection is structural, not cosmetic. The login page is a **Server
Component**: it calls `getDemoLogin()` at render time and passes the result down as
a prop. The client form never reads `process.env` and never sees the flag, so with
the flag unset the credentials appear in neither the page payload nor any client
chunk. There is no bypass route and no magic token; the button fills the fields and
submits through the normal credentialed path.

The seed creates the demo account whenever it runs, independent of the flag, so the
button cannot point at a missing user. That is a different question from visibility,
and `src/lib/env.ts` has two accessors over one private reader to keep both answers
in one file.

## Signup gating

Signup is open unless `ALLOW_SIGNUP` is exactly `"false"`, enforced server side via
Better Auth's `disableSignUp`. `tests/integration/auth.test.ts` asserts the ENDPOINT
rejects and that no user row is written, not merely that the form is hidden.

## Rate limiting

`src/proxy.ts` limits `/api/auth/*` to 30 requests per minute per IP, in memory,
bounded to 10,000 tracked keys.

Known limits, stated plainly: it is **per instance**, so two instances mean two
independent buckets, and it keys on `x-forwarded-for`, which is only trustworthy
because Railway's proxy sets it. It blunts a naive credential stuffing loop. It is
not a real limiter.

## Known gaps

| Gap | Note |
|---|---|
| No password reset | A locked-out user needs manual intervention |
| No email verification | Any syntactically valid address can register when signup is open |
| No CSRF token beyond Better Auth's origin check | Trusted origins are the union of the configured URL and the Railway domain; an empty union must OMIT the key, since `trustedOrigins: []` replaces the defaults and breaks every sign in |
| No audit log | Mutations are logged at `info` but nothing records who changed what, when |
| Rate limit is in memory | See above |
| No account lockout | Repeated wrong passwords are limited only by the IP rate limit |
| Delete is immediate | No trash, no retention window. This is why it is the one action behind a confirm dialog |
| No rate limit on `/api/mcp` | `src/proxy.ts` limits `/api/auth/*` only. A token holder can call tools as fast as they like; the OAuth endpoints they must pass through first ARE limited |
| No machine-to-machine grant | Every token belongs to a human user. There is no client credentials flow, so an agent with no user behind it has no way in, by design |
| Tool results are not scanned for injected instructions | Content a tool returns re-enters a model's context. It is returned as structured data rather than prose, which narrows the surface but does not close it |
