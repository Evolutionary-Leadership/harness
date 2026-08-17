/**
 * THIS FILE IS NOT THE SECURITY BOUNDARY.
 *
 * Say it plainly because the shape of the file invites the opposite assumption:
 * everything here is rate limiting and redirect UX only. It does not verify
 * sessions, and nothing downstream may assume it did.
 *
 * The reasons it cannot be the boundary:
 *  - It only looks for the PRESENCE of a session cookie. It does not, and must
 *    not, hit the database to validate one. A stale or forged cookie sails
 *    through here.
 *  - Server Actions are HTTP endpoints callable directly, and a matcher that
 *    covers page routes does not cover them.
 *  - The in-memory rate limit below is per instance. Two instances mean two
 *    independent buckets.
 *
 * The real boundary is `requireSession()` in src/lib/auth-server.ts, called by
 * every action and data route. See docs/SECURITY.md.
 */
import { NextResponse, type NextRequest } from "next/server";

/** Better Auth's default session cookie name. Presence only, never trust. */
const SESSION_COOKIE = "better-auth.session_token";

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 30;

/**
 * Per instance, in memory, best effort. Enough to blunt a naive credential
 * stuffing loop against the auth endpoints; not a substitute for a real limiter.
 * Bounded so a flood of distinct keys cannot grow it without limit.
 */
const buckets = new Map<string, { count: number; resetAt: number }>();
const MAX_TRACKED_KEYS = 10_000;

function rateLimited(key: string): boolean {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    if (buckets.size >= MAX_TRACKED_KEYS) {
      for (const [candidate, entry] of buckets) {
        if (entry.resetAt <= now) buckets.delete(candidate);
      }
      if (buckets.size >= MAX_TRACKED_KEYS) buckets.clear();
    }
    buckets.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }

  bucket.count += 1;
  return bucket.count > RATE_LIMIT_MAX_REQUESTS;
}

export function proxy(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;

  // 1. Rate limiting, on the auth endpoints only.
  if (pathname.startsWith("/api/auth")) {
    const forwardedFor = request.headers.get("x-forwarded-for");
    const ip = forwardedFor?.split(",")[0]?.trim() ?? "unknown";
    if (rateLimited(`${ip}:${pathname}`)) {
      return NextResponse.json(
        { ok: false, error: { code: "rate_limited", message: "Too many attempts. Try again shortly." } },
        { status: 429, headers: { "retry-after": String(RATE_LIMIT_WINDOW_MS / 1000) } },
      );
    }
    return NextResponse.next();
  }

  // 2. Redirect UX. A cookie-less visitor to a signed in page is sent to the
  // login screen so they do not watch a page render and then bounce. The page
  // itself still calls getSession(); this only saves a round trip.
  const hasSessionCookie =
    request.cookies.has(SESSION_COOKIE) || request.cookies.has(`__Secure-${SESSION_COOKIE}`);

  if (!hasSessionCookie && pathname.startsWith("/notes")) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/notes/:path*", "/api/auth/:path*"],
};
