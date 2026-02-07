import { test, expect } from "@playwright/test";
import { assertNo5xx, uiLoginWithToken } from "./atomic-helpers";
import { authedFetch, loginWithToken, makeIsolatedToken, safeJson } from "./atomic-http";

test.describe("Atomic regeneration WS fallback (polling)", () => {
  test.describe.configure({ mode: "serial" });

  test("regenerate succeeds even when WS is blocked", async ({ browser }) => {
    test.setTimeout(120_000);

    const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3000";

    // Isolate from the shared User #1 storageState, otherwise concurrent atomic runs
    // can interfere with the same persistent seed pose and make this test flaky.
    const context = await browser.newContext({
      baseURL,
      storageState: { cookies: [], origins: [] },
    });
    const page = await context.newPage();

    const token = makeIsolatedToken("ui-ws-fallback");
    const { accessToken } = await loginWithToken(token);

    // UI login for the same isolated user.
    await uiLoginWithToken(page, token);

    // Create an isolated pose. We'll mock its paths + the generation pipeline so this test
    // remains fast/deterministic and doesn't stress the backend in bulk atomic runs.
    const code = `WSFB_${Date.now().toString(36).slice(-10)}`.slice(0, 20);
    const createRes = await authedFetch(accessToken, "/api/v1/poses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, name: `Atomic WS Fallback ${code}` }),
    });
    assertNo5xx(createRes.status, "create pose for WS fallback");
    expect(createRes.status).toBe(201);
    const poseId = ((await safeJson(createRes)) as { id?: number } | undefined)?.id as number;
    expect(typeof poseId).toBe("number");

    const tinyPng = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=",
      "base64",
    );
    const oldUrl = `https://atomic.invalid/wsfb-old-${Date.now()}.png`;
    const newUrl = `https://atomic.invalid/wsfb-new-${Date.now()}.png`;
    const schemaUrl = `https://atomic.invalid/wsfb-schema-${Date.now()}.png`;
    await page.route(oldUrl, async (route) => {
      await route.fulfill({ status: 200, headers: { "content-type": "image/png" }, body: tinyPng });
    });
    await page.route(newUrl, async (route) => {
      await route.fulfill({ status: 200, headers: { "content-type": "image/png" }, body: tinyPng });
    });
    await page.route(schemaUrl, async (route) => {
      await route.fulfill({ status: 200, headers: { "content-type": "image/png" }, body: tinyPng });
    });

    let currentPhotoPath = oldUrl;
    let currentVersion = 1;
    await page.route(`**/api/v1/poses/${poseId as number}`, async (route) => {
      if (route.request().method() !== "GET") {
        await route.continue();
        return;
      }
      const real = await authedFetch(accessToken, `/api/v1/poses/${poseId as number}`, { method: "GET" });
      assertNo5xx(real.status, "get pose (ws fallback suite)");
      const json = (await safeJson(real)) as any;
      json.photo_path = currentPhotoPath;
      json.schema_path = schemaUrl;
      json.muscle_layer_path = null;
      json.skeleton_layer_path = null;
      json.muscles = Array.isArray(json.muscles) ? json.muscles : [];
      json.version = currentVersion;
      await route.fulfill({
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(json),
      });
    });

    // Force signed-url endpoints to fail so the UI falls back to direct https:// URLs.
    await page.route(`**/api/v1/poses/${poseId as number}/image/**/signed-url`, async (route) => {
      await route.fulfill({
        status: 500,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ detail: "Atomic: signed-url down (ws fallback suite)" }),
      });
    });

    // Simulate environments where WebSocket is blocked by proxy/VPN.
    await page.routeWebSocket("**/ws/generate/**", async (ws) => {
      await ws.close({ code: 1001, reason: "blocked" });
    });

    // Mock regeneration pipeline.
    const regenTaskId = `atomic_wsfb_${Date.now()}`;
    await page.route(`**/api/v1/generate/from-pose/${poseId as number}`, async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          task_id: regenTaskId,
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
    await page.route(`**/api/v1/generate/status/${regenTaskId}`, async (route) => {
      await route.fulfill({
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          task_id: regenTaskId,
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
    await page.route(`**/api/v1/poses/${poseId as number}/apply-generation/${regenTaskId}`, async (route) => {
      currentPhotoPath = newUrl;
      currentVersion += 1;
      await route.fulfill({
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: poseId }),
      });
    });

    await page.goto(`/poses/${poseId}`);

    const active = page.getByTestId("pose-active-image");
    await expect(active).toBeVisible();
    await expect(active).toHaveAttribute("src", /.+/);
    const beforeSrc = await active.getAttribute("src");
    expect(beforeSrc).toBeTruthy();

    await page.getByTestId("pose-regenerate").click();
    await expect(page.getByTestId("pose-regenerate-start")).toBeVisible();
    await page
      .getByTestId("pose-regenerate-feedback")
      .fill(`Atomic WS-blocked regen ${Date.now().toString(36)}`);

    await page.getByTestId("pose-regenerate-start").click();
    await expect(page.getByTestId("pose-regenerate-progress")).toBeVisible();

    // Modal should close after apply-generation.
    await expect(page.getByTestId("pose-regenerate-progress")).toHaveCount(0, {
      timeout: 60_000,
    });

    // Active image src should change after regeneration applies.
    await expect
      .poll(
        async () => await page.getByTestId("pose-active-image").getAttribute("src"),
        { timeout: 60_000 },
      )
      .not.toBe(beforeSrc);

    await authedFetch(accessToken, `/api/v1/poses/${poseId}`, { method: "DELETE" }).catch(() => undefined);
    await context.close().catch(() => undefined);
  });
});
