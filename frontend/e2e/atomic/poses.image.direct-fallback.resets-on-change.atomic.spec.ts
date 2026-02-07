import { test, expect } from "@playwright/test";
import { assertNo5xx, gotoWithRetry, uiLoginWithToken } from "./atomic-helpers";
import { authedFetch, loginWithToken, makeIsolatedToken, safeJson } from "./atomic-http";

const tinyPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=",
  "base64",
);

test.describe("Atomic pose image src: direct fallback resets when directPath changes", () => {
  test.describe.configure({ mode: "serial" });

  test("after regenerate updates pose.photo_path, UI should switch to the new direct URL even if signed-url is failing", async ({
    browser,
  }) => {
    test.setTimeout(150_000);

    const token = makeIsolatedToken(`img-fallback-reset-${Date.now()}`);
    const { accessToken } = await loginWithToken(token);
    expect(accessToken).toBeTruthy();

    const code = `IMG_${Date.now().toString(36).slice(-10)}`.slice(0, 20);
    const createRes = await authedFetch(accessToken, "/api/v1/poses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, name: `Atomic Image Fallback ${code}` }),
    });
    assertNo5xx(createRes.status, "create pose (image fallback reset suite)");
    expect(createRes.status).toBe(201);
    const poseId = ((await safeJson(createRes)) as { id?: number } | undefined)?.id as number;
    expect(typeof poseId).toBe("number");

    const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3000";
    const context = await browser.newContext({
      baseURL,
      storageState: { cookies: [], origins: [] },
    });
    const page = await context.newPage();

    const oldUrl = "https://atomic.invalid/old.png";
    const newUrl = "https://atomic.invalid/new.png";

    await page.route(oldUrl, async (route) => {
      await route.fulfill({ status: 200, headers: { "content-type": "image/png" }, body: tinyPng });
    });
    await page.route(newUrl, async (route) => {
      await route.fulfill({ status: 200, headers: { "content-type": "image/png" }, body: tinyPng });
    });

    // Force signed-url to fail so usePoseImageSrc falls back to the direct URL.
    await page.route(`**/api/v1/poses/${poseId as number}/image/photo/signed-url`, async (route) => {
      await route.fulfill({
        status: 500,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ detail: "Atomic: signed-url down" }),
      });
    });

    // Keep the pose fetch real, but override the payload for photo_path to simulate an S3 direct URL.
    // This reproduces a bug where a previous fallback "sticks" and a newer directPath is ignored.
    let currentPhotoPath = oldUrl;
    let currentVersion = 1;
    await page.route(`**/api/v1/poses/${poseId as number}`, async (route) => {
      if (route.request().method() !== "GET") {
        await route.continue();
        return;
      }
      const created = await authedFetch(accessToken, `/api/v1/poses/${poseId as number}`, { method: "GET" });
      assertNo5xx(created.status, "get pose (image fallback reset suite)");
      const json = (await safeJson(created)) as any;
      json.photo_path = currentPhotoPath;
      json.schema_path = json.schema_path || "/storage/uploads/schemas/atomic.png";
      json.muscle_layer_path = json.muscle_layer_path || null;
      json.skeleton_layer_path = json.skeleton_layer_path || null;
      json.muscles = Array.isArray(json.muscles) ? json.muscles : [];
      json.version = currentVersion;
      await route.fulfill({
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(json),
      });
    });

    // Mock regeneration pipeline so we can trigger PoseDetail.onComplete refresh deterministically.
    const taskId = `atomic_regen_img_${Date.now()}`;
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

    // Force polling path.
    await page.routeWebSocket("**/ws/generate/**", async (ws) => {
      await ws.close({ code: 1001, reason: "Atomic: ws blocked" });
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

    await page.route(
      `**/api/v1/poses/${poseId as number}/apply-generation/${taskId}`,
      async (route) => {
        // After apply-generation, PoseDetail.onComplete will refetch pose; pretend backend changed photo_path.
        currentPhotoPath = newUrl;
        currentVersion += 1;
        await route.fulfill({
          status: 200,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: poseId }),
        });
      },
    );

    // UI login for this isolated user (with retry for transient dev-server restarts).
    await uiLoginWithToken(page, token);

    try {
      await gotoWithRetry(page, `/poses/${poseId as number}`);

      const active = page.getByTestId("pose-active-image");
      await expect(active).toBeVisible();
      await expect(active).toHaveAttribute("src", oldUrl);

      await page.getByTestId("pose-regenerate").click();
      await expect(page.getByTestId("pose-regenerate-start")).toBeVisible();
      await page.getByTestId("pose-regenerate-feedback").fill("atomic: trigger pose refresh");
      await page.getByTestId("pose-regenerate-start").click();

      await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 30_000 });

      // After refresh, the active image should switch to the new direct URL.
      await expect
        .poll(async () => await page.getByTestId("pose-active-image").getAttribute("src"), {
          timeout: 30_000,
        })
        .toBe(newUrl);
    } finally {
      await authedFetch(accessToken, `/api/v1/poses/${poseId as number}`, { method: "DELETE" }).catch(
        () => undefined,
      );
      await context.close().catch(() => undefined);
    }
  });
});
