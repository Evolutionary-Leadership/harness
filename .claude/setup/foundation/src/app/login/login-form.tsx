"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import type { DemoLogin } from "@/lib/env";

/**
 * The credentialed sign in form.
 *
 * It NEVER reads process.env or the SHOW_DEMO_LOGIN flag. Whether a demo button
 * exists is decided by the Server Component that renders this and handed over as
 * the `demoLogin` prop; when that prop is null there is nothing here to hide.
 */
export function LoginForm({ demoLogin }: { demoLogin: DemoLogin | null }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function signIn(withEmail: string, withPassword: string) {
    setBusy(true);
    setError(null);

    const result = await authClient.signIn.email({ email: withEmail, password: withPassword });
    if (result.error) {
      setError(result.error.message ?? "Could not sign in. Check your email and password.");
      setBusy(false);
      return;
    }

    router.replace("/notes");
  }

  return (
    <form
      className="mt-8 flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void signIn(email, password);
      }}
    >
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-slate-700">Email</span>
        <input
          name="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-slate-700">Password</span>
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900"
        />
      </label>

      {error ? (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={busy}
        className="rounded-md bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
      >
        {busy ? "Signing in…" : "Sign in"}
      </button>

      {/*
        Rendered only when the prop is non null. Clicking it fills the fields and
        submits through the SAME credentialed path as a typed sign in: there is no
        bypass route and no magic token.
      */}
      {demoLogin ? (
        <button
          type="button"
          data-testid="demo-login"
          disabled={busy}
          onClick={() => {
            setEmail(demoLogin.email);
            setPassword(demoLogin.password);
            void signIn(demoLogin.email, demoLogin.password);
          }}
          className="rounded-md border border-dashed border-slate-400 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
        >
          Sign in as the demo user
        </button>
      ) : null}
    </form>
  );
}
