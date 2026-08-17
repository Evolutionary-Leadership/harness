import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { eq } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import { hashPassword, verifyPassword } from "@/lib/password";
import { setupIntegrationDb, type IntegrationDb } from "./helpers/database";

/**
 * Auth against a real database.
 *
 * The Better Auth instance is built here rather than imported from src/lib/auth.ts
 * so each test can vary `disableSignUp` without mutating module-level state. The
 * configuration mirrors src/lib/auth.ts; the properties under test are the ones
 * docs/SECURITY.md claims.
 */

// Definite assignment: beforeAll sets it. The one place that cannot assume so
// is afterAll, which runs even when beforeAll threw, and guards with `?.`.
let ctx!: IntegrationDb;

function makeAuth(options: { allowSignup: boolean }) {
  return betterAuth({
    secret: "integration-test-secret-that-is-long-enough",
    baseURL: "http://localhost:3000",
    database: drizzleAdapter(ctx.db, {
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
      disableSignUp: !options.allowSignup,
      requireEmailVerification: false,
      minPasswordLength: 8,
      password: {
        hash: hashPassword,
        verify: ({ hash, password }) => verifyPassword(hash, password),
      },
    },
    session: { cookieCache: { enabled: false, maxAge: 0 } },
  });
}

beforeAll(async () => {
  ctx = await setupIntegrationDb();
});

afterAll(async () => {
  // beforeAll may have thrown (no reachable database), leaving ctx unassigned.
  // Without the guard, that real failure is buried under a teardown TypeError.
  await ctx?.teardown();
});

beforeEach(async () => {
  await ctx.reset();
});

describe("password hashing", () => {
  it("produces an argon2id digest, not bcrypt or PBKDF2", async () => {
    const digest = await hashPassword("correct horse battery staple");
    // The $argon2id$ prefix is the assertion: a bcrypt digest starts with $2b$.
    expect(digest.startsWith("$argon2id$")).toBe(true);
  });

  it("verifies the right password and rejects the wrong one", async () => {
    const digest = await hashPassword("right-password");
    expect(await verifyPassword(digest, "right-password")).toBe(true);
    expect(await verifyPassword(digest, "wrong-password")).toBe(false);
  });

  it("salts, so the same password hashes differently every time", async () => {
    expect(await hashPassword("same")).not.toBe(await hashPassword("same"));
  });

  it("returns false rather than throwing on a corrupted digest", async () => {
    expect(await verifyPassword("not-a-digest", "anything")).toBe(false);
    expect(await verifyPassword("", "anything")).toBe(false);
  });
});

describe("signup gating", () => {
  it("creates an account when signup is open", async () => {
    const auth = makeAuth({ allowSignup: true });
    const result = await auth.api.signUpEmail({
      body: { name: "New", email: "new@example.invalid", password: "long-enough-password" },
    });
    expect(result.user.email).toBe("new@example.invalid");
  });

  /**
   * The claim in section 13: with ALLOW_SIGNUP=false the ENDPOINT rejects, not
   * just the UI. Hiding the form is cosmetic; this is the control.
   */
  it("rejects at the endpoint when signup is closed", async () => {
    const auth = makeAuth({ allowSignup: false });

    await expect(
      auth.api.signUpEmail({
        body: { name: "Blocked", email: "blocked@example.invalid", password: "long-enough-password" },
      }),
    ).rejects.toThrow();

    // And no row was written.
    const rows = await ctx.db
      .select({ id: schema.user.id })
      .from(schema.user)
      .where(eq(schema.user.email, "blocked@example.invalid"));
    expect(rows).toEqual([]);
  });

  it("stores an argon2id hash rather than the password", async () => {
    const auth = makeAuth({ allowSignup: true });
    await auth.api.signUpEmail({
      body: { name: "Hashed", email: "hashed@example.invalid", password: "a-real-password-123" },
    });

    const [row] = await ctx.db
      .select({ password: schema.account.password })
      .from(schema.account)
      .innerJoin(schema.user, eq(schema.account.userId, schema.user.id))
      .where(eq(schema.user.email, "hashed@example.invalid"));

    expect(row?.password).toBeTruthy();
    expect(row?.password).not.toContain("a-real-password-123");
    expect(row?.password?.startsWith("$argon2id$")).toBe(true);
  });

  it("rejects a password below the minimum length", async () => {
    const auth = makeAuth({ allowSignup: true });
    await expect(
      auth.api.signUpEmail({
        body: { name: "Short", email: "short@example.invalid", password: "short" },
      }),
    ).rejects.toThrow();
  });
});

describe("sessions", () => {
  it("signs in with the right password and issues a database session", async () => {
    const auth = makeAuth({ allowSignup: true });
    await auth.api.signUpEmail({
      body: { name: "Signer", email: "signer@example.invalid", password: "a-real-password-123" },
    });

    const signedIn = await auth.api.signInEmail({
      body: { email: "signer@example.invalid", password: "a-real-password-123" },
    });
    expect(signedIn.token).toBeTruthy();

    // The session is a real row, which is what makes revocation immediate.
    const rows = await ctx.db.select({ token: schema.session.token }).from(schema.session);
    expect(rows.length).toBeGreaterThan(0);
  });

  it("refuses the wrong password", async () => {
    const auth = makeAuth({ allowSignup: true });
    await auth.api.signUpEmail({
      body: { name: "Signer", email: "signer2@example.invalid", password: "a-real-password-123" },
    });

    await expect(
      auth.api.signInEmail({
        body: { email: "signer2@example.invalid", password: "the-wrong-password" },
      }),
    ).rejects.toThrow();
  });

  /**
   * Why the cookie cache is explicitly disabled: with it on, a deleted session row
   * would keep validating until the cache expired.
   */
  it("stops honouring a session as soon as its row is deleted", async () => {
    const auth = makeAuth({ allowSignup: true });
    await auth.api.signUpEmail({
      body: { name: "Revoked", email: "revoked@example.invalid", password: "a-real-password-123" },
    });

    // Sessions are cookie based, so the session is carried the way a browser
    // carries it. An `authorization: Bearer` header would need the bearer plugin,
    // which this app does not enable.
    const response = await auth.api.signInEmail({
      body: { email: "revoked@example.invalid", password: "a-real-password-123" },
      asResponse: true,
    });
    const setCookie = response.headers.get("set-cookie");
    expect(setCookie).toBeTruthy();
    const cookie = setCookie!.split(";")[0]!;
    const headers = new Headers({ cookie });

    const before = await auth.api.getSession({ headers });
    expect(before?.user.email).toBe("revoked@example.invalid");

    // Revoke by deleting the row, exactly what an admin or a sign-out-everywhere
    // would do.
    const token = before!.session.token;
    await ctx.db.delete(schema.session).where(eq(schema.session.token, token));

    // Immediately invalid. With the cookie cache enabled this would keep
    // validating until the cache expired, which is why it is off.
    const after = await auth.api.getSession({ headers });
    expect(after).toBeNull();
  });

  it("cascades sessions away when the user is deleted", async () => {
    const auth = makeAuth({ allowSignup: true });
    const created = await auth.api.signUpEmail({
      body: { name: "Doomed", email: "doomed@example.invalid", password: "a-real-password-123" },
    });
    await auth.api.signInEmail({
      body: { email: "doomed@example.invalid", password: "a-real-password-123" },
    });

    await ctx.db.delete(schema.user).where(eq(schema.user.id, created.user.id));

    const sessions = await ctx.db
      .select({ id: schema.session.id })
      .from(schema.session)
      .where(eq(schema.session.userId, created.user.id));
    expect(sessions).toEqual([]);
  });
});
