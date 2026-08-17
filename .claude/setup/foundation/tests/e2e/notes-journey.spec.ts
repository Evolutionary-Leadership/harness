import { expect, test } from "@playwright/test";

/**
 * ONE journey, covering the whole optimistic loop: demo sign in, create, edit
 * (with its derived fields updating), archive with undo, scope transition, and
 * delete through the confirm dialog.
 *
 * Deliberately not a coverage exercise. The cache helpers, the derived fields, and
 * the cross-user boundary are all cheaper and sharper to test a tier down; this
 * exists to prove the pieces are wired to each other in a real browser.
 */

const uniqueTitle = (label: string): string => `${label} ${Date.now()}`;

test("the optimistic notes loop, end to end", async ({ page }) => {
  // ---------------------------------------------------------------- sign in
  await page.goto("/login");

  // The demo button only renders because the Server Component read
  // SHOW_DEMO_LOGIN=true and passed the credentials down as a prop.
  const demoLogin = page.getByTestId("demo-login");
  await expect(demoLogin).toBeVisible();
  await demoLogin.click();

  await expect(page).toHaveURL(/\/notes/);
  await expect(page.getByRole("heading", { name: "Notes", level: 1 })).toBeVisible();
  // The seeded notes are there, which also proves seed-then-start worked.
  await expect(page.getByRole("heading", { name: "Welcome to your notes" })).toBeVisible();

  // ----------------------------------------------------------------- create
  const title = uniqueTitle("Optimistic note");
  await page.getByLabel("New note title").fill(title);
  await page.getByLabel("New note body").fill("one two three");
  await page.getByRole("button", { name: "Add note" }).click();

  // Appears immediately. No spinner, no navigation, and the draft is cleared.
  const created = page.locator('[data-testid="note-card"]').filter({ hasText: title });
  await expect(created).toBeVisible();
  await expect(page.getByLabel("New note title")).toHaveValue("");
  await expect(created.getByTestId("note-wordcount")).toHaveText("3 words");

  // Once the server acknowledges the note, the optimistic row is replaced by the
  // real one and the row's actions stop being disabled.
  await expect(created.getByRole("button", { name: "Edit" })).toBeEnabled();

  // From here on the card is addressed by its id, not by its title: in edit mode
  // the title lives in an input's value, which `hasText` does not see.
  const noteId = await created.getAttribute("data-note-id");
  expect(noteId).toBeTruthy();
  const card = page.locator(`[data-note-id="${noteId}"]`);

  // ------------------------------------------------------------------- edit
  await card.getByRole("button", { name: "Edit" }).click();
  await card.getByLabel("Note body").fill("one two three four five six");
  await card.getByRole("button", { name: "Save" }).click();

  // The DERIVED fields update on the same frame, not after a refetch. This is the
  // optimistic mirror: patching body alone would leave both of these stale.
  await expect(card.getByTestId("note-wordcount")).toHaveText("6 words");
  await expect(card.getByTestId("note-excerpt")).toHaveText("one two three four five six");

  // The edit survives a reload, so it really reached the database.
  await page.reload();
  await expect(card.getByTestId("note-wordcount")).toHaveText("6 words");

  // -------------------------------------------------------- archive and undo
  await card.getByRole("button", { name: "Archive" }).click();

  // Flips immediately into a countdown. Nothing has been sent yet.
  const undoRow = page.locator(`[data-testid="note-undo"][data-note-id="${noteId}"]`);
  await expect(undoRow).toBeVisible();
  await undoRow.getByRole("button", { name: "Undo" }).click();

  // Undo is purely local: the note is back in the active list right away.
  await expect(card).toBeVisible();

  // It never reached the server, so it is still active after a reload.
  await page.reload();
  await expect(card).toBeVisible();

  // ------------------------------------- archive for real, and check the scope
  await card.getByRole("button", { name: "Archive" }).click();

  // Let the countdown expire so the timer commits.
  await expect(undoRow).toBeVisible();
  await expect(undoRow).toHaveCount(0, { timeout: 15_000 });

  // SCOPE EJECTION: gone from the active list without waiting for a refetch.
  await expect(card).toHaveCount(0);

  await page.getByRole("button", { name: "Archived" }).click();
  await expect(card).toBeVisible();
  await expect(card.getByRole("heading", { name: title })).toBeVisible();

  // ----------------------------------------------------------------- delete
  await card.getByRole("button", { name: "Delete" }).click();

  // An in-app dialog, not window.confirm(). A native dialog would be invisible
  // to this locator entirely.
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Delete this note?");
  await dialog.getByRole("button", { name: "Delete" }).click();

  await expect(card).toHaveCount(0);

  // Gone for good.
  await page.reload();
  await expect(card).toHaveCount(0);
});

test("cancelling the delete dialog keeps the note", async ({ page }) => {
  await page.goto("/login");
  await page.getByTestId("demo-login").click();
  await expect(page).toHaveURL(/\/notes/);

  const card = page.locator('[data-testid="note-card"]').first();
  const heading = await card.getByRole("heading").innerText();

  await card.getByRole("button", { name: "Delete" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();

  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: heading })).toBeVisible();
});

test("a signed out visitor is redirected away from the notes page", async ({ page }) => {
  await page.goto("/notes");
  await expect(page).toHaveURL(/\/login/);
});
