import { test, expect } from "@playwright/test";
import { assertNo5xx, gotoWithRetry } from "./atomic-helpers";
import { authedFetch, loginWithToken, makeIsolatedToken, safeJson } from "./atomic-http";

test.describe("Atomic generate: onComplete failures must not cause unhandled rejections", () => {
  test.describe.configure({ mode: "serial" });

  test("a failing onComplete refresh does not trigger window.unhandledrejection", async ({
    browser,
  }) => {
    test.setTimeout(120_000);

    const token = makeIsolatedToken(`gen-ui-oncomplete-${Date.now()}`);
    const { accessToken, userId } = await loginWithToken(token);
    expect(accessToken).toBeTruthy();

    const code = `GEN_${Date.now().toString(36).slice(-8)}`.slice(0, 20);
    const createRes = await authedFetch(accessToken, "/api/v1/poses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, name: `Atomic Generate ${code}` }),
    });
    assertNo5xx(createRes.status, "create pose (generate onComplete suite)");
    expect(createRes.status).toBe(201);
    const poseId = ((await safeJson(createRes)) as { id?: number } | undefined)?.id;
    expect(typeof poseId).toBe("number");

    const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3000";
    const context = await browser.newContext({
      baseURL,
      storageState: { cookies: [], origins: [] },
    });

    // Inject auth directly into localStorage so this test doesn't depend on the /login UI being
    // responsive under heavy atomic load (it isn't the focus of this spec).
    const meRes = await authedFetch(accessToken, "/api/v1/auth/me");
    assertNo5xx(meRes.status, "auth/me (generate onComplete)");
    expect(meRes.status).toBe(200);
    const meJson = (await safeJson(meRes)) as
      | { id?: number; name?: string | null; created_at?: string; last_login?: string | null }
      | undefined;
    expect(meJson?.id).toBe(userId);

    const authKey = "yoga_auth_token";
    const authValue = JSON.stringify({
      state: {
        user: {
          id: meJson?.id as number,
          name: (meJson?.name ?? null) as string | null,
          created_at: (meJson?.created_at ?? new Date().toISOString()) as string,
          last_login: (meJson?.last_login ?? null) as string | null,
        },
        accessToken,
        tokenExpiresAt: Date.now() + 60 * 60 * 1000,
      },
      version: 0,
    });
    await context.addInitScript(
      ({ k, v }) => {
        window.localStorage.setItem(k, v);
      },
      { k: authKey, v: authValue },
    );

    const page = await context.newPage();

    await page.addInitScript(() => {
      (window as any).__atomicUnhandled = [];
      window.addEventListener("unhandledrejection", (event) => {
        (window as any).__atomicUnhandled.push({
          reason: String((event as PromiseRejectionEvent).reason || "unknown"),
        });
      });
    });

    const taskId = `atomic_generate_${Date.now()}`;

    // Mock generation start.
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

    // Apply succeeds.
    await page.route(
      `**/api/v1/poses/${poseId as number}/apply-generation/${taskId}`,
      async (route) => {
        await route.fulfill({
          status: 200,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: poseId }),
        });
      },
    );

    // Fail the pose refresh caused by onComplete after apply-generation.
    let shouldFailPoseRefresh = false;
    await page.route(`**/api/v1/poses/${poseId as number}`, async (route) => {
      if (route.request().method() !== "GET") {
        await route.continue();
        return;
      }
      if (!shouldFailPoseRefresh) {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 500,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ detail: "Atomic: refresh failed" }),
      });
    });

    try {
      await gotoWithRetry(page, `/poses/${poseId as number}`, { timeoutMs: 45_000 });

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

      await page.getByTestId("pose-generate-notes").fill("atomic: onComplete rejection");

      // Fail the subsequent pose refresh caused by onComplete after apply-generation.
      shouldFailPoseRefresh = true;
      await page.getByTestId("pose-generate-start").click();

      await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 20_000 });

      const unhandled = await page.evaluate(() => (window as any).__atomicUnhandled || []);
      expect(unhandled).toEqual([]);
    } finally {
      await authedFetch(accessToken, `/api/v1/poses/${poseId as number}`, { method: "DELETE" }).catch(
        () => undefined,
      );
      await context.close().catch(() => undefined);
    }
  });
});
