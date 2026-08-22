import { getAuth } from "@/lib/auth";

// Serves a discovery document derived from the request's own origin.
export const dynamic = "force-dynamic";

/**
 * RFC 8414 authorization server metadata, at the origin root.
 *
 * This server's issuer carries a path (`<origin>/api/auth`), so RFC 8414 puts
 * its metadata at `/.well-known/oauth-authorization-server/api/auth`: the
 * issuer's path is INSERTED after the well-known segment rather than appended
 * to it. That is the URL a client builds after reading `authorization_servers`
 * from the protected resource metadata, and, like the document above, nothing
 * in Next routes it without this file.
 *
 * Same rule as the protected-resource route beside it: the request is
 * forwarded unchanged, because Better Auth matches the literal path, so a
 * rewrite that rebased the URL under /api/auth would stop matching.
 */
export async function GET(request: Request): Promise<Response> {
  return getAuth().handler(request);
}
