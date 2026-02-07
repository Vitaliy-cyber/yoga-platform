import { test, expect } from "@playwright/test";
import { getCorePoseIdA } from "../test-data";
import { gotoWithRetry } from "./atomic-helpers";

test.describe("Atomic regenerate: apply-generation retries transient 503", () => {
  test.describe.configure({ mode: "serial" });

  test("retries apply-generation on 503 and closes modal after success", async ({ page }) => {
    const poseId = getCorePoseIdA();
    test.skip(!poseId, "Core seed pose not available");

    const taskId = `atomic_apply_retry_503_${Date.now()}`;

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

    let applyCalls = 0;
    await page.route(
      `**/api/v1/poses/${poseId as number}/apply-generation/${taskId}`,
      async (route) => {
        applyCalls += 1;
        if (applyCalls <= 2) {
          await route.fulfill({
            status: 503,
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ detail: "Atomic: transient unavailable" }),
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

    await gotoWithRetry(page, `/poses/${poseId as number}`, { timeoutMs: 45_000 });
    await page.getByTestId("pose-regenerate").click();
    await expect(page.getByTestId("pose-regenerate-start")).toBeVisible();

    await page.getByTestId("pose-regenerate-feedback").fill("atomic: apply retries 503");
    await page.getByTestId("pose-regenerate-start").click();

    await expect.poll(() => applyCalls, { timeout: 25_000 }).toBeGreaterThanOrEqual(3);
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
});
