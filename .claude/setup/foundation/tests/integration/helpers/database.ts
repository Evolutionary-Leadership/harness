import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import postgres from "postgres";
import { inject } from "vitest";
import type { DbClient } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { TEMPLATE_DATABASE, withDatabase } from "./global-setup";

/**
 * The integration harness, per file.
 *
 * ONE Postgres per run, started and migrated once by global-setup.ts. ONE
 * database per file, cloned from the migrated template in beforeAll and dropped
 * in afterAll, which is what lets files run in parallel (vitest.config.ts sets
 * fileParallelism: true for this project). Between tests, a TRUNCATE and a
 * re-seed of the fixture users. Foreign keys are real, so fixture rows must
 * reference genuinely seeded users.
 *
 * The server URL comes from the environment the global setup exported
 * (TEST_DATABASE_URL, set by hand or by the setup itself when it started a
 * container), with Vitest's inject() as the fallback. `url` on the returned
 * context is this file's own database, for anything that runs as a subprocess.
 */

export type IntegrationDb = {
  db: DbClient;
  /** This file's own database. Hand it to a subprocess as DATABASE_URL. */
  url: string;
  /** Truncate every application table, then re-seed the fixture users. */
  reset: () => Promise<void>;
  teardown: () => Promise<void>;
  users: { alice: string; bob: string };
};

/** Tables the migrator owns. Never truncated. */
const MIGRATION_TABLES = ["__drizzle_migrations"];

function serverUrl(): string {
  const url = process.env.TEST_DATABASE_URL ?? inject("testDatabaseUrl");
  if (!url) {
    throw new Error(
      "No test database: tests/integration/helpers/global-setup.ts did not run.\n" +
        "Run the tier through its Vitest project (pnpm test:int), which registers it.\n" +
        "See docs/TESTING.md.",
    );
  }
  return url;
}

export async function setupIntegrationDb(): Promise<IntegrationDb> {
  const server = serverUrl();
  const template =
    process.env.TEST_TEMPLATE_DATABASE ?? inject("testTemplateDatabase") ?? TEMPLATE_DATABASE;
  // A Postgres identifier is at most 63 bytes; this is 37.
  const name = `test_${randomUUID().replaceAll("-", "")}`;

  const admin = postgres(server, { max: 1, onnotice: () => {} });
  await admin.unsafe(`CREATE DATABASE "${name}" TEMPLATE "${template}"`);

  const url = withDatabase(server, name);
  const client = postgres(url, { max: 5, onnotice: () => {} });
  const db = drizzle(client, { schema });

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
    url,
    reset,
    users,
    teardown: async () => {
      await client.end({ timeout: 5 });
      // FORCE: a subprocess the file spawned may still hold a connection.
      await admin.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      await admin.end({ timeout: 5 });
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
