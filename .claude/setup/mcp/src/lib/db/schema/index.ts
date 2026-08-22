/**
 * The schema barrel drizzle-kit reads (see drizzle.config.ts) and the object
 * passed to `drizzle()` so the relational API (`db.query.notes.findMany`) is
 * available. Every table and relation must be re-exported here or migrations
 * will silently omit it.
 *
 * Imports inside src/lib/db/schema/ are RELATIVE on purpose: drizzle-kit
 * bundles this file with esbuild and does not resolve the `@/*` tsconfig alias.
 */
export * from "./auth";
export * from "./notes";
export * from "./oauth";
