import { test, expect } from "@playwright/test";
import { assertNo5xx } from "./atomic-helpers";
import { authedFetch, loginWithToken, makeIsolatedToken, safeJson } from "./atomic-http";

test.describe("Atomic generate: apply-generation retries transient 429", () => {
  test.describe.configure({ mode: "serial" });

  test("retries apply-generation on 429 and closes modal after success", async ({ browser }) => {
    test.setTimeout(150_000);

    const token = makeIsolatedToken(`gen-apply-429-${Date.now()}`);
    const { accessToken } = await loginWithToken(token);
    expect(accessToken).toBeTruthy();

    const code = `GEN_${Date.now().toString(36).slice(-8)}`.slice(0, 20);
    const createRes = await authedFetch(accessToken, "/api/v1/poses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, name: `Atomic Generate ${code}` }),
    });
    assertNo5xx(createRes.status, "create pose (generate apply 429 suite)");
    expect(createRes.status).toBe(201);
    const poseId = ((await safeJson(createRes)) as { id?: number } | undefined)?.id;
    expect(typeof poseId).toBe("number");

    const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3000";
    const context = await browser.newContext({
      baseURL,
      storageState: { cookies: [], origins: [] },
    });
    const page = await context.newPage();

    const taskId = `atomic_generate_apply_429_${Date.now()}`;

    // Mock generation start (upload path).
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

    // Force polling path.
    await page.routeWebSocket("**/ws/generate/**", async (ws) => {
      await ws.close({ code: 1001, reason: "Atomic: ws blocked" });
    });

    // Complete quickly.
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

    let applyCalls = 0;
    await page.route(
      `**/api/v1/poses/${poseId as number}/apply-generation/${taskId}`,
      async (route) => {
        applyCalls += 1;
        if (applyCalls <= 2) {
          await route.fulfill({
            status: 429,
            headers: { "content-type": "application/json", "retry-after": "1" },
            body: JSON.stringify({ detail: "Atomic: rate limited", retry_after: 1 }),
          });
          return;
        }
        await route.fulfill({
          status: 200,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: poseId }),
        });
      },
    );

    // UI login for this isolated user.
    await page.goto("/login");
    await expect(page).toHaveURL(/\/login(?:\?|#|$)/, { timeout: 20_000 });
    await page.waitForLoadState("networkidle");
    const tokenInput = page
      .locator('input[type="text"], input[type="password"], input[name="token"], input[id="token"]')
      .first();
    await tokenInput.fill(token);
    const submitButton = page
      .locator('button[type="submit"], button:has-text("Sign"), button:has-text("Login"), button:has-text("Увійти")')
      .first();
    await submitButton.click();
    await page.waitForURL("/", { timeout: 20_000 });
    await page.waitForLoadState("networkidle");

    try {
      await page.goto(`/poses/${poseId as number}`);

      await expect(page.getByTestId("pose-generate")).toBeVisible();
      await page.getByTestId("pose-generate").click();
      await expect(page.getByTestId("pose-generate-start")).toBeVisible();

      const tinyPng = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=",
        "base64",
      );
      const dialog = page.getByRole("dialog");
      await dialog.locator('input[type="file"]').setInputFiles({
        name: "schema.png",
        mimeType: "image/png",
        buffer: tinyPng,
      });

      await page.getByTestId("pose-generate-notes").fill("atomic: apply retries 429");
      await page.getByTestId("pose-generate-start").click();

      await expect.poll(() => applyCalls, { timeout: 30_000 }).toBeGreaterThanOrEqual(3);
      await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 30_000 });
    } finally {
      await authedFetch(accessToken, `/api/v1/poses/${poseId as number}`, { method: "DELETE" }).catch(
        () => undefined,
      );
      await context.close().catch(() => undefined);
    }
  });
});

