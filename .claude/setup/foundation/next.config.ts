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

  // Next 16 removed the `eslint` config key along with `next lint`. Linting is
  // `pnpm lint` (eslint.config.mjs) and runs in CI, not during `next build`.
};

export default nextConfig;
