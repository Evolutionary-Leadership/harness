import { requireMcpAuth } from "@better-auth/mcp";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { logger } from "@/lib/logger";
import { MCP_SCOPE, getMcpResource } from "@/lib/mcp/resource";
import { type McpCaller, buildMcpServer } from "@/lib/mcp/server";

/**
 * The MCP endpoint, built once and used by both the route and the tests.
 *
 * It lives here rather than inside the route handler for one reason: a test
 * that re-declares the wiring is testing its own copy. The protocol posture and
 * the authorization rules below are the things most worth asserting and the
 * easiest to get wrong, so the tests have to exercise THIS function, not a
 * reconstruction of it that can silently drift from the route.
 */

/** The shape `requireMcpAuth` needs from an auth instance. */
type McpAuth = Parameters<typeof requireMcpAuth>[0];

/** Reads a verified token's claims into the narrow shape tools receive. */
function callerFrom(claims: Record<string, unknown>): McpCaller {
  const scope = typeof claims.scope === "string" ? claims.scope : "";
  return {
    userId: String(claims.sub ?? ""),
    clientId: typeof claims.client_id === "string" ? claims.client_id : undefined,
    scopes: scope.split(" ").filter(Boolean),
  };
}

/**
 * Builds the authorized MCP endpoint as a plain request handler.
 *
 * MODERN ONLY. `legacy: "reject"` means this endpoint speaks MCP revision
 * 2026-07-28 and nothing else: a 2025-era client that opens with an
 * `initialize` handshake gets an unsupported-protocol-version error naming the
 * revisions served, rather than a session that negotiates and then fails at
 * client registration. The authorization layer is modern-only regardless (CIMD
 * under the mcp-2026-07-28 profile, and that revision deprecates Dynamic Client
 * Registration), so serving both eras here would only move the failure later.
 * ADR 0007 records the tradeoff and what should make someone revisit it.
 *
 * Because the revision is stateless, this is an ordinary handler: no session
 * store, no sticky routing, nothing shared between requests.
 *
 * @param resource Overridable so a test can pin the origin instead of depending
 *   on the ambient environment. Production passes nothing and gets the derived
 *   value, which is what keeps every Railway environment self-configuring.
 */
export function createMcpEndpoint(
  auth: McpAuth,
  resource: string = getMcpResource(),
): (request: Request) => Promise<Response> {
  const handler = createMcpHandler(
    // The factory runs once per request. `authInfo` is whatever the guard below
    // passed in; the handler never reads headers or verifies a token itself.
    ({ authInfo }) => buildMcpServer(authInfo?.extra?.caller as McpCaller),
    {
      legacy: "reject",
      onerror: (error) => logger.error({ err: error.name }, "mcp handler error"),
    },
  );

  return requireMcpAuth(
    auth,
    (request, claims) => {
      const caller = callerFrom(claims);
      // The caller travels as one value rather than as loose fields flattened
      // into authInfo and re-parsed on the other side.
      return handler.fetch(request, {
        authInfo: {
          token: "",
          clientId: caller.clientId ?? "",
          scopes: caller.scopes,
          extra: { caller },
        },
      });
    },
    {
      // Tokens must be audience-bound to this exact resource, not merely valid
      // for the app: that is what stops a token minted for something else being
      // replayed here.
      resource,
      // A valid token is not blanket permission. Without the mcp scope the
      // caller gets a 403 with an RFC 6750 insufficient_scope challenge naming
      // what is missing, so a client can step up in one round trip.
      requiredScopes: [MCP_SCOPE],
    },
  );
}
