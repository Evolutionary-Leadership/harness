import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    // tests/e2e/*.spec.ts belongs to Playwright. The extension picks the
    // runner, so Vitest only ever claims *.test.ts (see docs/TESTING.md).
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    // Integration tests boot one Postgres container per file. Running files
    // in parallel would multiply containers and exhaust Docker on CI-sized
    // machines, so files run one at a time.
    fileParallelism: false,
    // Pulling a Postgres image on a cold cache is slower than the default.
    testTimeout: 60_000,
    hookTimeout: 180_000,
  },
});
