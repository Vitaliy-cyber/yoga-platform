import { test, expect } from "@playwright/test";

test.describe("Sequence creation (core)", () => {
  test("renders new sequence form", async ({ page }) => {
    await page.goto("/sequences/new");
    await expect(page.getByTestId("sequence-name")).toBeVisible();
    await expect(page.getByTestId("sequence-create")).toBeVisible();
  });

  test("create button is disabled until name is provided", async ({ page }) => {
    await page.goto("/sequences/new");
    await expect(page.getByTestId("sequence-create")).toBeDisabled();
    await page.getByTestId("sequence-name").fill("E2E Seq New");
    await expect(page.getByTestId("sequence-create")).toBeEnabled();
  });

  test("can create and then delete a sequence (cleanup)", async ({ page }) => {
    const name = `E2E Seq New ${Date.now()}`;

    await page.goto("/sequences/new");
    await page.getByTestId("sequence-name").fill(name);
    await page.getByTestId("sequence-create").click();

    await expect(page).toHaveURL(/\/sequences\/\d+/, { timeout: 15_000 });
    await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();

    await page.getByTestId("sequence-delete").click();
    await expect(page.getByTestId("sequence-delete-dialog")).toBeVisible();
    await page.getByTestId("sequence-delete-confirm").click();

    await expect(page).toHaveURL("/sequences", { timeout: 15_000 });
    await expect(page.getByTestId("sequence-new")).toBeVisible();
  });
});
