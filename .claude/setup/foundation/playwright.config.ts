import { defineConfig, devices } from "@playwright/test";

/**
 * E2E is for JOURNEYS, not coverage. One journey that exercises the whole
 * optimistic loop is the target; anything that can be a unit test should be one.
 *
 * The base URL is localhost, NOT 127.0.0.1: Better Auth trusts localhost by
 * default and 127.0.0.1 is a different origin to it, so pointing here at the IP
 * makes every sign in fail with INVALID_ORIGIN.
 */
const PORT = Number(process.env.E2E_PORT ?? 3210);
const baseURL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./tests/e2e",
  // Only *.spec.ts. Vitest owns *.test.ts; the extension picks the runner.
  testMatch: /.*\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? "line" : [["list"]],
  timeout: 60_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },

  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        /**
         * Escape hatch for environments that ship a pre-installed Chromium whose
         * build number does not match this @playwright/test version (a CI image
         * with browsers baked in, for example). Point
         * PLAYWRIGHT_CHROMIUM_PATH at the binary and Playwright uses it instead
         * of demanding its own download. Unset locally, where
         * `pnpm exec playwright install` is the normal path.
         */
        ...(process.env.PLAYWRIGHT_CHROMIUM_PATH
          ? {
              channel: undefined,
              launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH },
            }
          : {}),
      },
    },
  ],

  webServer: {
    // Tests the built app, the same artifact a deploy runs.
    command: `pnpm build && pnpm start --port ${PORT}`,
    url: `${baseURL}/login`,
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
    env: {
      PORT: String(PORT),
      // The demo login button is the e2e entry point, so it must be on.
      SHOW_DEMO_LOGIN: "true",
      SEED_DATA: "true",
    },
  },
});
