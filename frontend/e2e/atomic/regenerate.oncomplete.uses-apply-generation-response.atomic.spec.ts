import { test, expect } from "@playwright/test";
import { TEST_TOKEN } from "../fixtures";
import { authedFetch, loginWithToken, safeJson } from "./atomic-http";
import { assertNo5xx, gotoWithRetry } from "./atomic-helpers";

const tinyPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=",
  "base64",
);

async function createPose(accessToken: string, code: string): Promise<number> {
  const res = await authedFetch(accessToken, "/api/v1/poses", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, name: `Atomic Regen ApplyPose ${code}` }),
  });
  assertNo5xx(res.status, "create pose");
  expect(res.status).toBe(201);
  const json = (await safeJson(res)) as { id?: number } | undefined;
  expect(typeof json?.id).toBe("number");
  return json?.id as number;
}

async function deletePose(accessToken: string, poseId: number): Promise<void> {
  await authedFetch(accessToken, `/api/v1/poses/${poseId}`, { method: "DELETE" }).catch(
    () => undefined,
  );
}

test.describe("Atomic regenerate: apply-generation response is enough to refresh UI", () => {
  test.describe.configure({ mode: "serial" });

  let accessToken = "";

  test.beforeAll(async () => {
    accessToken = (await loginWithToken(TEST_TOKEN)).accessToken;
    expect(accessToken).toBeTruthy();
  });

  test("updates active image even if pose refetch fails after apply-generation", async ({ page }) => {
    const code = `RAPPLY_${Date.now().toString(36).slice(-10)}`.slice(0, 20);
    const poseId = await createPose(accessToken, code);

    try {
      const oldPhotoUrl = `https://atomic.invalid/regen-old-${Date.now()}.png`;
      const newPhotoUrl = `https://atomic.invalid/regen-new-${Date.now()}.png`;
      const schemaUrl = `https://atomic.invalid/regen-schema-${Date.now()}.png`;

      // Deterministic images for UI <img> loads.
      for (const url of [oldPhotoUrl, newPhotoUrl, schemaUrl]) {
        await page.route(url, async (route) => {
          await route.fulfill({
            status: 200,
            headers: { "content-type": "image/png" },
            body: tinyPng,
          });
        });
      }

      // Keep initial pose fetch real, but override paths so:
      // - photo_path exists => UI shows active image,
      // - schema_path exists => regeneration uses /generate/from-pose (no upload fallback).
      let poseGetCount = 0;
      let initialPose: any = null;
      await page.route(`**/api/v1/poses/${poseId as number}`, async (route) => {
        const req = route.request();
        if (req.method() !== "GET") {
          await route.continue();
          return;
        }

        poseGetCount += 1;
        if (poseGetCount === 1) {
          const real = await authedFetch(accessToken, `/api/v1/poses/${poseId as number}`, {
            method: "GET",
          });
          assertNo5xx(real.status, "get pose (apply-generation response test)");
          const json = (await safeJson(real)) as any;
          json.photo_path = oldPhotoUrl;
          json.schema_path = schemaUrl;
          json.muscle_layer_path = null;
          json.skeleton_layer_path = null;
          json.muscles = Array.isArray(json.muscles) ? json.muscles : [];
          json.version = typeof json.version === "number" ? json.version : 1;
          initialPose = json;
          await route.fulfill({
            status: 200,
            headers: { "content-type": "application/json" },
            body: JSON.stringify(json),
          });
          return;
        }

        // Simulate the post-apply refresh failing (rate limit / transient outage).
        await route.fulfill({
          status: 503,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ detail: "Atomic: pose refetch unavailable" }),
        });
      });

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

      // Prevent signed-url fetches from hiding the direct https:// image paths.
      await page.route(`**/api/v1/poses/${poseId as number}/image/**/signed-url`, async (route) => {
        await route.fulfill({
          status: 500,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ detail: "Atomic: signed-url down" }),
        });
      });

      // Stub version history list to avoid backend coupling.
      await page.route(`**/api/v1/poses/${poseId as number}/versions**`, async (route) => {
        if (route.request().method() !== "GET") {
          await route.continue();
          return;
        }
        await route.fulfill({
          status: 200,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ items: [] }),
        });
      });

      const taskId = `atomic_apply_pose_${Date.now()}`;
      await page.route(`**/api/v1/generate/from-pose/${poseId as number}`, async (route) => {
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

      await page.route(`**/api/v1/poses/${poseId as number}/apply-generation/${taskId}`, async (route) => {
        const applied = {
          ...(initialPose || { id: poseId }),
          id: poseId,
          photo_path: newPhotoUrl,
          version:
            typeof (initialPose || {})?.version === "number"
              ? (initialPose as any).version + 1
              : 2,
        };
        await route.fulfill({
          status: 200,
          headers: { "content-type": "application/json" },
          body: JSON.stringify(applied),
        });
      });

      await gotoWithRetry(page, `/poses/${poseId as number}`);

      await expect(page.getByTestId("pose-active-image")).toHaveAttribute("src", oldPhotoUrl);

      await page.getByTestId("pose-regenerate").click();
      await expect(page.getByTestId("pose-regenerate-start")).toBeVisible();
      await page.getByTestId("pose-regenerate-feedback").fill("atomic: refresh via apply-generation");
      await page.getByTestId("pose-regenerate-start").click();

      // Modal should close on success.
      await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 20_000 });

      // UI should update to the new photo URL even if /poses/:id refetch is down.
      await expect(page.getByTestId("pose-active-image")).toHaveAttribute("src", newPhotoUrl, {
        timeout: 10_000,
      });
    } finally {
      await deletePose(accessToken, poseId);
    }
  });
});

