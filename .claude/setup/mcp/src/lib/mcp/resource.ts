import { getPublicOrigin } from "@/lib/env";

/**
 * The path the MCP endpoint is served from. One constant, because three
 * places have to agree on it: the route that serves it, the resource
 * identifier tokens are audience-bound to, and the protected resource
 * metadata clients discover.
 */
export const MCP_ENDPOINT_PATH = "/api/mcp";

/**
 * The single OAuth scope an access token needs to call any tool.
 *
 * Deliberately one scope, not a read/write pair: the server ships exactly one
 * tool, so a split would teach a distinction nothing here can exercise. Split
 * it when a second tool arrives whose blast radius differs; see
 * `.claude/skills/mcp-tool/SKILL.md` and ADR 0007.
 */
export const MCP_SCOPE = "mcp";

/**
 * The canonical protected resource identifier (RFC 8707 / RFC 9728) for this
 * MCP server.
 *
 * It is DERIVED, never configured. `getPublicOrigin()` already resolves this
 * environment's own public origin (a custom domain on production, the Railway
 * hostname on preprod and on every feature preview), which is what lets an
 * ephemeral preview environment serve a correct MCP endpoint with no variable
 * set by hand. Introducing an MCP-specific URL variable would reintroduce
 * exactly the per-environment configuration the rest of the app avoids.
 *
 * Call it lazily. It reads the environment, so nothing may call it at module
 * scope: `next build` evaluates modules with no DATABASE_URL set.
 */
export function getMcpResource(): string {
  return `${getPublicOrigin()}${MCP_ENDPOINT_PATH}`;
}
