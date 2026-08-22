import { getAuth } from "@/lib/auth";
import { createMcpEndpoint } from "@/lib/mcp/endpoint";

// Verifies a bearer token and reads the environment, so it must never be
// prerendered or cached.
export const dynamic = "force-dynamic";

/**
 * The Model Context Protocol endpoint.
 *
 * POST only, deliberately. Revision 2026-07-28 is a stateless request/response
 * protocol carried entirely over POST; the GET and DELETE of the 2025 era were
 * session operations, and this endpoint serves no sessions. A GET here is not
 * an unauthorized MCP call, it is not an MCP call at all.
 *
 * The wiring lives in src/lib/mcp/endpoint.ts so the tests can exercise the
 * real thing rather than a copy of it.
 */
let endpoint: ((request: Request) => Promise<Response>) | undefined;

/**
 * Built lazily and memoised.
 *
 * Constructing the endpoint reads the auth instance, which reads
 * BETTER_AUTH_SECRET and opens a database connection. `next build` evaluates
 * route modules with neither available, so this must not happen at module
 * scope. Same rule as getAuth() and getDb(); see src/lib/auth.ts.
 */
function getEndpoint(): (request: Request) => Promise<Response> {
  endpoint ??= createMcpEndpoint(getAuth());
  return endpoint;
}

export async function POST(request: Request): Promise<Response> {
  return getEndpoint()(request);
}
