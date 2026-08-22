"use client";

import { useState } from "react";
import { authClient } from "@/lib/auth-client";

/**
 * Approve or deny buttons for the OAuth consent screen.
 *
 * The authorization query still on the address bar is the flow's signed state.
 * The auth client's oauthProviderClient plugin attaches it to these calls
 * automatically, which is why nothing is passed explicitly here and why this
 * component must stay on the consent URL until the server answers.
 */
export function ConsentForm() {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function decide(accept: boolean) {
    setBusy(true);
    setError(null);

    const result = await authClient.oauth2.consent({ accept });
    if (result.error) {
      setError(result.error.message ?? "Could not complete authorization. Try again.");
      setBusy(false);
      return;
    }

    const redirectUri = (result.data as { redirect_uri?: string } | null)?.redirect_uri;
    if (!redirectUri) {
      setError("The server did not say where to go next. Start the authorization again.");
      setBusy(false);
      return;
    }

    // A full navigation, not a router push: the destination belongs to the
    // application that asked, which is outside this app's router.
    window.location.href = redirectUri;
  }

  return (
    <div className="mt-8 flex flex-col gap-3">
      {error ? (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      ) : null}

      <button
        type="button"
        disabled={busy}
        onClick={() => void decide(true)}
        className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
      >
        {busy ? "Working..." : "Approve"}
      </button>

      <button
        type="button"
        disabled={busy}
        onClick={() => void decide(false)}
        className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 disabled:opacity-60"
      >
        Deny
      </button>
    </div>
  );
}
