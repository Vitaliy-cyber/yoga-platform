import { test, expect } from "@playwright/test";
import { assertNo5xx, uiLoginWithToken } from "./atomic-helpers";
import { authedFetch, loginWithToken, makeIsolatedToken, safeJson } from "./atomic-http";

const tinyPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=",
  "base64",
);

test.describe("Atomic regenerate: /generate/from-pose retries transient 429", () => {
  test.describe.configure({ mode: "serial" });

  test("regenerate succeeds even if the first from-pose request is rate-limited (429)", async ({ browser }) => {
    test.setTimeout(120_000);

    const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3000";
    const context = await browser.newContext({
      baseURL,
      storageState: { cookies: [], origins: [] },
    });
    const page = await context.newPage();

    const token = makeIsolatedToken(`regen-from-pose-429-${Date.now()}`);
    const { accessToken } = await loginWithToken(token);
    expect(accessToken).toBeTruthy();
    await uiLoginWithToken(page, token);

    const code = `RFP429_${Date.now().toString(36).slice(-10)}`.slice(0, 20);
    const createRes = await authedFetch(accessToken, "/api/v1/poses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, name: `Atomic Regen FromPose 429 ${code}` }),
    });
    assertNo5xx(createRes.status, "create pose (regen from-pose 429 suite)");
    expect(createRes.status).toBe(201);
    const poseId = ((await safeJson(createRes)) as { id?: number } | undefined)?.id as number;
    expect(typeof poseId).toBe("number");

    // Keep categories lightweight (PoseDetail loads them on mount).
    await page.route("**/api/v1/categories**", async (route) => {
      if (route.request().method() !== "GET") {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify([]),
      });
    });

    // Deterministic bytes for any /storage image loads.
    await page.route("**/storage/**", async (route) => {
      await route.fulfill({ status: 200, headers: { "content-type": "image/png" }, body: tinyPng });
    });

    // Ensure the pose has a schema_path so RegenerateModal uses /generate/from-pose.
    const oldPhoto = "/storage/generated/atomic_old.png";
    await page.route(`**/api/v1/poses/${poseId as number}`, async (route) => {
      if (route.request().method() !== "GET") {
        await route.continue();
        return;
      }
      const real = await authedFetch(accessToken, `/api/v1/poses/${poseId as number}`, { method: "GET" });
      assertNo5xx(real.status, "get pose (regen from-pose 429 suite)");
      const json = (await safeJson(real)) as any;
      json.photo_path = oldPhoto;
      json.schema_path = "/storage/uploads/schemas/atomic_schema.png";
      json.muscle_layer_path = null;
      json.skeleton_layer_path = null;
      json.muscles = Array.isArray(json.muscles) ? json.muscles : [];
      json.version = 1;
      await route.fulfill({
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(json),
      });
    });

    // Block WS so we use polling path.
    await page.routeWebSocket("**/ws/generate/**", async (ws) => {
      await ws.close({ code: 1001, reason: "Atomic: WS blocked" });
    });

    const taskId = `atomic_from_pose_429_${Date.now()}`;
    let fromPoseCalls = 0;
    await page.route(`**/api/v1/generate/from-pose/${poseId as number}`, async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      fromPoseCalls += 1;
      if (fromPoseCalls === 1) {
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
      await page.getByTestId("pose-regenerate-feedback").fill("atomic: retry 429 on from-pose");
      await page.getByTestId("pose-regenerate-start").click();

      // Should automatically retry without user clicking Start again.
      await expect.poll(() => fromPoseCalls, { timeout: 20_000 }).toBe(2);
      await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 30_000 });
    } finally {
      await authedFetch(accessToken, `/api/v1/poses/${poseId as number}`, { method: "DELETE" }).catch(
        () => undefined,
      );
      await context.close().catch(() => undefined);
    }
  });
});

