import { cimd } from "@better-auth/cimd";
import { fetchClientMetadataResource } from "@better-auth/cimd/node";
import { mcp } from "@better-auth/mcp";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { jwt } from "better-auth/plugins";
import { getDb } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { getEnv, getPublicOrigin, getTrustedOrigins, isSignupAllowed } from "@/lib/env";
import { MCP_SCOPE, getMcpResource } from "@/lib/mcp/resource";
import { hashPassword, verifyPassword } from "@/lib/password";

/**
 * The factory is separate from the accessor so `Auth` can be inferred FROM it.
 *
 * `ReturnType<typeof betterAuth>` does not work here: betterAuth is generic in
 * its options object, and naming the unparameterized return type widens the
 * options to BetterAuthOptions, which then fails to accept the instance built
 * from our concrete config.
 */
function createAuth() {
  const trustedOrigins = getTrustedOrigins();

  return betterAuth({
    secret: getEnv().BETTER_AUTH_SECRET,

    // ALWAYS set, unlike the non-MCP build where an unset baseURL means
    // "derive it from the request". The OAuth provider below needs a stable
    // absolute issuer at construction time, and derives an empty one without
    // it. See getPublicOrigin() in src/lib/env.ts.
    baseURL: getPublicOrigin(),

    // Spread conditionally. Passing `trustedOrigins: []` REPLACES Better Auth's
    // defaults with an empty allow list, and every sign in then fails with
    // INVALID_ORIGIN. An empty union has to omit the key entirely.
    ...(trustedOrigins.length > 0 ? { trustedOrigins } : {}),

    database: drizzleAdapter(getDb(), {
      provider: "pg",
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,

        // The OAuth 2.1 tables the mcp() plugin below persists through. The
        // adapter validates every model a plugin declares at construction, so
        // omitting one fails at boot rather than at first use.
        oauthClient: schema.oauthClient,
        oauthResource: schema.oauthResource,
        oauthClientResource: schema.oauthClientResource,
        oauthRefreshToken: schema.oauthRefreshToken,
        oauthAccessToken: schema.oauthAccessToken,
        oauthConsent: schema.oauthConsent,
        oauthClientAssertion: schema.oauthClientAssertion,

        // Signing keys for the access tokens, from the jwt() plugin.
        jwks: schema.jwks,
      },
    }),

    emailAndPassword: {
      enabled: true,
      // Enforced SERVER side. Hiding the signup form is UX, not a control.
      disableSignUp: !isSignupAllowed(),
      requireEmailVerification: false,
      minPasswordLength: 8,
      password: {
        hash: hashPassword,
        verify: ({ hash, password }) => verifyPassword(hash, password),
      },
    },

    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
      cookieCache: {
        // Explicitly OFF. A cached session cookie means a revoked session keeps
        // working until the cache expires; every request re-reads the database
        // row instead, so revocation is immediate. See docs/SECURITY.md.
        enabled: false,
        maxAge: 0,
      },
    },

    account: {
      accountLinking: { enabled: false },
    },

    plugins: [
      // Signs the access tokens the MCP resource server verifies through JWKS.
      // mcp() issues them; without this there is no key to verify against.
      jwt(),

      // Turns this app into the OAuth 2.1 authorization server AND protected
      // resource for MCP. Tokens are audience-bound to the resource below and
      // scoped per user, so an agent reaches one person's data and no one
      // else's. The endpoint is never a token issuer for anything but itself;
      // it does not forward a caller's token upstream. See ADR 0007.
      mcp({
        loginPage: "/login",
        consentPage: "/consent",
        resource: getMcpResource(),
        scopes: ["openid", "profile", "email", "offline_access", MCP_SCOPE],
      }),

      // Client ID Metadata Documents, pinned to the MCP revision this server
      // serves. The 2026-07-28 revision deprecates Dynamic Client Registration
      // in favour of CIMD, and the endpoint is modern-only (ADR 0007), so this
      // is the only client onboarding path offered.
      cimd({
        fetchClientMetadataResource,
        metadataProfile: "mcp-2026-07-28",
      }),

      // Must be last: it lets Better Auth set cookies from Server Actions.
      nextCookies(),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;

let instance: Auth | undefined;

/**
 * The Better Auth instance, created lazily.
 *
 * Same reason as getDb(): constructing it reads BETTER_AUTH_SECRET and opens a
 * database connection, and Next evaluates modules during `next build` with
 * neither available. Nothing may call this at module scope.
 */
export function getAuth(): Auth {
  instance ??= createAuth();
  return instance;
}
