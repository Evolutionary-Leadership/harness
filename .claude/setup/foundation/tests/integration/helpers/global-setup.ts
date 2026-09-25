import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import type { TestProject } from "vitest/node";

/**
 * The integration tier's global setup: ONE Postgres per run.
 *
 * Runs once, in Vitest's main process, before any integration file:
 *
 *   1. Adopts the server at TEST_DATABASE_URL, or starts one Testcontainers
 *      Postgres 16 for the whole run.
 *   2. Migrates from scratch, once, into a template database.
 *   3. Exports the server URL and the template name to the workers, through
 *      process.env (workers fork after this runs, so they inherit it, and so
 *      does any subprocess a test spawns) and through Vitest's provide().
 *
 * Each test file then clones the template into a database of its own in
 * beforeAll (tests/integration/helpers/database.ts), which is what lets files
 * run in parallel against one server. The container, when this started one,
 * stops in the returned teardown.
 *
 * The role behind TEST_DATABASE_URL needs CREATEDB. The database named in the
 * URL itself is only ever connected to, never migrated, never truncated.
 */

/** The migrated database every file clones. Postgres allows any database as a template for its owner. */
export const TEMPLATE_DATABASE = "template_app";

declare module "vitest" {
  export interface ProvidedContext {
    testDatabaseUrl: string;
    testTemplateDatabase: string;
  }
}

/** The same server, a different database. */
export function withDatabase(serverUrl: string, database: string): string {
  const url = new URL(serverUrl);
  url.pathname = `/${database}`;
  return url.toString();
}

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
    // strategy") does not say what to do about it. Say the actionable thing.
    throw new Error(
      "Integration tests need a Postgres 16 and found neither.\n" +
        "  - TEST_DATABASE_URL is not set, and\n" +
        "  - Testcontainers could not reach a Docker daemon.\n" +
        "Fix either one:\n" +
        "  - start Docker, or\n" +
        "  - export TEST_DATABASE_URL=$(bash scripts/test-db.sh), which starts a throwaway\n" +
        "    cluster when initdb is installed, or point it at any Postgres 16 whose role\n" +
        "    may CREATE DATABASE.\n" +
        "See docs/TESTING.md.",
      { cause },
    );
  }
}

async function buildTemplate(serverUrl: string): Promise<void> {
  const admin = postgres(serverUrl, { max: 1, onnotice: () => {} });
  try {
    // A stale template from an interrupted run would carry an older schema.
    // FORCE disconnects anything still attached to it.
    await admin.unsafe(`DROP DATABASE IF EXISTS "${TEMPLATE_DATABASE}" WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE "${TEMPLATE_DATABASE}"`);
  } catch (cause) {
    throw new Error(
      `Could not create the template database "${TEMPLATE_DATABASE}" on TEST_DATABASE_URL.\n` +
        "The role in that URL needs CREATEDB (scripts/test-db.sh starts a cluster whose role has it).",
      { cause },
    );
  } finally {
    await admin.end({ timeout: 5 });
  }

  // Every environment must be able to migrate from scratch, so the test tier
  // exercises exactly that rather than a pre-built database. max: 1 because the
  // migrator takes an advisory lock and runs statements in order.
  const migrator = postgres(withDatabase(serverUrl, TEMPLATE_DATABASE), {
    max: 1,
    onnotice: () => {},
  });
  try {
    await migrate(drizzle(migrator), { migrationsFolder: "./drizzle" });
  } finally {
    // CREATE DATABASE ... TEMPLATE refuses while anyone is connected to the
    // template, so this connection must be gone before the first file clones.
    await migrator.end({ timeout: 5 });
  }
}

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const configured = process.env.TEST_DATABASE_URL;

  let serverUrl: string;
  let stopContainer: (() => Promise<void>) | null = null;

  if (configured) {
    serverUrl = configured;
  } else {
    const container = await startContainer();
    serverUrl = container.url;
    stopContainer = container.stop;
  }

  await buildTemplate(serverUrl);

  process.env.TEST_DATABASE_URL = serverUrl;
  process.env.TEST_TEMPLATE_DATABASE = TEMPLATE_DATABASE;
  project.provide("testDatabaseUrl", serverUrl);
  project.provide("testTemplateDatabase", TEMPLATE_DATABASE);

  return async () => {
    if (stopContainer) await stopContainer();
  };
}
