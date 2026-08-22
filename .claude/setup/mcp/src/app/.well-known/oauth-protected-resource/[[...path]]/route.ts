import { getAuth } from "@/lib/auth";

// Serves a discovery document derived from the request's own origin.
export const dynamic = "force-dynamic";

/**
 * RFC 9728 protected resource metadata, at the ONE path the specification
 * allows it to live: the origin root, not under Better Auth's base path.
 *
 * This route exists because those two disagree. Better Auth answers this
 * document when the request path is literally `/.well-known/oauth-protected-
 * resource` (optionally with the resource's own path appended, which is RFC
 * 9728 path insertion), but every other Better Auth route is mounted under
 * /api/auth, and Next only routes what has a file. Without this file the 401
 * challenge from /api/mcp points at a 404 and no client can begin the
 * authorization flow.
 *
 * The request is forwarded UNCHANGED. Better Auth matches on the literal path,
 * so a rewrite that rebases the URL under /api/auth would stop matching; that
 * is why this is a route and not a `rewrites()` entry in next.config.ts.
 *
 * The optional catch-all serves both the bare document and the path-inserted
 * form (`/.well-known/oauth-protected-resource/api/mcp`), because clients
 * differ in which they request.
 */
export async function GET(request: Request): Promise<Response> {
  return getAuth().handler(request);
}
