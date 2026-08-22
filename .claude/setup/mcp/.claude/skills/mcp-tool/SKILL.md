---
name: mcp-tool
description: Add, change, or remove a tool on this app's MCP endpoint, so agents can do something new on a user's behalf. Use when exposing an existing capability to agents, when a tool call misbehaves, or when deciding whether something should be a tool at all.
---

# Add an MCP tool

The endpoint already exists and is already authorized (`/api/mcp`, per-user
OAuth, revision 2026-07-28). This skill adds ONE tool to it.

Read [docs/architecture/mcp-server.md](../../../docs/architecture/mcp-server.md)
first if you have not this session: it owns the protocol contract, the auth
chain, and the surface table you will be updating.

## Step 1: decide whether it should be a tool at all

More tools do not make a better agent. They make a longer list to choose
wrongly from.

Ask, in order:

1. **Would a person do this as one step?** Tools should match the units a
   user thinks in, not the endpoints the server happens to have. `archive
   note` is a step. `update note set archived_at` is a column.
2. **Is there already a tool that does it with different arguments?** Extend
   that one. Two tools an agent cannot tell apart is worse than one tool with
   an extra parameter.
3. **Does it fetch everything?** Prefer a search over a list. `list_notes`
   invites an agent to pull the whole table into context; `search_notes` makes
   it say what it wants.

If the answer to 1 is no, stop. Expose the step, not the mechanism.

## Step 2: write it

Tools live in `src/lib/mcp/server.ts`, registered inside `buildMcpServer`.

**Where a tool may reach.** It calls `src/server/services/` and nothing below
it, the same boundary a Server Action enters through. Never a repository,
never the Drizzle client: the service layer is where ownership checks and
invariants live, and a tool that skips it skips them. If no service does what
you need, add one there first.

**The caller.** `buildMcpServer` receives an `McpCaller`: the authenticated
user's id, the client that was authorized, and the granted scopes. Pass
`caller.userId` to services exactly as an action passes the session's user id.
Tool code never sees the raw access token, so it cannot forward the caller's
credential to another service.

Four things every tool declares:

| Declare | Rule |
|---|---|
| `description` | Written to a new teammate, not a compiler. Say when to call it, what the arguments mean, what comes back, and any format the argument has to be in. This text is the prompt the model reads to choose. |
| `inputSchema` | A Zod object, always, even when empty. Model output is untrusted input: this is where it gets checked. Constrain ranges and enums rather than accepting a bare string. |
| `outputSchema` | Declare it and return `structuredContent` alongside human-readable `content`. A client should not have to parse prose. |
| `annotations` | `readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`. Clients use these to decide what needs confirmation. A destructive tool that claims to be read-only is a bug with consequences. |

**Return high signal.** Semantic fields over opaque identifiers: a notebook's
name, not its uuid. Paginate and truncate anything unbounded, with a default,
and say so in the response text so the agent knows to narrow rather than
retry. Errors should say what to do differently.

**Register through `audited()`.** It writes the caller, tool name and outcome
line for you, on success and on failure, and it is the reason you do not have
to remember any of this. Do not log arguments yourself: they can carry user
content, and nothing else in the pipeline will strip them.

## Step 3: decide the scope

Everything today grants on the single `mcp` scope. Split it when a new tool's
blast radius genuinely differs from the others, not before:

- Add the scope to the `scopes` list passed to `mcp()` in `src/lib/auth.ts`.
- Enforce it in `src/lib/mcp/endpoint.ts` (`requiredScopes`), or per tool by
  checking `caller.scopes` and returning an error result.
- Update the consent screen's `SCOPE_LABELS` in `src/app/consent/page.tsx`. A
  scope a person cannot read is not consent.

## Step 4: test it

A tool test asserts what a CLIENT observes, never how the handler is built.

- **Integration** (`tests/integration/mcp.test.ts`): call the tool through the
  handler and assert the `structuredContent`. Add a case for the failure the
  tool can actually have (not found, not yours, bad input).
- **Build requests with `tests/helpers/mcp-request.ts`.** Never by hand. A
  request missing the `_meta` envelope or the `Mcp-Method` / `Mcp-Name`
  headers is classified as 2025-era, and under the SDK's default posture it is
  silently served by the legacy fallback, so the test passes while exercising
  a path this endpoint does not serve.
- **E2E only for the authorization chain**, which already exists
  (`tests/e2e/mcp-oauth.spec.ts`). A new tool does not need its own journey.

## Step 5: write it down

- Add a row to the tool table in
  [docs/architecture/mcp-server.md](../../../docs/architecture/mcp-server.md).
- If the tool can change or delete data, say so in
  [docs/SECURITY.md](../../../docs/SECURITY.md) under agent access.
- If it introduced a scope, both of the above change.

Then run `pnpm verify`.

## Removing a tool

Delete the registration, its tests, and its documentation rows in the same
change. A tool that disappears mid-conversation is a broken client, so treat
removal as a breaking change to a public interface, because it is one.
