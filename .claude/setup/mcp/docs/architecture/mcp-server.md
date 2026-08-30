---
sources:
  - src/app/api/mcp/route.ts
  - src/lib/mcp/endpoint.ts
  - src/app/.well-known/**/route.ts
  - src/app/consent/*.tsx
  - src/lib/mcp/*.ts
  - src/lib/auth.ts
  - src/lib/db/schema/oauth.ts
  - scripts/gen-oauth-schema.mjs
  - tests/helpers/mcp-request.ts
---

# MCP server

This app exposes a Model Context Protocol endpoint, so an agent can call its
tools the same way a person uses its UI. The endpoint is authorized per user
through this app's own Better Auth instance; there is no shared token and no
unauthenticated mode.

## The surface

| Path | Serves | Auth |
|---|---|---|
| `POST /api/mcp` | The MCP endpoint. Tools only, no resources or prompts. **POST only**: this revision is stateless request/response, and the 2025-era GET and DELETE were session operations this endpoint does not have | OAuth 2.1 bearer, `mcp` scope required |
| `GET /.well-known/oauth-protected-resource[/api/mcp]` | RFC 9728 protected resource metadata | Public |
| `GET /.well-known/oauth-authorization-server/api/auth` | RFC 8414 authorization server metadata | Public |
| `/api/auth/oauth2/*` | The OAuth 2.1 endpoints (authorize, token, consent, create-client, ...) | Per endpoint |
| `GET /consent` | The consent screen the authorization flow redirects to | Session |

**The two `.well-known` routes exist because the specifications and Better
Auth disagree about where those documents live.** Better Auth answers them at
the ORIGIN ROOT, while every other Better Auth route sits under `/api/auth`,
and Next only routes what has a file. They forward the request unchanged,
because Better Auth matches the literal path: a `rewrites()` entry that
rebased the URL under `/api/auth` would stop matching and every discovery
lookup would 404. Without them the `401` challenge from `/api/mcp` points at
nothing and no client can begin authorizing.

## Protocol revision

The endpoint is built by `createMcpEndpoint` in `src/lib/mcp/endpoint.ts`, and
the route is a thin lazy call into it. That split exists so the tests exercise
the shipped wiring rather than a reconstruction of it, which is the failure
mode that let an earlier version of these tests pass while being served by the
legacy fallback.

It speaks **2026-07-28 and only that revision** (`legacy: "reject"`).
A 2025-era client that opens with an `initialize` handshake receives an
unsupported-protocol-version error naming what is supported. ADR 0007 records
why, and what should make someone revisit it.

That revision is stateless, which is what makes this a plain route handler:
no session store, no sticky routing, nothing shared between requests.

A conforming request carries **both** of these, and is rejected without either:

| Where | What |
|---|---|
| `params._meta` | `io.modelcontextprotocol/protocolVersion`, `io.modelcontextprotocol/clientInfo`, `io.modelcontextprotocol/clientCapabilities`. All three; a missing one is "Invalid _meta envelope" |
| Headers | `Mcp-Method` mirroring the body's method, and `Mcp-Name` mirroring `params.name` when the body has one. The server checks headers and body AGREE |

`tests/helpers/mcp-request.ts` builds requests in that shape and is shared by
both test tiers, so neither drifts into testing the legacy path by accident.

Deprecated in this revision and therefore not implemented: Roots, Sampling,
Logging, and the HTTP+SSE transport. Server-to-client interaction, if ever
needed, is Multi Round-Trip Requests (`resultType: "input_required"` plus a
client retry carrying `inputResponses`), not bidirectional streaming.

## Authorization

The endpoint is an OAuth 2.1 **resource server**, never a token issuer for
anything but itself.

- `mcp()` in `src/lib/auth.ts` makes this app the authorization server and
  publishes the protected resource metadata.
- `cimd()` supplies Client ID Metadata Documents under the `mcp-2026-07-28`
  profile. That revision deprecates Dynamic Client Registration, so CIMD is
  the client onboarding path. `/oauth2/create-client` is the app-owned way to
  register a client directly, and needs a session.
- `jwt()` signs the access tokens; its `jwks` table is what the resource
  server verifies them against.
- `requireMcpAuth` guards the route: it verifies signature, issuer, audience
  and expiry, and rejects an unauthenticated call with the RFC 9728
  `WWW-Authenticate` challenge that tells a client where to start.

**The resource identifier is derived, never configured.** It is
`getPublicOrigin()` plus `/api/mcp`, so production, preprod and every ephemeral
feature environment serve a correct endpoint with no variable set by hand.
This introduces no new environment variable.

`getPublicOrigin()` exists because OAuth needs an absolute origin before any
request arrives, while `getAuthBaseUrl()` may return undefined ("derive it
from the request"). An undefined origin makes the provider build an empty
issuer and every page render fails on an invalid URL.

**Scopes.** One scope, `mcp`, grants tool access, and `requireMcpAuth`
enforces it: a valid token without it gets a `403` with an RFC 6750
`insufficient_scope` challenge naming what is missing. Split the scope when a
second tool arrives whose blast radius differs.

**A native client registers as `application_type: "native"`.** A `web` client
is held to https redirect URIs, which a CLI agent on a loopback address
cannot provide; the 2026-07-28 revision added the parameter for exactly this.

## Tools

| Tool | Does | Reads | Annotations |
|---|---|---|---|
| `whoami` | Reports the account the connection is authenticated as, the client that was authorized, and the granted scopes | The verified token's claims only | read-only, non-destructive, idempotent, closed-world |

`whoami` returns the account's stable identifier and no profile fields. An
access token carries authorization, not identity: name and email live in the
ID token and at the UserInfo endpoint, not in the token this endpoint
verifies. A tool that needs the caller's profile reads it through the service
layer.

**Where a tool may reach.** A tool calls `src/server/services/` and nothing
below it, the same boundary Server Actions enter through (see
[server-layers.md](./server-layers.md)). A tool that goes straight to a
repository bypasses the layer where authorization and invariants live.

Adding one is `/mcp-tool`.

## The database tables

`src/lib/db/schema/oauth.ts` is **generated**, not hand-written:
`pnpm db:oauth-schema` regenerates it from the plugins' own schema
declarations, then `pnpm db:generate` turns the result into a migration. The
property names must keep matching Better Auth's field names, because the
Drizzle adapter maps by property rather than by column.

Every model a registered plugin declares must also appear in the adapter's
schema map in `src/lib/auth.ts`. The adapter resolves models lazily, so a
missing one does not fail the build or the typecheck: it surfaces as a 500 on
whichever request first touches it. `tests/unit/auth-schema.test.ts` exists to
catch that at the cheapest tier.

## Connecting a client

Point an MCP client at `https://<your-app>/api/mcp` and let it discover the
rest. The client must speak revision 2026-07-28; an older one is refused with
a version error rather than a broken session.

## Observability

Every tool invocation logs caller, tool name and outcome through the pino
logger, including the ones that fail. The `audited()` wrapper in
`src/lib/mcp/server.ts` is what makes that structural rather than a habit: a
tool registered through it cannot forget its audit line.

**Arguments are never logged**, and neither are error messages. Arguments are
not passed to the logger at any point, and a failure logs the error's TYPE
rather than its message, because a message can quote the input that caused it.
The error itself propagates unchanged.
