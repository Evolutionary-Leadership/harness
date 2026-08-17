import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { getDb } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { getAuthBaseUrl, getEnv, getTrustedOrigins, isSignupAllowed } from "@/lib/env";
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
  const baseURL = getAuthBaseUrl();

  return betterAuth({
    secret: getEnv().BETTER_AUTH_SECRET,
    // Undefined means localhost, which is correct under `next dev`.
    ...(baseURL ? { baseURL } : {}),

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

    // Must be last: it lets Better Auth set cookies from Server Actions.
    plugins: [nextCookies()],
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
