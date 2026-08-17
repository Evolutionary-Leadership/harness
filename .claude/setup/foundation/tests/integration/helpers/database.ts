import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { sql } from "drizzle-orm";
import postgres from "postgres";
import type { DbClient } from "@/lib/db";
import * as schema from "@/lib/db/schema";

/**
 * The integration harness.
 *
 * ONE container per file (vitest.config.ts sets fileParallelism: false), all
 * migrations applied from scratch, and a TRUNCATE between tests. Foreign keys are
 * real, so fixture rows must reference genuinely seeded users.
 *
 * TEST_DATABASE_URL is the documented ESCAPE HATCH: point it at any reachable
 * Postgres 16 and Testcontainers is skipped entirely. That is what makes this
 * tier runnable on a machine with no Docker daemon.
 */

export type IntegrationDb = {
  db: DbClient;
  /** Truncate every application table, then re-seed the fixture users. */
  reset: () => Promise<void>;
  teardown: () => Promise<void>;
  users: { alice: string; bob: string };
};

/** Tables the migrator owns. Never truncated. */
const MIGRATION_TABLES = ["__drizzle_migrations"];

async function startContainer(): Promise<{ url: string; stop: () => Promise<void> }> {
  try {
    // Imported lazily so a TEST_DATABASE_URL run never loads Testcontainers
    // (which probes for a Docker socket on import).
    const { PostgreSqlContainer } = await import("@testcontainers/postgresql");
    const container = await new PostgreSqlContainer("postgres:16-alpine").start();
    return {
      url: container.getConnectionUri(),
      // Wrapped rather than returned directly: stop() resolves to a
      // StoppedTestContainer, and the caller's contract is Promise<void>.
      stop: async () => {
        await container.stop();
      },
    };
  } catch (cause) {
    // Testcontainers' own message ("Could not find a working container runtime
    // strategy") does not say what to do about it, and the failure then cascades
    // into a confusing teardown error. Say the actionable thing instead.
    throw new Error(
      "Integration tests need a Postgres 16 and found neither.\n" +
        "  - TEST_DATABASE_URL is not set, and\n" +
        "  - Testcontainers could not reach a Docker daemon.\n" +
        "Fix either one:\n" +
        "  - start Docker, or\n" +
        "  - set TEST_DATABASE_URL to a THROWAWAY database (this harness TRUNCATEs every table).\n" +
        "See docs/TESTING.md.",
      { cause },
    );
  }
}

export async function setupIntegrationDb(): Promise<IntegrationDb> {
  const configured = process.env.TEST_DATABASE_URL;

  let url: string;
  let stopContainer: (() => Promise<void>) | null = null;

  if (configured) {
    url = configured;
  } else {
    const container = await startContainer();
    url = container.url;
    stopContainer = container.stop;
  }

  const client = postgres(url, { max: 5, onnotice: () => {} });
  const db = drizzle(client, { schema });

  // Every environment must be able to migrate from scratch, so the test tier
  // exercises exactly that rather than a pre-built database.
  await migrate(drizzle(postgres(url, { max: 1, onnotice: () => {} })), {
    migrationsFolder: "./drizzle",
  });

  const users = { alice: randomUUID(), bob: randomUUID() };

  async function truncateAll(): Promise<void> {
    const rows = await db.execute<{ tablename: string }>(sql`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public'
    `);
    const names = (rows as unknown as { tablename: string }[])
      .map((row) => row.tablename)
      .filter((name) => !MIGRATION_TABLES.includes(name));

    if (names.length === 0) return;
    // One statement, CASCADE, so foreign keys do not dictate an order.
    const list = names.map((name) => `"public"."${name}"`).join(", ");
    await db.execute(sql.raw(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`));
  }

  async function seedUsers(): Promise<void> {
    await db.insert(schema.user).values([
      { id: users.alice, name: "Alice", email: "alice@example.invalid", emailVerified: true },
      { id: users.bob, name: "Bob", email: "bob@example.invalid", emailVerified: true },
    ]);
  }

  async function reset(): Promise<void> {
    await truncateAll();
    await seedUsers();
  }

  await reset();

  return {
    db,
    reset,
    users,
    teardown: async () => {
      await client.end({ timeout: 5 });
      if (stopContainer) await stopContainer();
    },
  };
}

/** Create a notebook owned by `userId`. Real foreign key, real row. */
export async function makeNotebook(
  db: DbClient,
  userId: string,
  name = "Inbox",
): Promise<string> {
  const id = randomUUID();
  await db.insert(schema.notebooks).values({ id, userId, name });
  return id;
}
