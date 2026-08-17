import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth-server";
import { isSignupAllowed } from "@/lib/env";
import { SignupForm } from "@/app/signup/signup-form";

export const dynamic = "force-dynamic";

export default async function SignupPage() {
  const session = await getSession();
  if (session) redirect("/notes");

  // Hiding the form is UX. The control that matters is `disableSignUp` on the
  // Better Auth instance, which makes the endpoint itself reject. See
  // docs/SECURITY.md and tests/integration/signup-closed.test.ts.
  const allowed = isSignupAllowed();

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-6 py-12">
      <h1 className="text-2xl font-semibold tracking-tight">Create an account</h1>

      {allowed ? (
        <SignupForm />
      ) : (
        <p className="mt-4 rounded-md border border-slate-200 bg-white p-4 text-sm text-slate-600">
          Signup is closed on this environment.
        </p>
      )}

      <p className="mt-6 text-sm text-slate-600">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-slate-900 underline">
          Sign in
        </Link>
      </p>
    </main>
  );
}
