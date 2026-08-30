import { z } from "zod";

/**
 * The single home for every environment variable this app reads.
 *
 * Two rules govern what belongs in `required` vs `optional`:
 *
 * 1. The schema fails fast and aggregates. A variable listed as required but
 *    not actually needed to boot turns every environment that lacks it into a
 *    crash loop, so `required` holds exactly what the process cannot start
 *    without: DATABASE_URL and BETTER_AUTH_SECRET.
 * 2. Everything feature scoped is `.optional()` and checked at its point of
 *    use through the accessors below.
 *
 * See docs/architecture/configuration.md for the per-environment matrix and
 * ADR 0003 for why "is this production" never reads NODE_ENV.
 */
const envSchema = z.object({
  // ---------------------------------------------------------------- required
  DATABASE_URL: z
    .string()
    .min(1, "must be a Postgres connection string (on Railway: ${{Postgres.DATABASE_URL}})"),
  BETTER_AUTH_SECRET: z
    .string()
    .min(32, "must be at least 32 characters (generate: openssl rand -base64 32)"),

  // ---------------------------------------------------------------- optional
  /** Explicit public origin. Set only where the origin is a custom domain. */
  BETTER_AUTH_URL: z.url("must be an absolute URL, for example https://notes.example.com").optional(),

  /**
   * A runtime switch for React and Next, never an environment label. Every
   * deployed environment runs `production`, including preprod and feature
   * environments. See ADR 0003.
   */
  NODE_ENV: z.enum(["development", "production", "test"]).optional(),

  /** Seed on deploy when exactly "true". */
  SEED_DATA: z.string().optional(),
  /** Signup is closed only when exactly "false". */
  ALLOW_SIGNUP: z.string().optional(),
  /** Render the one click demo login button only when exactly "true". */
  SHOW_DEMO_LOGIN: z.string().optional(),
  /** Overrides for the seeded demo account. Both have fallbacks below. */
  DEMO_LOGIN_EMAIL: z.email("must be an email address").optional(),
  DEMO_LOGIN_PASSWORD: z.string().min(8, "must be at least 8 characters").optional(),

  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .optional(),

  /**
   * The port the server listens on. Railway injects it; locally `next dev` and
   * `next start --port` set it. Read ONLY to build the local development
   * origin below, never to decide behaviour.
   */
  PORT: z.string().optional(),

  // Injected by Railway. Never set these by hand.
  /** The environment's own public hostname, without a scheme. */
  RAILWAY_PUBLIC_DOMAIN: z.string().optional(),
  /** "production", "preprod", or the feature branch environment's name. */
  RAILWAY_ENVIRONMENT_NAME: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

/**
 * Parse and cache the environment. Throws once, listing every invalid variable,
 * rather than failing on whichever one happens to be read first.
 *
 * Call this lazily. Nothing may call it at module scope: `next build` evaluates
 * modules with no DATABASE_URL set.
 */
export function getEnv(): Env {
  if (cached) return cached;

  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((issue) => {
      const name = issue.path.join(".") || "(root)";
      return `  ${name}: ${issue.message}`;
    });
    throw new Error(
      `Invalid environment configuration (${parsed.error.issues.length} problem(s)):\n${lines.join("\n")}\n\n` +
        "See .env.example for what each variable does and how to generate it.",
    );
  }

  cached = parsed.data;
  return cached;
}

/** Test-only: drop the cache so a test can re-parse a mutated process.env. */
export function resetEnvCache(): void {
  cached = undefined;
}

// ---------------------------------------------------------------- auth origin

const stripTrailingSlash = (url: string): string => url.replace(/\/+$/, "");

/**
 * The origin Better Auth should treat as its own.
 *
 * Falling back to the Railway domain is what lets preprod and every feature
 * environment self configure: BETTER_AUTH_URL is deliberately left unset there
 * so each environment resolves its own hostname. Returning undefined means
 * "localhost", which is correct under `next dev`.
 */
export function getAuthBaseUrl(): string | undefined {
  const env = getEnv();
  if (env.BETTER_AUTH_URL) return stripTrailingSlash(env.BETTER_AUTH_URL);
  if (env.RAILWAY_PUBLIC_DOMAIN) return `https://${env.RAILWAY_PUBLIC_DOMAIN}`;
  return undefined;
}

/**
 * The UNION of the configured public origin and the Railway domain, so a
 * custom domain and the railway.app hostname both work on production.
 *
 * May be empty (locally, with neither variable set). The caller MUST omit the
 * key entirely in that case: passing `trustedOrigins: []` to Better Auth
 * replaces its defaults and makes every sign in fail with INVALID_ORIGIN.
 * See the spread in src/lib/auth.ts.
 */
export function getTrustedOrigins(): string[] {
  const env = getEnv();
  const origins = new Set<string>();
  if (env.BETTER_AUTH_URL) origins.add(stripTrailingSlash(env.BETTER_AUTH_URL));
  if (env.RAILWAY_PUBLIC_DOMAIN) origins.add(`https://${env.RAILWAY_PUBLIC_DOMAIN}`);
  return [...origins];
}

/**
 * The app's absolute public origin, ALWAYS a real URL.
 *
 * getAuthBaseUrl() above may return undefined, which Better Auth reads as
 * "derive it from the incoming request". That is fine for cookies and
 * redirects, and NOT fine for OAuth: an authorization server's issuer and a
 * protected resource identifier are both absolute URLs that have to be stable
 * and knowable before any request arrives. With no origin to fall back on, the
 * OAuth provider builds an empty issuer and every page render fails on an
 * invalid URL.
 *
 * So this narrows undefined to a concrete localhost origin on the app's actual
 * port, which is the only case getAuthBaseUrl() cannot answer: every deployed
 * environment resolves a real https origin from BETTER_AUTH_URL or
 * RAILWAY_PUBLIC_DOMAIN. The MCP specification permits plain HTTP for a
 * resource identifier only on loopback hosts, which is exactly this case.
 */
export function getPublicOrigin(): string {
  const configured = getAuthBaseUrl();
  if (configured) return configured;
  return `http://localhost:${getEnv().PORT ?? "3000"}`;
}

// ------------------------------------------------------------------- switches

/**
 * True only on the Railway environment literally named "production".
 *
 * NODE_ENV cannot answer this: every deployed environment, preprod and feature
 * environments included, runs NODE_ENV=production. See ADR 0003.
 */
export function isProductionEnvironment(): boolean {
  return getEnv().RAILWAY_ENVIRONMENT_NAME === "production";
}

/** Seeding is opt in: anything other than exactly "true" means no. */
export function shouldSeed(): boolean {
  return getEnv().SEED_DATA === "true";
}

/** Signup is open unless ALLOW_SIGNUP is exactly "false". */
export function isSignupAllowed(): boolean {
  return getEnv().ALLOW_SIGNUP !== "false";
}

export function getLogLevel(): string {
  return getEnv().LOG_LEVEL ?? "info";
}

// ----------------------------------------------------------------- demo login

/**
 * A clearly fictional account. Hardcoded so a reviewer can click one button on
 * a preview environment without anyone storing credentials anywhere.
 */
const DEMO_FALLBACK_EMAIL = "ada.demo@example.invalid";
const DEMO_FALLBACK_PASSWORD = "demo-notes-please-change";

export type DemoLogin = { email: string; password: string };

/**
 * The one private reader shared by both accessors below, so DEMO_LOGIN_EMAIL
 * and DEMO_LOGIN_PASSWORD are still read in exactly one file.
 */
function readDemoCredentials(): DemoLogin {
  const env = getEnv();
  return {
    email: env.DEMO_LOGIN_EMAIL ?? DEMO_FALLBACK_EMAIL,
    password: env.DEMO_LOGIN_PASSWORD ?? DEMO_FALLBACK_PASSWORD,
  };
}

/**
 * The ONLY accessor application code may use. Returns null whenever
 * SHOW_DEMO_LOGIN is not exactly "true".
 *
 * The login page is a Server Component and calls this at render time, passing
 * the result down as a prop. The goal is not a hidden button: on production the
 * credentials never enter the client bundle at all.
 */
export function getDemoLogin(): DemoLogin | null {
  return getEnv().SHOW_DEMO_LOGIN === "true" ? readDemoCredentials() : null;
}

/**
 * Seed-only accessor, deliberately NOT gated on SHOW_DEMO_LOGIN.
 *
 * Whether the demo account exists and whether the button is shown are two
 * different questions. The seed always creates the account so the button never
 * points at a missing user; SHOW_DEMO_LOGIN alone decides visibility.
 */
export function getSeedDemoLogin(): DemoLogin {
  return readDemoCredentials();
}
