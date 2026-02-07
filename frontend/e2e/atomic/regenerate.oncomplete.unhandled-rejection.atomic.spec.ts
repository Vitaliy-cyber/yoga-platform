import { test, expect } from "@playwright/test";
import { getCorePoseIdA } from "../test-data";

test.describe("Atomic regenerate: onComplete failures must not cause unhandled rejections", () => {
  test.describe.configure({ mode: "serial" });

  test("a failing onComplete refresh does not trigger window.unhandledrejection", async ({
    page,
  }) => {
    const poseId = getCorePoseIdA();
    test.skip(!poseId, "Core seed pose not available");

    await page.addInitScript(() => {
      (window as any).__atomicUnhandled = [];
      window.addEventListener("unhandledrejection", (event) => {
        (window as any).__atomicUnhandled.push({
          reason: String((event as PromiseRejectionEvent).reason || "unknown"),
        });
      });
    });

    const taskId = `atomic_oncomplete_${Date.now()}`;

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

    // Complete generation quickly.
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

    // The parent onComplete callback refreshes the pose via GET /api/v1/poses/:id.
    // Allow normal page load, then fail the refresh triggered by onComplete.
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

    await page.goto(`/poses/${poseId as number}`);
    await page.getByTestId("pose-regenerate").click();
    await expect(page.getByTestId("pose-regenerate-start")).toBeVisible();
    await page.getByTestId("pose-regenerate-feedback").fill("atomic: onComplete rejection");

    // Fail the subsequent pose refresh caused by onComplete after apply-generation.
    shouldFailPoseRefresh = true;
    await page.getByTestId("pose-regenerate-start").click();

    // Wait for the modal to attempt apply and close.
    await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 20_000 });

    const unhandled = await page.evaluate(() => (window as any).__atomicUnhandled || []);
    expect(unhandled).toEqual([]);
  });
});
