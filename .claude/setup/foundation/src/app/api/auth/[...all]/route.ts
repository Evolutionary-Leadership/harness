import { toNextJsHandler } from "better-auth/next-js";
import { getAuth } from "@/lib/auth";

/**
 * Better Auth's own endpoints (sign in, sign up, sign out, session).
 *
 * The handlers are built per request rather than at module scope: getAuth()
 * reads BETTER_AUTH_SECRET and opens a database connection, and Next evaluates
 * route modules during `next build` with neither available.
 */
export async function POST(request: Request): Promise<Response> {
  return toNextJsHandler(getAuth()).POST(request);
}

export async function GET(request: Request): Promise<Response> {
  return toNextJsHandler(getAuth()).GET(request);
}
