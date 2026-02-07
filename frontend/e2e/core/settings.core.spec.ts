import { test, expect } from "@playwright/test";

test.describe("Settings (core)", () => {
  test("renders settings page", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.getByTestId("settings-locale-en")).toBeVisible();
    await expect(page.getByTestId("settings-locale-ua")).toBeVisible();
  });

  test("locale: can switch to English", async ({ page }) => {
    await page.goto("/settings");
    await page.getByTestId("settings-locale-en").click();
    await expect(page.getByTestId("settings-locale-en")).toHaveClass(
      /border-primary/,
    );
  });

  test("locale: can switch to Ukrainian", async ({ page }) => {
    await page.goto("/settings");
    await page.getByTestId("settings-locale-ua").click();
    await expect(page.getByTestId("settings-locale-ua")).toHaveClass(
      /border-primary/,
    );
  });

  test("locale: persists after reload", async ({ page }) => {
    await page.goto("/settings");
    await page.getByTestId("settings-locale-en").click();
    await expect(page.getByTestId("settings-locale-en")).toHaveClass(
      /border-primary/,
    );

    await page.reload();
    await expect(page.getByTestId("settings-locale-en")).toHaveClass(
      /border-primary/,
    );
  });
});
