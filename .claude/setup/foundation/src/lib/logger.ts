import pino from "pino";
import { getLogLevel } from "@/lib/env";

/**
 * The only module in this repo allowed to write to stdout directly. Everything
 * else imports `logger` from here; eslint's `no-console` rule enforces it.
 *
 * Created lazily: pino resolves its destination at construction time, and
 * reading LOG_LEVEL through getEnv() at module scope would parse the
 * environment during `next build`, where DATABASE_URL is not set.
 */
let instance: pino.Logger | undefined;

function base(): pino.Logger {
  if (!instance) {
    instance = pino({
      level: getLogLevel(),
      // Railway captures stdout, so structured JSON on one line is what we want
      // in every deployed environment. No transport, no pretty printer: pino is
      // in serverExternalPackages precisely so nothing tries to bundle one.
      redact: {
        paths: [
          "password",
          "*.password",
          "token",
          "*.token",
          "req.headers.cookie",
          "req.headers.authorization",
        ],
        censor: "[redacted]",
      },
    });
  }
  return instance;
}

type Bindings = Record<string, unknown>;

/**
 * A thin facade over pino rather than the raw instance, so call sites never
 * depend on pino's own type surface and the lazy construction stays hidden.
 */
export const logger = {
  fatal: (obj: Bindings, msg?: string) => base().fatal(obj, msg),
  error: (obj: Bindings, msg?: string) => base().error(obj, msg),
  warn: (obj: Bindings, msg?: string) => base().warn(obj, msg),
  info: (obj: Bindings, msg?: string) => base().info(obj, msg),
  debug: (obj: Bindings, msg?: string) => base().debug(obj, msg),
  trace: (obj: Bindings, msg?: string) => base().trace(obj, msg),
  /** A child logger carrying fixed context, for example { requestId }. */
  child: (bindings: Bindings) => base().child(bindings),
};

export type Logger = typeof logger;
