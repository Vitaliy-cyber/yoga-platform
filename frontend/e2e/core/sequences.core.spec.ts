import { test, expect } from "@playwright/test";

test.describe("Sequences (core)", () => {
  test("creates and deletes a sequence via UI", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });

    const name = `E2E Sequence ${Date.now()}`;

    await page.goto("/sequences");
    await expect(page.getByTestId("sequence-new")).toBeVisible();
    await page.getByTestId("sequence-new").click();

    await expect(page).toHaveURL("/sequences/new");

    await page.getByTestId("sequence-name").fill(name);
    await page.getByTestId("sequence-create").click();

    await expect(page).toHaveURL(/\/sequences\/\d+/, { timeout: 15000 });
    await expect(
      page.getByRole("heading", { name, exact: true }),
    ).toBeVisible();

    await page.getByTestId("sequence-delete").click();
    await expect(page.getByTestId("sequence-delete-dialog")).toBeVisible();
    await page.getByTestId("sequence-delete-confirm").click();

    await expect(page).toHaveURL("/sequences", { timeout: 15000 });
    await expect(page.getByText(name, { exact: true })).toHaveCount(0);
  });
});
