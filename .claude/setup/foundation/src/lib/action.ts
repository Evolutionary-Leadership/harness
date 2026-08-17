// `z` is used as a value here (z.flattenError), so this is not a type-only import.
import { z } from "zod";
import { requireSession, type SessionUser } from "@/lib/auth-server";
import { getDb, type DbClient } from "@/lib/db";
import { ERROR_CODES, isDomainError, type ErrorCode } from "@/lib/errors";
import { logger } from "@/lib/logger";

/**
 * The Server Action return shape. There are no other shapes, and nothing throws
 * across the action boundary.
 *
 * This is precisely what makes optimistic UI safe: a failure is a VALUE the
 * client reconciles in onError/onSettled, not an exception that unmounts a tree
 * or a redirect that discards the user's pending edit.
 *
 * Rationale and the rejected alternatives (throw plus an error boundary, 307 on
 * an expired session, warnings as errors): ADR 0006.
 */
export type ActionOk<T> = { ok: true; data: T };
export type ActionErr = {
  ok: false;
  error: { code: ErrorCode; message: string };
  fieldErrors?: Record<string, string[]>;
};
export type ActionResult<T> = ActionOk<T> | ActionErr;

/**
 * Soft warnings travel on the SUCCESS path. A duplicate title that was kept
 * anyway, a sync that failed but must not block the local change: these are
 * toasts in onSuccess, never error states. See src/app/notes/mutations.ts.
 */
export type Warning = { code: string; message: string };
export type WithWarnings<T> = T & { warnings?: Warning[] };

export type ActionContext = {
  session: SessionUser;
  db: DbClient;
};

/**
 * Build a Server Action from a Zod schema and a handler.
 *
 * Every action in this app goes through here, which is what guarantees the four
 * things the action layer owes: parse with Zod, require a session, delegate to a
 * service, and map errors to codes. A handler contains no business rules and no
 * SQL; both live in src/server/services/ and src/server/repositories/.
 */
export function defineAction<TInput, TOutput>(config: {
  /** Names the action in logs. Not shown to the client. */
  name: string;
  input: z.ZodType<TInput>;
  handler: (input: TInput, ctx: ActionContext) => Promise<TOutput>;
}): (raw: unknown) => Promise<ActionResult<TOutput>> {
  return async function action(raw: unknown): Promise<ActionResult<TOutput>> {
    // 1. Parse. Every external input is validated at the boundary.
    const parsed = config.input.safeParse(raw);
    if (!parsed.success) {
      const flattened = z.flattenError(parsed.error);
      return {
        ok: false,
        error: { code: ERROR_CODES.validation, message: "Some fields need fixing" },
        fieldErrors: flattened.fieldErrors as Record<string, string[]>,
      };
    }

    try {
      // 2. Require a session. Throws UnauthenticatedError, caught below.
      const session = await requireSession();

      // 3. Delegate to a service.
      const data = await config.handler(parsed.data, { session, db: getDb() });
      return { ok: true, data };
    } catch (error) {
      // 4a. Known domain errors keep their code and their message.
      if (isDomainError(error)) {
        return { ok: false, error: { code: error.code, message: error.message } };
      }

      // 4b. Everything else is logged in full and flattened, so no internal
      // detail (SQL text, table names, stack frames) ever reaches the client.
      logger.error(
        {
          action: config.name,
          err: error instanceof Error ? { message: error.message, stack: error.stack } : error,
        },
        "unhandled error in server action",
      );
      return {
        ok: false,
        error: { code: ERROR_CODES.unexpected, message: "Something went wrong. Please try again." },
      };
    }
  };
}

/** Narrowing helper for call sites that only care about the happy path. */
export function isOk<T>(result: ActionResult<T>): result is ActionOk<T> {
  return result.ok;
}
