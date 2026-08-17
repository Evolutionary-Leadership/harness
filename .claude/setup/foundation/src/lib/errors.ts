/**
 * Domain errors and the codes the action wrapper maps them onto.
 *
 * The client never sees a stack trace or a message we did not write: anything
 * that is not a DomainError is logged and flattened to "unexpected". See
 * src/lib/action.ts.
 */

export const ERROR_CODES = {
  /** No valid session. NOT a redirect: the client reconciles it as a value. */
  unauthenticated: "unauthenticated",
  /** Zod rejected the input. Carries fieldErrors. */
  validation: "validation",
  /** The row does not exist, or belongs to someone else. Deliberately the same
   *  code for both, so probing cannot distinguish them and an id space stays
   *  unenumerable. See ADR 0006. */
  not_found: "not_found",
  /** A uniqueness or state rule was violated in a way the caller can fix. */
  conflict: "conflict",
  /** Signup is closed by configuration. */
  signup_disabled: "signup_disabled",
  /** Anything unrecognised. Logged server side, opaque to the client. */
  unexpected: "unexpected",
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export class DomainError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = "DomainError";
    this.code = code;
  }
}

export class NotFoundError extends DomainError {
  constructor(what: string) {
    super(ERROR_CODES.not_found, `${what} not found`);
    this.name = "NotFoundError";
  }
}

export class ConflictError extends DomainError {
  constructor(message: string) {
    super(ERROR_CODES.conflict, message);
    this.name = "ConflictError";
  }
}

export class UnauthenticatedError extends DomainError {
  constructor() {
    super(ERROR_CODES.unauthenticated, "Not signed in");
    this.name = "UnauthenticatedError";
  }
}

export function isDomainError(error: unknown): error is DomainError {
  return error instanceof DomainError;
}

/** Postgres unique_violation. Useful for turning a race into a ConflictError. */
export const PG_UNIQUE_VIOLATION = "23505";

export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === PG_UNIQUE_VIOLATION
  );
}
