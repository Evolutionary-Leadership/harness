import { hash as argon2Hash, verify as argon2Verify } from "@node-rs/argon2";

/**
 * Password hashing, deliberately in its OWN module.
 *
 * It does not import the Better Auth instance or the database, so
 * scripts/seed.ts can hash the demo account's password without dragging auth
 * and a connection pool into a plain tsx script.
 *
 * argon2id only. No bcrypt, no PBKDF2. See docs/SECURITY.md.
 */

/**
 * `Algorithm.Argon2id`, written as its numeric value on purpose.
 *
 * @node-rs/argon2 exports Algorithm as an ambient `const enum`, which
 * `verbatimModuleSyntax` cannot import: there is no runtime binding to import,
 * so the emitted `import { Algorithm }` would resolve to nothing. The value 2 is
 * Argon2id (0 is Argon2d, 1 is Argon2i).
 */
const ALGORITHM_ARGON2ID = 2;

/**
 * OWASP's argon2id baseline: 19 MiB, 2 passes, 1 lane. Raising these later is
 * safe for verification (the parameters are encoded in the stored digest), so
 * old hashes keep verifying after a bump.
 */
const OPTIONS = {
  algorithm: ALGORITHM_ARGON2ID,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
} as const;

export async function hashPassword(password: string): Promise<string> {
  return argon2Hash(password, OPTIONS);
}

/**
 * Constant-time comparison is argon2Verify's job. Returns false rather than
 * throwing on a malformed digest, so a corrupted row reads as "wrong password"
 * instead of a 500.
 */
export async function verifyPassword(digest: string, password: string): Promise<boolean> {
  try {
    return await argon2Verify(digest, password);
  } catch {
    return false;
  }
}
