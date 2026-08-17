/**
 * Apply pending Drizzle migrations. Runs on every deploy, before the server
 * starts (see railway.json's startCommand).
 *
 * A PLAIN tsx script with no Next imports on purpose: it has to run in the
 * deploy's start phase, where the Next server is not up and the app's module
 * graph (which would pull in React, the Better Auth instance, and the whole
 * config) is irrelevant. It also has to work against a completely EMPTY database,
 * because every feature environment starts with one.
 *
 * Reads DATABASE_URL directly rather than through src/lib/env.ts for the same
 * reason: this script must not require BETTER_AUTH_SECRET to migrate.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("db:migrate: DATABASE_URL is not set. Nothing to migrate against.");
  process.exit(1);
}

// max: 1 because the migrator takes an advisory lock and runs statements in
// order; a pool would let a second connection race it.
const sql = postgres(url, { max: 1, onnotice: () => {} });

try {
  const started = Date.now();
  await migrate(drizzle(sql), { migrationsFolder: "./drizzle" });
  console.log(`db:migrate: up to date in ${Date.now() - started}ms`);
} catch (error) {
  console.error("db:migrate: failed", error);
  process.exit(1);
} finally {
  await sql.end({ timeout: 5 });
}
