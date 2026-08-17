import { headers } from "next/headers";
import { getAuth } from "@/lib/auth";
import { UnauthenticatedError } from "@/lib/errors";

export type SessionUser = {
  id: string;
  email: string;
  name: string;
};

/**
 * Read and VERIFY the session against the database.
 *
 * Every signed in page, Server Action, and data route calls this itself. A check
 * in a layout is convenience for redirect UX, never the security boundary: a
 * Server Action is an HTTP endpoint that can be called directly, without the
 * layout that renders the page ever running. Same for src/proxy.ts.
 *
 * Returns null rather than throwing, so a page can render a signed out state.
 */
export async function getSession(): Promise<SessionUser | null> {
  const result = await getAuth().api.getSession({ headers: await headers() });
  if (!result?.user) return null;

  return {
    id: result.user.id,
    email: result.user.email,
    name: result.user.name,
  };
}

/**
 * getSession(), but throws UnauthenticatedError when there is no session.
 *
 * The action wrapper catches that and returns
 * `{ ok: false, error: { code: "unauthenticated" } }`. It does NOT redirect:
 * an optimistic client needs a value it can reconcile, not a 307.
 */
export async function requireSession(): Promise<SessionUser> {
  const session = await getSession();
  if (!session) throw new UnauthenticatedError();
  return session;
}
