import { test, expect } from "@playwright/test";
import { assertNo5xx, uiLoginWithToken } from "./atomic-helpers";
import { authedFetch, loginWithToken, makeIsolatedToken, safeJson } from "./atomic-http";

const tinyPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=",
  "base64",
);

test.describe("Atomic regenerate: polling survives 429 rate limit", () => {
  test.describe.configure({ mode: "serial" });

  test("when WS is blocked and /generate/status returns 429 once, UI retries and completes", async ({
    browser,
  }) => {
    test.setTimeout(120_000);

    const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3000";
    const context = await browser.newContext({
      baseURL,
      storageState: { cookies: [], origins: [] },
    });
    const page = await context.newPage();

    const token = makeIsolatedToken(`regen-429-${Date.now()}`);
    const { accessToken } = await loginWithToken(token);
    expect(accessToken).toBeTruthy();

    await uiLoginWithToken(page, token);

    // Create an isolated pose and override paths for deterministic UI rendering.
    const code = `R429_${Date.now().toString(36).slice(-10)}`.slice(0, 20);
    const createRes = await authedFetch(accessToken, "/api/v1/poses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, name: `Atomic Regen 429 ${code}` }),
    });
    assertNo5xx(createRes.status, "create pose (regen 429 suite)");
    expect(createRes.status).toBe(201);
    const poseId = ((await safeJson(createRes)) as { id?: number } | undefined)?.id as number;
    expect(typeof poseId).toBe("number");

    const photoUrl = `https://atomic.invalid/regen-429-photo-${Date.now()}.png`;
    await page.route(photoUrl, async (route) => {
      await route.fulfill({
        status: 200,
        headers: { "content-type": "image/png" },
        body: tinyPng,
      });
    });

    // PoseDetail + modal image src uses signed-url by default when directPath is not /storage or http(s).
    await page.route(`**/api/v1/poses/${poseId as number}/image/photo/signed-url`, async (route) => {
      await route.fulfill({
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          signed_url: `${photoUrl}?expires=9999999999&sig=atomic`,
        }),
      });
    });

    // Ensure schema_path exists so RegenerateModal uses /generate/from-pose.
    await page.route(`**/api/v1/poses/${poseId as number}`, async (route) => {
      if (route.request().method() !== "GET") {
        await route.continue();
        return;
      }
      const real = await authedFetch(accessToken, `/api/v1/poses/${poseId as number}`, { method: "GET" });
      assertNo5xx(real.status, "get pose (regen 429 suite)");
      const json = (await safeJson(real)) as any;
      json.photo_path = "needs-signed-url";
      json.schema_path = "any-schema-path";
      json.muscle_layer_path = null;
      json.skeleton_layer_path = null;
      json.muscles = Array.isArray(json.muscles) ? json.muscles : [];
      await route.fulfill({
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(json),
      });
    });

    // Block WS to force polling.
    await page.routeWebSocket("**/ws/generate/**", async (ws) => {
      await ws.close({ code: 1001, reason: "Atomic: WS blocked" });
    });

    const taskId = `atomic_regen_429_${Date.now()}`;
    await page.route(`**/api/v1/generate/from-pose/${poseId as number}`, async (route) => {
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

    let statusCalls = 0;
    await page.route(`**/api/v1/generate/status/${taskId}`, async (route) => {
      statusCalls += 1;
      if (statusCalls === 1) {
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

    await page.route(`**/api/v1/poses/${poseId as number}/apply-generation/${taskId}`, async (route) => {
      await route.fulfill({
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: poseId }),
      });
    });

    try {
      await page.goto(`/poses/${poseId as number}`);
      await page.getByTestId("pose-regenerate").click();
      await expect(page.getByTestId("pose-regenerate-start")).toBeVisible();
      await page.getByTestId("pose-regenerate-feedback").fill("atomic: 429 then recover");
      await page.getByTestId("pose-regenerate-start").click();

      await expect(page.getByTestId("pose-regenerate-progress")).toBeVisible();
      await expect.poll(() => statusCalls).toBeGreaterThanOrEqual(2);
      await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 30_000 });
    } finally {
      await authedFetch(accessToken, `/api/v1/poses/${poseId as number}`, { method: "DELETE" }).catch(
        () => undefined,
      );
      await context.close().catch(() => undefined);
    }
  });
});

