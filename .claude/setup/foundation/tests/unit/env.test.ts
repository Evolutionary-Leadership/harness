import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getAuthBaseUrl,
  getDemoLogin,
  getEnv,
  getSeedDemoLogin,
  getTrustedOrigins,
  isProductionEnvironment,
  isSignupAllowed,
  resetEnvCache,
  shouldSeed,
} from "@/lib/env";

/**
 * Environment handling is a boundary, so it gets tested like one. Every case here
 * corresponds to a rule in docs/architecture/configuration.md.
 */

const REQUIRED = {
  DATABASE_URL: "postgresql://user:pass@localhost:5432/db",
  BETTER_AUTH_SECRET: "x".repeat(32),
};

let original: NodeJS.ProcessEnv;

/** Replace the environment with exactly `vars`, so leakage cannot mask a bug. */
function setEnv(vars: Record<string, string | undefined>): void {
  for (const key of Object.keys(process.env)) delete process.env[key];
  for (const [key, value] of Object.entries(vars)) {
    if (value !== undefined) process.env[key] = value;
  }
  resetEnvCache();
}

beforeEach(() => {
  original = { ...process.env };
});

afterEach(() => {
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, original);
  resetEnvCache();
});

describe("getEnv", () => {
  it("accepts an environment with only the two required variables", () => {
    setEnv(REQUIRED);
    expect(getEnv().DATABASE_URL).toBe(REQUIRED.DATABASE_URL);
  });

  it("aggregates every problem into one error rather than failing on the first", () => {
    setEnv({ BETTER_AUTH_SECRET: "too-short" });
    let message = "";
    try {
      getEnv();
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain("DATABASE_URL");
    expect(message).toContain("BETTER_AUTH_SECRET");
    expect(message).toContain("2 problem(s)");
  });

  it("rejects a secret shorter than 32 characters", () => {
    setEnv({ ...REQUIRED, BETTER_AUTH_SECRET: "x".repeat(31) });
    expect(() => getEnv()).toThrow(/BETTER_AUTH_SECRET/);
  });

  it("caches, so repeated calls do not re-parse", () => {
    setEnv(REQUIRED);
    expect(getEnv()).toBe(getEnv());
  });

  it("does not require any feature-scoped variable", () => {
    // A required-but-unused variable would be a crash loop on every environment
    // that lacks it, which is why only DATABASE_URL and BETTER_AUTH_SECRET are
    // required.
    setEnv(REQUIRED);
    expect(() => getEnv()).not.toThrow();
    expect(getEnv().SEED_DATA).toBeUndefined();
    expect(getEnv().BETTER_AUTH_URL).toBeUndefined();
  });

  it("rejects a malformed BETTER_AUTH_URL", () => {
    setEnv({ ...REQUIRED, BETTER_AUTH_URL: "notes.example.com" });
    expect(() => getEnv()).toThrow(/BETTER_AUTH_URL/);
  });
});

describe("auth origin", () => {
  it("prefers BETTER_AUTH_URL when set", () => {
    setEnv({
      ...REQUIRED,
      BETTER_AUTH_URL: "https://notes.example.com",
      RAILWAY_PUBLIC_DOMAIN: "notes-preprod.up.railway.app",
    });
    expect(getAuthBaseUrl()).toBe("https://notes.example.com");
  });

  it("falls back to the Railway domain, which is how feature environments self configure", () => {
    setEnv({ ...REQUIRED, RAILWAY_PUBLIC_DOMAIN: "notes-pr-7.up.railway.app" });
    expect(getAuthBaseUrl()).toBe("https://notes-pr-7.up.railway.app");
  });

  it("returns undefined locally, which Better Auth reads as localhost", () => {
    setEnv(REQUIRED);
    expect(getAuthBaseUrl()).toBeUndefined();
  });

  it("strips a trailing slash", () => {
    setEnv({ ...REQUIRED, BETTER_AUTH_URL: "https://notes.example.com/" });
    expect(getAuthBaseUrl()).toBe("https://notes.example.com");
  });

  it("unions both origins so a custom domain and the railway host both work", () => {
    setEnv({
      ...REQUIRED,
      BETTER_AUTH_URL: "https://notes.example.com",
      RAILWAY_PUBLIC_DOMAIN: "notes.up.railway.app",
    });
    expect(getTrustedOrigins().sort()).toEqual([
      "https://notes.example.com",
      "https://notes.up.railway.app",
    ]);
  });

  it("returns an EMPTY union locally, which the caller must omit rather than pass", () => {
    // Passing `trustedOrigins: []` to Better Auth replaces its defaults and makes
    // every sign in fail with INVALID_ORIGIN. src/lib/auth.ts spreads the key
    // conditionally for exactly this case.
    setEnv(REQUIRED);
    expect(getTrustedOrigins()).toEqual([]);
  });

  it("deduplicates when both variables name the same origin", () => {
    setEnv({
      ...REQUIRED,
      BETTER_AUTH_URL: "https://notes.up.railway.app",
      RAILWAY_PUBLIC_DOMAIN: "notes.up.railway.app",
    });
    expect(getTrustedOrigins()).toEqual(["https://notes.up.railway.app"]);
  });
});

describe("switches", () => {
  it("treats production as an environment NAME, never NODE_ENV", () => {
    // Every deployed environment runs NODE_ENV=production, preprod and feature
    // environments included, so NODE_ENV cannot answer this question.
    setEnv({ ...REQUIRED, NODE_ENV: "production", RAILWAY_ENVIRONMENT_NAME: "preprod" });
    expect(isProductionEnvironment()).toBe(false);

    setEnv({ ...REQUIRED, NODE_ENV: "production", RAILWAY_ENVIRONMENT_NAME: "production" });
    expect(isProductionEnvironment()).toBe(true);
  });

  it("is not production when the environment name is absent", () => {
    setEnv({ ...REQUIRED, NODE_ENV: "production" });
    expect(isProductionEnvironment()).toBe(false);
  });

  it('seeds only when SEED_DATA is exactly "true"', () => {
    for (const value of [undefined, "false", "TRUE", "1", "yes", " true"]) {
      setEnv({ ...REQUIRED, SEED_DATA: value });
      expect(shouldSeed()).toBe(false);
    }
    setEnv({ ...REQUIRED, SEED_DATA: "true" });
    expect(shouldSeed()).toBe(true);
  });

  it('closes signup only when ALLOW_SIGNUP is exactly "false"', () => {
    setEnv({ ...REQUIRED, ALLOW_SIGNUP: "false" });
    expect(isSignupAllowed()).toBe(false);

    for (const value of [undefined, "true", "FALSE", "0", "no"]) {
      setEnv({ ...REQUIRED, ALLOW_SIGNUP: value });
      expect(isSignupAllowed()).toBe(true);
    }
  });
});

describe("demo login", () => {
  it('returns null unless SHOW_DEMO_LOGIN is exactly "true"', () => {
    for (const value of [undefined, "false", "TRUE", "1", "yes"]) {
      setEnv({ ...REQUIRED, SHOW_DEMO_LOGIN: value });
      expect(getDemoLogin()).toBeNull();
    }
  });

  it("returns the fallback credentials when enabled with no overrides", () => {
    setEnv({ ...REQUIRED, SHOW_DEMO_LOGIN: "true" });
    const demo = getDemoLogin();
    expect(demo).not.toBeNull();
    expect(demo?.email).toContain("@example.invalid");
    expect(demo?.password.length).toBeGreaterThanOrEqual(8);
  });

  it("honours the overrides", () => {
    setEnv({
      ...REQUIRED,
      SHOW_DEMO_LOGIN: "true",
      DEMO_LOGIN_EMAIL: "someone@example.invalid",
      DEMO_LOGIN_PASSWORD: "another-password",
    });
    expect(getDemoLogin()).toEqual({
      email: "someone@example.invalid",
      password: "another-password",
    });
  });

  it("gives the seed the credentials even when the button is off", () => {
    // Whether the account EXISTS and whether the button SHOWS are different
    // questions. The seed must always be able to create the account.
    setEnv({ ...REQUIRED, SHOW_DEMO_LOGIN: "false" });
    expect(getDemoLogin()).toBeNull();
    expect(getSeedDemoLogin().email).toContain("@example.invalid");
  });

  it("shares one reader, so both accessors agree when enabled", () => {
    setEnv({
      ...REQUIRED,
      SHOW_DEMO_LOGIN: "true",
      DEMO_LOGIN_EMAIL: "shared@example.invalid",
    });
    expect(getDemoLogin()).toEqual(getSeedDemoLogin());
  });
});
