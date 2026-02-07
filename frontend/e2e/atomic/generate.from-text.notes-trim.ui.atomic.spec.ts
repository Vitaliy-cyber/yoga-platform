import { test, expect } from "@playwright/test";
import { uiLoginWithToken } from "./atomic-helpers";
import { loginWithToken, makeIsolatedToken } from "./atomic-http";

const tinyPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=",
  "base64",
);

test.describe("Atomic generate: from-text trims/omits additional_notes", () => {
  test.describe.configure({ mode: "serial" });

  test("text Generate page trims additional_notes and omits whitespace-only notes", async ({ browser }) => {
    test.setTimeout(120_000);

    const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3000";
    const context = await browser.newContext({
      baseURL,
      storageState: { cookies: [], origins: [] },
    });
    const page = await context.newPage();

    const token = makeIsolatedToken(`gen-text-notes-trim-${Date.now()}`);
    const { accessToken } = await loginWithToken(token);
    expect(accessToken).toBeTruthy();
    await uiLoginWithToken(page, token);

    // Block WS so we use polling path.
    await page.routeWebSocket("**/ws/generate/**", async (ws) => {
      await ws.close({ code: 1001, reason: "Atomic: WS blocked" });
    });

    await page.route("**/storage/**", async (route) => {
      await route.fulfill({ status: 200, headers: { "content-type": "image/png" }, body: tinyPng });
    });

    let lastBody: any = null;
    const taskId = `atomic_gen_text_notes_${Date.now()}`;
    await page.route("**/api/v1/generate/from-text", async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      try {
        lastBody = route.request().postDataJSON();
      } catch {
        lastBody = null;
      }
      await route.fulfill({
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          task_id: taskId,
          status: "pending",
          progress: 0,
          status_message: "Atomic: started",
          error_message: null,
          photo_url: null,
          muscles_url: null,
          quota_warning: false,
          analyzed_muscles: null,
        }),
      });
    });

    await page.route(`**/api/v1/generate/status/${taskId}`, async (route) => {
      await route.fulfill({
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          task_id: taskId,
          status: "completed",
          progress: 100,
          status_message: "Atomic: completed",
          error_message: null,
          photo_url: "/storage/generated/atomic_photo.png",
          muscles_url: "/storage/generated/atomic_muscles.png",
          quota_warning: false,
          analyzed_muscles: null,
        }),
      });
    });

    try {
      await page.goto("/generate");
      await page.getByRole("tab").nth(1).click();

      await expect(page.getByTestId("generate-text-description")).toBeVisible();
      await page.getByTestId("generate-text-description").fill("Atomic: trim notes (text) — stable.");

      // Case 1: trim
      await page.getByTestId("generate-additional-notes").fill("   hello world   ");
      await page.getByTestId("generate-submit").click();
      await expect(page.getByTestId("generate-result-photo")).toBeVisible({ timeout: 30_000 });
      expect(lastBody?.additional_notes).toBe("hello world");

      // Reset and try whitespace-only omit
      await page.getByTestId("generate-reset").click();
      await expect(page.getByTestId("generate-text-description")).toBeVisible();
      await page.getByTestId("generate-text-description").fill("Atomic: omit whitespace-only notes.");
      await page.getByTestId("generate-additional-notes").fill("   \n\t  ");
      await page.getByTestId("generate-submit").click();
      await expect(page.getByTestId("generate-result-photo")).toBeVisible({ timeout: 30_000 });
      expect(Object.prototype.hasOwnProperty.call(lastBody || {}, "additional_notes")).toBe(false);
    } finally {
      await context.close().catch(() => undefined);
    }
  });
});

