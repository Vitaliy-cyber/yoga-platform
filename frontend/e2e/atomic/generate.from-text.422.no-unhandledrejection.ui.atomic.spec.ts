import { test, expect } from "@playwright/test";
import { uiLoginWithToken } from "./atomic-helpers";
import { loginWithToken, makeIsolatedToken } from "./atomic-http";

test.describe("Atomic generate: from-text 422 must not trigger window.unhandledrejection", () => {
  test.describe.configure({ mode: "serial" });

  test("Generate page shows error and keeps UI usable when /generate/from-text returns 422", async ({ browser }) => {
    test.setTimeout(120_000);

    const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3000";
    const context = await browser.newContext({
      baseURL,
      storageState: { cookies: [], origins: [] },
    });
    const page = await context.newPage();

    const token = makeIsolatedToken(`gen-text-422-unhandled-${Date.now()}`);
    const { accessToken } = await loginWithToken(token);
    expect(accessToken).toBeTruthy();
    await uiLoginWithToken(page, token);

    await page.addInitScript(() => {
      (window as any).__atomicUnhandled = [];
      window.addEventListener("unhandledrejection", (event) => {
        (window as any).__atomicUnhandled.push({
          reason: String((event as PromiseRejectionEvent).reason || "unknown"),
        });
      });
    });

    await page.route("**/api/v1/generate/from-text", async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 422,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ detail: "Atomic: invalid additional notes" }),
      });
    });

    try {
      await page.goto("/generate");
      await page.getByRole("tab").nth(1).click();

      await page.getByTestId("generate-text-description").fill(
        "Atomic: description long enough for 422 start test.",
      );
      await page.getByTestId("generate-additional-notes").fill("bad:\ud800");

      await expect(page.getByTestId("generate-submit")).toBeEnabled();
      await page.getByTestId("generate-submit").click();

      // UI should show an error and keep the button enabled for retry.
      await expect(
        page.locator("div.bg-red-50").filter({ hasText: "Atomic: invalid additional notes" }).first(),
      ).toBeVisible({ timeout: 10_000 });
      await expect(page.getByTestId("generate-submit")).toBeEnabled();

      // No unhandled promise rejections.
      const unhandled = await page.evaluate(() => (window as any).__atomicUnhandled || []);
      expect(unhandled).toEqual([]);
    } finally {
      await context.close().catch(() => undefined);
    }
  });
});
