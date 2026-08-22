import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth-server";
import { ConsentForm } from "@/app/consent/consent-form";

// Reads the session and the request's query string, so it must never be
// prerendered.
export const dynamic = "force-dynamic";

/**
 * Human-readable labels for the scopes this server issues. A consent screen
 * that shows raw scope strings is not consent: the person clicking approve has
 * to be able to tell what they are handing over.
 *
 * An unknown scope falls back to the raw string rather than being hidden.
 * Hiding it would understate what is being granted.
 */
const SCOPE_LABELS: Record<string, string> = {
  openid: "Confirm who you are",
  profile: "See your name",
  email: "See your email address",
  offline_access: "Stay connected when you are not here",
  mcp: "Use this application's tools on your behalf",
};

type ConsentPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * The OAuth consent screen, named by `consentPage` in src/lib/auth.ts.
 *
 * Better Auth redirects here mid-authorization with the client id and the
 * requested scopes on the query string. Approving posts back to the consent
 * endpoint, which returns the redirect_uri to send the caller onward to.
 */
export default async function ConsentPage({ searchParams }: ConsentPageProps) {
  const session = await getSession();

  const params = await searchParams;
  const first = (value: string | string[] | undefined): string =>
    Array.isArray(value) ? (value[0] ?? "") : (value ?? "");

  // Not signed in: nothing to consent with. Forward to the login page carrying
  // the SAME query string, which is how this authorization flow is resumed.
  // That query is signed state, not decoration: the login form posts it back
  // (via the oauthProviderClient plugin) and the server picks the flow up where
  // it left off. Dropping or re-encoding it strands the flow.
  if (!session) {
    const query = new URLSearchParams(
      Object.entries(params).flatMap(([key, value]) => {
        const v = first(value);
        return v ? [[key, v] as [string, string]] : [];
      }),
    ).toString();
    redirect(query ? `/login?${query}` : "/login");
  }

  const clientId = first(params.client_id);
  const scopes = first(params.scope).split(" ").filter(Boolean);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-6 py-12">
      <h1 className="text-2xl font-semibold tracking-tight">Authorize access</h1>
      <p className="mt-1 text-sm text-slate-600">
        An application wants to act on your behalf, signed in as{" "}
        <span className="font-medium text-slate-900">{session.email}</span>.
      </p>

      {clientId ? (
        <p className="mt-4 text-sm text-slate-600">
          Application: <span className="font-mono text-slate-900">{clientId}</span>
        </p>
      ) : null}

      <h2 className="mt-6 text-sm font-medium text-slate-900">It will be able to:</h2>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-600">
        {scopes.length > 0 ? (
          scopes.map((scope) => (
            <li key={scope}>{SCOPE_LABELS[scope] ?? scope}</li>
          ))
        ) : (
          <li>Nothing was requested, which is unusual. Deny unless you expected this.</li>
        )}
      </ul>

      <ConsentForm />

      <p className="mt-6 text-xs text-slate-500">
        You can revoke this at any time by signing out of the application that asked.
      </p>
    </main>
  );
}
