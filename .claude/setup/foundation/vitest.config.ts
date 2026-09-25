import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * Two Vitest projects, one per tier (see docs/TESTING.md).
 *
 *   unit         tests/unit/**          no setup, files in parallel
 *   integration  tests/integration/**   one Postgres per run (globalSetup),
 *                                       one database per file, files in parallel
 *
 * `pnpm test:unit` and `pnpm test:int` select one; `pnpm test:run` runs both.
 * tests/e2e/*.spec.ts belongs to Playwright: the extension picks the runner, so
 * Vitest only ever claims *.test.ts.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["tests/unit/**/*.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          // Starts (or adopts) the one Postgres for the whole run and migrates
          // it once into a template database. Each file then clones the
          // template in its own beforeAll, so files no longer share a
          // container and can run in parallel.
          globalSetup: ["./tests/integration/helpers/global-setup.ts"],
          fileParallelism: true,
          // Pulling a Postgres image on a cold cache is slower than the default.
          testTimeout: 60_000,
          hookTimeout: 180_000,
        },
      },
    ],
  },
});
