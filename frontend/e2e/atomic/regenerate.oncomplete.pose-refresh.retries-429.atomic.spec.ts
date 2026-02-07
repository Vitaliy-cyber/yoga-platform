import { test, expect } from "@playwright/test";
import { assertNo5xx, uiLoginWithToken } from "./atomic-helpers";
import { authedFetch, loginWithToken, makeIsolatedToken, safeJson } from "./atomic-http";

const tinyPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=",
  "base64",
);

test.describe("Atomic regenerate: PoseDetail onComplete retries pose refresh on 429", () => {
  test.describe.configure({ mode: "serial" });

  test("after regeneration, a transient 429 on pose refresh still updates active image", async ({ browser }) => {
    test.setTimeout(120_000);

    const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3000";
    const context = await browser.newContext({
      baseURL,
      storageState: { cookies: [], origins: [] },
    });
    const page = await context.newPage();

    const token = makeIsolatedToken(`pose-refresh-429-${Date.now()}`);
    const { accessToken } = await loginWithToken(token);
    expect(accessToken).toBeTruthy();
    await uiLoginWithToken(page, token);

    const code = `PR429_${Date.now().toString(36).slice(-10)}`.slice(0, 20);
    const createRes = await authedFetch(accessToken, "/api/v1/poses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, name: `Atomic Pose Refresh 429 ${code}` }),
    });
    assertNo5xx(createRes.status, "create pose (pose refresh 429 suite)");
    expect(createRes.status).toBe(201);
    const poseId = ((await safeJson(createRes)) as { id?: number } | undefined)?.id as number;
    expect(typeof poseId).toBe("number");

    // Serve deterministic bytes for any /storage image loads.
    await page.route("**/storage/**", async (route) => {
      await route.fulfill({ status: 200, headers: { "content-type": "image/png" }, body: tinyPng });
    });

    let afterApply = false;
    let poseGetCallsAfterApply = 0;
    const oldPhoto = "/storage/generated/atomic_old.png";
    const newPhoto = "/storage/generated/atomic_new.png";

    await page.route(`**/api/v1/poses/${poseId as number}`, async (route) => {
      if (route.request().method() !== "GET") {
        await route.continue();
        return;
      }

      if (afterApply) {
        poseGetCallsAfterApply += 1;
        if (poseGetCallsAfterApply === 1) {
          await route.fulfill({
            status: 429,
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ detail: "rate limited", retry_after: 1 }),
          });
          return;
        }
      }

      const real = await authedFetch(accessToken, `/api/v1/poses/${poseId as number}`, { method: "GET" });
      assertNo5xx(real.status, "get pose (pose refresh 429 suite)");
      const json = (await safeJson(real)) as any;
      json.photo_path = afterApply ? newPhoto : oldPhoto;
      json.schema_path = "/storage/uploads/schemas/atomic_schema.png";
      json.muscle_layer_path = null;
      json.skeleton_layer_path = null;
      json.muscles = Array.isArray(json.muscles) ? json.muscles : [];
      json.version = afterApply ? 2 : 1;
      await route.fulfill({
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(json),
      });
    });

    // Mock regeneration pipeline so the modal closes quickly.
    await page.routeWebSocket("**/ws/generate/**", async (ws) => {
      await ws.close({ code: 1001, reason: "Atomic: WS blocked" });
    });
    const taskId = `atomic_pose_refresh_429_${Date.now()}`;
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
    await page.route(`**/api/v1/poses/${poseId as number}/apply-generation/${taskId}`, async (route) => {
      afterApply = true;
      await route.fulfill({
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: poseId }),
      });
    });

    try {
      await page.goto(`/poses/${poseId as number}`);

      const active = page.getByTestId("pose-active-image");
      await expect(active).toBeVisible();
      await expect(active).toHaveAttribute("src", oldPhoto);

      await page.getByTestId("pose-regenerate").click();
      await expect(page.getByTestId("pose-regenerate-start")).toBeVisible();
      await page.getByTestId("pose-regenerate-feedback").fill("atomic: regen then rate limit");
      await page.getByTestId("pose-regenerate-start").click();

      // Modal closes after apply-generation regardless of refresh outcome.
      await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 30_000 });

      // OnComplete should retry pose refresh and eventually update active image.
      await expect.poll(async () => await active.getAttribute("src"), { timeout: 30_000 }).toBe(newPhoto);
      await expect.poll(() => poseGetCallsAfterApply).toBeGreaterThanOrEqual(2);
    } finally {
      await authedFetch(accessToken, `/api/v1/poses/${poseId as number}`, { method: "DELETE" }).catch(
        () => undefined,
      );
      await context.close().catch(() => undefined);
    }
  });
});

