import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { count } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import { setupIntegrationDb, type IntegrationDb } from "./helpers/database";

/**
 * The seed's three contractual properties, exercised by running the real script
 * as a subprocess rather than by importing it: the script's own env gating and
 * production guard are part of what is under test, and importing it would bypass
 * both.
 */

const run = promisify(execFile);

// Definite assignment: beforeAll sets it. The one place that cannot assume so
// is afterAll, which runs even when beforeAll threw, and guards with `?.`.
let ctx!: IntegrationDb;
let databaseUrl: string;

beforeAll(async () => {
  ctx = await setupIntegrationDb();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error(
      "tests/integration/seed.test.ts needs TEST_DATABASE_URL: the seed runs as a " +
        "subprocess, so it cannot reach a Testcontainers URL held only in this process.",
    );
  }
  databaseUrl = url;
});

afterAll(async () => {
  // beforeAll may have thrown (no reachable database), leaving ctx unassigned.
  // Without the guard, that real failure is buried under a teardown TypeError.
  await ctx?.teardown();
});

beforeEach(async () => {
  await ctx.reset();
});

type SeedEnv = Record<string, string | undefined>;

async function runSeed(env: SeedEnv = {}): Promise<{ stdout: string; code: number }> {
  try {
    const result = await run("pnpm", ["seed"], {
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
        BETTER_AUTH_SECRET: "integration-test-secret-that-is-long-enough",
        SEED_DATA: "true",
        RAILWAY_ENVIRONMENT_NAME: undefined,
        ...env,
      } as NodeJS.ProcessEnv,
    });
    return { stdout: result.stdout, code: 0 };
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string; code?: number };
    return { stdout: `${failure.stdout ?? ""}${failure.stderr ?? ""}`, code: failure.code ?? 1 };
  }
}

async function counts(): Promise<Record<string, number>> {
  const [users] = await ctx.db.select({ n: count() }).from(schema.user);
  const [accounts] = await ctx.db.select({ n: count() }).from(schema.account);
  const [notebooks] = await ctx.db.select({ n: count() }).from(schema.notebooks);
  const [notes] = await ctx.db.select({ n: count() }).from(schema.notes);
  return {
    users: Number(users?.n ?? 0),
    accounts: Number(accounts?.n ?? 0),
    notebooks: Number(notebooks?.n ?? 0),
    notes: Number(notes?.n ?? 0),
  };
}

describe("seed", () => {
  it("is idempotent: row counts do not change on a second or third run", async () => {
    const first = await runSeed();
    expect(first.code).toBe(0);
    const after1 = await counts();

    await runSeed();
    const after2 = await counts();

    await runSeed();
    const after3 = await counts();

    expect(after2).toEqual(after1);
    expect(after3).toEqual(after1);
    expect(after1.notes).toBeGreaterThan(0);
  });

  /**
   * The demo account exists whenever the seed runs, independent of
   * SHOW_DEMO_LOGIN. Existence and visibility are separate questions, so the
   * button can never point at a missing user.
   */
  it("creates the demo account even with SHOW_DEMO_LOGIN unset", async () => {
    const result = await runSeed({ SHOW_DEMO_LOGIN: undefined });
    expect(result.code).toBe(0);

    const users = await ctx.db.select({ email: schema.user.email }).from(schema.user);
    expect(users.map((u) => u.email)).toContain("ada.demo@example.invalid");
  });

  it("creates the demo account with SHOW_DEMO_LOGIN=false too", async () => {
    await runSeed({ SHOW_DEMO_LOGIN: "false" });
    const users = await ctx.db.select({ email: schema.user.email }).from(schema.user);
    expect(users.map((u) => u.email)).toContain("ada.demo@example.invalid");
  });

  it("stores an argon2id hash for the demo account", async () => {
    await runSeed();
    const accounts = await ctx.db
      .select({ password: schema.account.password })
      .from(schema.account);
    expect(accounts[0]?.password?.startsWith("$argon2id$")).toBe(true);
  });

  it('does nothing unless SEED_DATA is exactly "true"', async () => {
    for (const value of [undefined, "false", "TRUE", "1"]) {
      await ctx.reset();
      const result = await runSeed({ SEED_DATA: value });
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("skipping");
      // Only the two fixture users the harness seeded.
      expect((await counts()).notes).toBe(0);
    }
  });

  /**
   * The production guard keys on RAILWAY_ENVIRONMENT_NAME, never NODE_ENV: every
   * deployed environment runs NODE_ENV=production, preprod and feature environments
   * included. See ADR 0003.
   */
  it("refuses to run on the production environment", async () => {
    const result = await runSeed({ RAILWAY_ENVIRONMENT_NAME: "production" });
    expect(result.code).not.toBe(0);
    expect(result.stdout).toContain("refusing to run on the production environment");
    expect((await counts()).notes).toBe(0);
  });

  it("still seeds when NODE_ENV is production but the environment is not", async () => {
    // This is the case NODE_ENV cannot distinguish, and the reason it is not used.
    const result = await runSeed({ NODE_ENV: "production", RAILWAY_ENVIRONMENT_NAME: "preprod" });
    expect(result.code).toBe(0);
    expect((await counts()).notes).toBeGreaterThan(0);
  });

  it("honours a DEMO_LOGIN_EMAIL override", async () => {
    await runSeed({ DEMO_LOGIN_EMAIL: "custom.demo@example.invalid" });
    const users = await ctx.db.select({ email: schema.user.email }).from(schema.user);
    expect(users.map((u) => u.email)).toContain("custom.demo@example.invalid");
  });
});
