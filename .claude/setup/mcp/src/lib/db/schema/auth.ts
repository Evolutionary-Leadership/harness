import { boolean, index, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Better Auth's core tables. The TypeScript property names must match Better
 * Auth's own field names (`emailVerified`, `expiresAt`, ...) because the Drizzle
 * adapter maps by property, not by column; the snake_case column names are ours.
 *
 * Do not hand-edit these to add application columns. Application data belongs
 * in its own table with a foreign key to `user`.
 */
export const user = pgTable(
  "user",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull().unique(),
    emailVerified: boolean("email_verified").notNull().default(false),
    image: text("image"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("user_email_idx").on(table.email)],
);

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    token: text("token").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("session_user_id_idx").on(table.userId),
    index("session_expires_at_idx").on(table.expiresAt),
  ],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    /**
     * Required by Better Auth 1.7, which the MCP plugin peers. It names the
     * issuer an account came from, and the adapter refuses to start if the
     * column is absent.
     *
     * THE DEFAULT IS NOT "credential". Better Auth derives the value for a
     * locally created account through `createLocalAccountIssuer`, which
     * prefixes it: an email-and-password account is `local:credential`. Sign
     * in matches on that exact string, so a row that took a wrong default
     * would be unfindable and every sign in for it would fail with "Invalid
     * email or password" and no other symptom.
     *
     * The default exists only so this column can be added to a table that
     * already has rows. `scripts/seed.ts` writes the value explicitly, from
     * Better Auth's own helper rather than from a literal, so the two cannot
     * drift.
     */
    issuer: text("issuer").notNull().default("local:credential"),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    /** argon2id hash for the credential provider. Never a plaintext password. */
    password: text("password"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("account_user_id_idx").on(table.userId)],
);

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)],
);
