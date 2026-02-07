import { test, expect } from "@playwright/test";
import { uiLoginWithToken } from "./atomic-helpers";
import { loginWithToken, makeIsolatedToken } from "./atomic-http";

const tinyPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=",
  "base64",
);

test.describe("Atomic generate: from-text UI retries transient 429 + sends additional_notes", () => {
  test.describe.configure({ mode: "serial" });

  test("Generate page (text tab) retries 429 automatically and includes additional_notes", async ({ browser }) => {
    test.setTimeout(120_000);

    const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3000";
    const context = await browser.newContext({
      baseURL,
      storageState: { cookies: [], origins: [] },
    });
    const page = await context.newPage();

    const token = makeIsolatedToken(`gen-text-429-${Date.now()}`);
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

    const description = `Atomic: text generate ${Date.now()} - neutral spine, shoulders down.`;
    const notes = "Atomic notes: softer lighting, avoid artifacts.";

    const taskId = `atomic_gen_text_${Date.now()}`;
    let fromTextCalls = 0;
    let lastBody: any = null;

    await page.route("**/api/v1/generate/from-text", async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      fromTextCalls += 1;
      try {
        lastBody = route.request().postDataJSON();
      } catch {
        lastBody = null;
      }

      if (fromTextCalls === 1) {
        await route.fulfill({
          status: 429,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ detail: "rate limited", retry_after: 1 }),
        });
        return;
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
      await expect(page.getByTestId("generate-submit")).toBeVisible();

      // Switch to text input tab (second tab).
      await page.getByRole("tab").nth(1).click();

      // Description textarea should appear along with notes textarea.
      await expect(page.locator("textarea")).toHaveCount(2, { timeout: 30_000 });
      await page.locator("textarea").nth(0).fill(description);
      await page.locator("textarea").nth(1).fill(notes);

      await expect(page.getByTestId("generate-submit")).toBeEnabled();
      await page.getByTestId("generate-submit").click();

      // Should automatically retry without user clicking Start again.
      await expect.poll(() => fromTextCalls, { timeout: 25_000 }).toBe(2);
      expect(lastBody?.description).toBe(description);
      expect(lastBody?.additional_notes).toBe(notes);

      // Results render after status completes.
      await expect(page.getByTestId("generate-result-photo")).toBeVisible({ timeout: 30_000 });
    } finally {
      await context.close().catch(() => undefined);
    }
  });
});
