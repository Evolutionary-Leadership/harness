import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Next 16 otherwise writes its own agent-rules block into CLAUDE.md on
  // `next dev`. CLAUDE.md is this project's hand-written router (300-line
  // budget, see docs/README.md), so the generator stays off.
  agentRules: false,

  // Argon2 is a native addon and pino resolves transports at runtime; both
  // break if the server bundler tries to trace and inline them.
  serverExternalPackages: ["@node-rs/argon2", "pino", "pino-pretty"],

  typescript: {
    // A type error must fail the build, never be skipped.
    ignoreBuildErrors: false,
  },

  // Harness markers, baked at build time (Railway builds once per deploy,
  // so the sha is the deployed commit). /setup's post-provisioning check
  // reads x-harness to tell the app from a placeholder page that also
  // answers 200; /feature's deploy verification compares x-harness-sha
  // against the feature branch tip. Keep both headers.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "x-harness", value: "live" },
          {
            key: "x-harness-sha",
            value: process.env.RAILWAY_GIT_COMMIT_SHA ?? "local",
          },
        ],
      },
    ];
  },

  // Next 16 removed the `eslint` config key along with `next lint`. Linting is
  // `pnpm lint` (eslint.config.mjs) and runs in CI, not during `next build`.
};

export default nextConfig;
