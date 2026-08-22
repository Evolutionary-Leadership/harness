/**
 * Idempotent seed. Runs on deploy only when SEED_DATA is exactly "true"
 * (see railway.json), and refuses to run on production.
 *
 * Three properties this script must keep, all verified in section 13's
 * checklist and by tests/integration/seed.test.ts:
 *
 * 1. IDEMPOTENT. Running it twice leaves row counts unchanged. Every write is an
 *    ON CONFLICT upsert keyed on something stable, and ids are derived
 *    deterministically from the seed data rather than randomly generated.
 * 2. It ALWAYS creates the demo account, independent of SHOW_DEMO_LOGIN, so the
 *    demo button never points at a missing user.
 * 3. Its production guard keys on RAILWAY_ENVIRONMENT_NAME, never NODE_ENV:
 *    every deployed environment runs NODE_ENV=production, so NODE_ENV cannot
 *    answer "is this production". See ADR 0003.
 */
import { createHash } from "node:crypto";
import { createLocalAccountIssuer } from "@better-auth/core/db";
import { account, notebooks, notes, user } from "@/lib/db/schema";
import { createDb } from "@/lib/db";
import { getSeedDemoLogin, isProductionEnvironment, shouldSeed } from "@/lib/env";
import { hashPassword } from "@/lib/password";

/** Stable ids from stable inputs, so a re-run updates rather than inserts. */
const stableId = (...parts: string[]): string =>
  createHash("sha256").update(parts.join("\u0000")).digest("hex").slice(0, 32);

/**
 * The issuer Better Auth stamps on a locally created credential account.
 *
 * Imported rather than hardcoded so a Better Auth upgrade that changes the
 * format changes this too. A literal here would drift silently, and the only
 * symptom is that the demo login stops working.
 */
const CREDENTIAL_ISSUER = createLocalAccountIssuer("credential");

const DEMO_NOTEBOOK = "Inbox";

const DEMO_NOTES: { title: string; body: string; archived: boolean }[] = [
  {
    title: "Welcome to your notes",
    body:
      "This note came from the seed. Everything on this page updates optimistically: " +
      "edits, archives, deletes, and drag-to-reorder all land on the same frame as your click.",
    archived: false,
  },
  {
    title: "Drag me",
    body: "Grab the handle on the left and drop this note somewhere else. The order persists.",
    archived: false,
  },
  {
    title: "Archiving is undoable",
    body:
      "Archive a note and a five second countdown appears. Click undo inside that window and " +
      "nothing is ever sent to the server.",
    archived: false,
  },
  {
    title: "An archived note",
    body: "This one starts in the archive, so the archived list is not empty on a fresh environment.",
    archived: true,
  },
];

async function main(): Promise<void> {
  if (!shouldSeed()) {
    console.log('seed: SEED_DATA is not exactly "true", skipping.');
    return;
  }

  // The guard that matters. NODE_ENV would say "production" on dev and on every
  // feature environment too, so it cannot be the check.
  if (isProductionEnvironment()) {
    console.error(
      "seed: refusing to run on the production environment " +
        "(RAILWAY_ENVIRONMENT_NAME=production). Unset SEED_DATA there.",
    );
    process.exit(1);
  }

  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("seed: DATABASE_URL is not set.");
    process.exit(1);
  }

  const { db, close } = createDb(url);

  try {
    const demo = getSeedDemoLogin();
    const userId = stableId("user", demo.email);

    // 1. The demo user. Created whenever the seed runs, regardless of
    //    SHOW_DEMO_LOGIN: existence and visibility are different questions.
    await db
      .insert(user)
      .values({
        id: userId,
        name: "Ada (demo)",
        email: demo.email,
        emailVerified: true,
      })
      .onConflictDoUpdate({
        target: user.email,
        set: { name: "Ada (demo)", emailVerified: true, updatedAt: new Date() },
      });

    // 2. The credential account holding the argon2id hash. Re-hashed on every
    //    run so rotating DEMO_LOGIN_PASSWORD takes effect on the next deploy.
    //    Keyed on the account's stable id, so this updates rather than inserts.
    //
    //    THREE VALUES HERE ARE A CONTRACT WITH BETTER AUTH, not free choices.
    //    Sign in looks for an account whose providerId is "credential", whose
    //    issuer is CREDENTIAL_ISSUER, and whose accountId is the USER'S ID.
    //    Writing the email as accountId (which older Better Auth accepted)
    //    makes every demo sign in fail with "Invalid email or password", and
    //    nothing else reports the mismatch.
    await db
      .insert(account)
      .values({
        id: stableId("account", demo.email),
        issuer: CREDENTIAL_ISSUER,
        accountId: userId,
        providerId: "credential",
        userId,
        password: await hashPassword(demo.password),
      })
      .onConflictDoUpdate({
        target: account.id,
        set: {
          issuer: CREDENTIAL_ISSUER,
          accountId: userId,
          password: await hashPassword(demo.password),
          updatedAt: new Date(),
        },
      });

    // 3. The notebook. Unique on (user_id, name), so a re-run is a no-op.
    const notebookId = stableId("notebook", userId, DEMO_NOTEBOOK);
    await db
      .insert(notebooks)
      .values({ id: notebookId, userId, name: DEMO_NOTEBOOK })
      .onConflictDoNothing({ target: [notebooks.userId, notebooks.name] });

    // The insert above may have been a no-op because a notebook of that name
    // already exists under a DIFFERENT id (created by ensureDefaultNotebook on
    // first sign in, with a random uuid). Resolve the real id before seeding
    // notes, or the notes would point at a notebook row that does not exist.
    const notebook = await db.query.notebooks.findFirst({
      where: (table, { and, eq }) => and(eq(table.userId, userId), eq(table.name, DEMO_NOTEBOOK)),
    });
    const resolvedNotebookId = notebook?.id ?? notebookId;

    // 4. The notes. Position is derived from the array index, so order is stable
    //    across runs, and word_count is computed the same way the service does.
    for (const [index, seedNote] of DEMO_NOTES.entries()) {
      const id = stableId("note", resolvedNotebookId, seedNote.title);
      const wordCount = seedNote.body.trim() === "" ? 0 : seedNote.body.trim().split(/\s+/u).length;
      await db
        .insert(notes)
        .values({
          id,
          userId,
          notebookId: resolvedNotebookId,
          title: seedNote.title,
          body: seedNote.body,
          archived: seedNote.archived,
          position: index * 1000,
          wordCount,
        })
        .onConflictDoUpdate({
          target: notes.id,
          set: {
            title: seedNote.title,
            body: seedNote.body,
            archived: seedNote.archived,
            position: index * 1000,
            wordCount,
            updatedAt: new Date(),
          },
        });
    }

    const counts = await db.query.notes.findMany({ where: (t, { eq }) => eq(t.userId, userId) });
    console.log(
      `seed: ok. demo user ${demo.email}, notebook "${DEMO_NOTEBOOK}", ${counts.length} note(s).`,
    );
  } finally {
    await close();
  }
}

await main();
