import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth-server";
import { getDemoLogin, isSignupAllowed } from "@/lib/env";
import { LoginForm } from "@/app/login/login-form";

// Reads the session and the environment, so it must never be prerendered.
export const dynamic = "force-dynamic";

/**
 * A SERVER COMPONENT on purpose.
 *
 * It calls getDemoLogin() at render time and passes the result down as a prop.
 * The client form never reads process.env and never sees the flag, so when
 * SHOW_DEMO_LOGIN is not exactly "true" the demo credentials do not appear in the
 * page payload OR in any client chunk. The goal is not a hidden button: on
 * production the credentials never enter the bundle at all.
 */
export default async function LoginPage() {
  const session = await getSession();
  if (session) redirect("/notes");

  const demoLogin = getDemoLogin();

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-6 py-12">
      <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
      <p className="mt-1 text-sm text-slate-600">Your notes, wherever you left them.</p>

      <LoginForm demoLogin={demoLogin} />

      {isSignupAllowed() ? (
        <p className="mt-6 text-sm text-slate-600">
          No account yet?{" "}
          <Link href="/signup" className="font-medium text-slate-900 underline">
            Create one
          </Link>
        </p>
      ) : (
        <p className="mt-6 text-sm text-slate-500">Signup is closed on this environment.</p>
      )}
    </main>
  );
}
