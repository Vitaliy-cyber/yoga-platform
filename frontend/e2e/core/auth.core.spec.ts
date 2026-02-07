import { test, expect } from "@playwright/test";
import { TEST_TOKEN } from "../fixtures";

test.describe("Auth (core)", () => {
  test.describe("Route protection", () => {
    test.use({ storageState: { cookies: [], origins: [] } });

    test("redirects unauthenticated user to /login", async ({ page }) => {
      await page.goto("/");
      // Allow time for zustand hydration + auth validation to complete.
      await expect(page).toHaveURL(/\/login(?:\?|$)/, { timeout: 30_000 });
      await expect(page.locator("#token")).toBeVisible({ timeout: 30_000 });
    });
  });

  test("logout clears auth and redirects to /login", async ({ browser }) => {
    // IMPORTANT: Use a dedicated context so we don't revoke the shared refresh token
    // stored in `playwright/.auth/user.json` and used by the rest of the suite.
    const context = await browser.newContext({
      baseURL: process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3000",
      storageState: { cookies: [], origins: [] },
    });
    const page = await context.newPage();

    await page.setViewportSize({ width: 1280, height: 720 });

    await page.goto("/login", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#token")).toBeVisible({ timeout: 30_000 });
    await page.locator("#token").fill(TEST_TOKEN);
    await page.locator('button[type="submit"]').click();
    await expect(page).toHaveURL("/", { timeout: 30_000 });
    await expect(page.getByTestId("nav-dashboard")).toBeVisible();

    await page.getByTestId("user-menu-toggle").click();
    await expect(page.getByTestId("logout-button")).toBeVisible();
    await page.getByTestId("logout-button").click();

    await expect(page).toHaveURL(/\/login(?:\?|$)/, { timeout: 30_000 });

    // Security: refresh token cookie must be cleared server-side.
    const refreshResponse = await page.request.post(
      "http://localhost:8000/api/v1/auth/refresh",
    );
    expect([400, 401]).toContain(refreshResponse.status());

    // Protected routes should still be protected after logout
    await page.goto("/");
    await expect(page).toHaveURL(/\/login(?:\?|$)/, { timeout: 30_000 });

    await context.close();
  });
});
