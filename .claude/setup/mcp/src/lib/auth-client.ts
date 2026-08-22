"use client";

import { oauthProviderClient } from "@better-auth/oauth-provider/client";
import { createAuthClient } from "better-auth/react";

/**
 * The browser side auth client.
 *
 * No baseURL: Better Auth defaults to the current origin, which is what makes
 * this work unchanged on localhost, on dev, on production, and on every ephemeral
 * feature environment without a build time variable.
 *
 * The oauthProviderClient plugin is what makes the consent page work. The
 * authorization request's own query string is the state the server needs to
 * resume the flow after the user decides, and this plugin signs the current
 * page's query and attaches it to the consent call automatically. Without it
 * the consent POST arrives with nothing to resume and the flow dead ends.
 */
export const authClient = createAuthClient({
  plugins: [oauthProviderClient()],
});
