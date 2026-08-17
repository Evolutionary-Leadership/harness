import { drizzle } from "drizzle-orm/postgres-js";
import type { PostgresJsDatabase, PostgresJsQueryResultHKT } from "drizzle-orm/postgres-js";
import type { ExtractTablesWithRelations } from "drizzle-orm";
import type { PgTransaction } from "drizzle-orm/pg-core";
import postgres from "postgres";
import * as schema from "@/lib/db/schema";
import { getEnv } from "@/lib/env";

export type Schema = typeof schema;

/**
 * The pooled client. Owns a connection pool and the transaction boundary.
 * Service MUTATORS take this, because a mutator decides what its transaction is.
 */
export type DbClient = PostgresJsDatabase<Schema>;

/**
 * A transaction handle. Structurally interchangeable with DbClient for queries,
 * which is the whole point of DbExecutor below.
 */
export type DbTransaction = PgTransaction<
  PostgresJsQueryResultHKT,
  Schema,
  ExtractTablesWithRelations<Schema>
>;

/**
 * Anything that can run a query. REPOSITORIES take this, and service READERS
 * take this, so the identical repository code runs against the pooled client
 * and inside a transaction with no branching.
 */
export type DbExecutor = DbClient | DbTransaction;

let client: postgres.Sql | undefined;
let db: DbClient | undefined;

/**
 * Lazily create the client.
 *
 * Importing this module must NOT open a connection: Next evaluates modules at
 * build time, when DATABASE_URL is not set, so a module-scope `drizzle(...)`
 * turns every build into a failure. Every caller goes through getDb().
 */
export function getDb(): DbClient {
  if (!db) {
    const { DATABASE_URL } = getEnv();
    client = postgres(DATABASE_URL, {
      max: 10,
      idle_timeout: 20,
      connect_timeout: 10,
      // Railway's Postgres does not present a certificate chain we can verify,
      // and the connection stays inside the project's private network.
      ssl: DATABASE_URL.includes("sslmode=require") ? "require" : false,
    });
    db = drizzle(client, { schema });
  }
  return db;
}

/**
 * Close the pool. For scripts (migrate, seed) and integration test teardown;
 * the long lived server never calls it.
 */
export async function closeDb(): Promise<void> {
  if (client) {
    await client.end({ timeout: 5 });
    client = undefined;
    db = undefined;
  }
}

/**
 * Build a client against an explicit URL, bypassing the cached singleton. Used
 * by scripts and by integration tests pointing at a throwaway container.
 */
export function createDb(url: string): { db: DbClient; close: () => Promise<void> } {
  const sql = postgres(url, { max: 5, onnotice: () => {} });
  return {
    db: drizzle(sql, { schema }),
    close: () => sql.end({ timeout: 5 }),
  };
}
