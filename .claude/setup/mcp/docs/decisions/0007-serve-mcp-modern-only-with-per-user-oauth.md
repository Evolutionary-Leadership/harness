# 0007. Serve MCP modern-only, authorized per user by this app's own OAuth

- **Status:** Accepted
- **Date:** 2026-08-22

## Context

Agents should be able to call this application's tools. Two questions had to
be answered before any of it could be written: which protocol revision to
serve, and how a caller proves who it is.

MCP defines two protocol eras. Legacy (revision 2025-11-25 and earlier) opens
with an `initialize` handshake and carries a session id. Modern (2026-07-28
and later) is stateless, with protocol version and client capabilities
travelling per request. A modern-only client cannot talk to a legacy-only
server, and the reverse. At the time of writing, 2026-07-28 support was still
rolling out across client products, so a dual-era endpoint would have
connected to more clients that week.

On identity, the cheap option is a single bearer token in an environment
variable. This application has users, and their notes are private to them.

## Decision

**The endpoint speaks 2026-07-28 only** (`legacy: "reject"`). The
authorization layer is modern-only regardless (Client ID Metadata Documents
under the `mcp-2026-07-28` profile; that revision deprecates Dynamic Client
Registration), so a legacy client would negotiate the transport and then fail
at client registration. A clear version error beats a session that half works.

**Authorization is OAuth 2.1, per user, through this app's own Better Auth
instance.** The endpoint is a resource server only: it validates tokens and
never issues them for anything but itself, never forwards a caller's token to
an upstream service, and requires the `mcp` scope rather than treating any
valid token as blanket permission. Tokens are audience-bound to the endpoint's
own resource identifier, which is derived from the environment's public origin
rather than configured.

### Rejected alternatives

| Alternative | Why not |
|---|---|
| Dual-era transport (`legacy: "stateless"`, the SDK default) | Connects to more clients today, but pairs a dual-era transport with a modern-only auth profile: the client negotiates, then fails at registration |
| A shared bearer token from an environment variable | One token reaches every user's data. Acceptable in a single-user app, wrong here |
| No scope, any valid token reaches every tool | Drops per-tool authorization, which the MCP security guidance names as the most common production failure |
| Separate `mcp:read` and `mcp:write` scopes | Invents a distinction the single shipped tool cannot exercise, so the example teaches a split nobody can see working |
| An `MCP_ENABLED` flag keeping the endpoint dark on production | Leaves production as the one environment never exercised. OAuth is the control, not the environment |

## Consequences

- A 2025-era client gets an unsupported-protocol-version error, not a
  fallback. Anything connecting here must speak 2026-07-28.
- Roots, Sampling and Logging are unavailable; they are deprecated in this
  revision and not implemented.
- The OAuth tables and the JWKS table are part of this app's schema, and
  `src/lib/db/schema/oauth.ts` is generated from the plugins rather than
  hand-written.
- Every environment serves the endpoint identically. Dev and feature previews
  carry the public demo login, so an agent can obtain a real token there; that
  is deliberate, and the existing rule that those environments hold no real
  data is what makes it safe.

## Threat model

- **Trusted:** the Better Auth instance and its database; the deploying
  operator.
- **Untrusted:** every MCP caller and every tool argument. Arguments are
  validated by a schema at the tool boundary before reaching a service, and
  tool output is returned as structured data rather than free prose.
- **Out of scope:** a client that has already obtained a valid user token. It
  is scoped to that one user and revocable, but this decision does not defend
  further. Per-caller rate limiting is not implemented; see
  [SECURITY.md](../SECURITY.md).

## When to reconsider

Flip to `legacy: "stateless"` if the clients your users actually run turn out
to still be legacy-era, or if the CIMD plugin gains a profile serving both
onboarding paths without advertising deprecated registration as primary.
Split the `mcp` scope when a second tool arrives whose blast radius differs
from `whoami`.
