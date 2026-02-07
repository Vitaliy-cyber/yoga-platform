import { test, expect } from "@playwright/test";
import { uiLoginWithToken } from "./atomic-helpers";
import { loginWithToken, makeIsolatedToken } from "./atomic-http";

const tinyPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=",
  "base64",
);

test.describe("Atomic generate: muscles toggle hides muscles output", () => {
  test.describe.configure({ mode: "serial" });

  test("when muscles option is off, UI does not render muscles result/tab even if API returns muscles_url", async ({ browser }) => {
    test.setTimeout(120_000);

    const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3000";
    const context = await browser.newContext({
      baseURL,
      storageState: { cookies: [], origins: [] },
    });
    const page = await context.newPage();

    const token = makeIsolatedToken(`gen-muscles-off-${Date.now()}`);
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

    const taskId = `atomic_gen_muscles_off_${Date.now()}`;
    await page.route("**/api/v1/generate", async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
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

      await page.getByTestId("generate-file-input").setInputFiles({
        name: "schema.png",
        mimeType: "image/png",
        buffer: tinyPng,
      });

      // Turn off muscle generation option.
      const checkbox = page.getByRole("checkbox").first();
      await expect(checkbox).toBeChecked();
      await checkbox.click();
      await expect(checkbox).not.toBeChecked();

      await expect(page.getByTestId("generate-submit")).toBeEnabled();
      await page.getByTestId("generate-submit").click();

      await expect(page.getByTestId("generate-result-photo")).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId("generate-result-muscles")).toHaveCount(0);

      await page.getByTestId("generate-open-viewer").click();
      await expect(page.getByTestId("generate-viewer-tab-muscles")).toHaveCount(0);
    } finally {
      await context.close().catch(() => undefined);
    }
  });
});

