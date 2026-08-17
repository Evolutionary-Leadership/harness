import { defineConfig } from "drizzle-kit";

/**
 * drizzle-kit runs outside Next, so it reads the environment directly rather
 * than through src/lib/env.ts (which would pull the app's whole schema in).
 *
 * `generate` and `check` are offline: they diff the schema against ./drizzle and
 * never connect. Only `studio` needs a live database, so a missing DATABASE_URL
 * falls back to an obviously fake placeholder instead of throwing. That keeps
 * `pnpm db:generate` runnable on a machine with no Postgres, and `pnpm db:studio`
 * fails with a plain connection error naming the placeholder.
 *
 * Migrations are APPLIED by scripts/db-migrate.ts, not by drizzle-kit push.
 */
const url = process.env.DATABASE_URL ?? "postgresql://drizzle-kit:offline@127.0.0.1:1/unset";

export default defineConfig({
  schema: "./src/lib/db/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url },
  strict: true,
  verbose: true,
});
