import { test, expect } from "@playwright/test";
import { getCorePoseIdA } from "../test-data";

test.describe("Atomic regenerate: start button double-click should not start twice", () => {
  test.describe.configure({ mode: "serial" });

  test("double-clicking Start triggers only one generate/from-pose request", async ({ page }) => {
    const poseId = getCorePoseIdA();
    test.skip(!poseId, "Core seed pose not available");

    let fromPoseCalls = 0;
    await page.route(`**/api/v1/generate/from-pose/${poseId as number}`, async (route) => {
      fromPoseCalls += 1;
      await route.fulfill({
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          task_id: `atomic_double_${Date.now()}`,
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

    // End the generation quickly so the modal can recover.
    await page.route("**/api/v1/generate/status/**", async (route) => {
      await route.fulfill({
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          task_id: route.request().url().split("/").pop(),
          status: "failed",
          progress: 0,
          status_message: "Atomic mocked task",
          error_message: "Atomic mocked task",
          photo_url: null,
          muscles_url: null,
          quota_warning: false,
          analyzed_muscles: null,
        }),
      });
    });

    await page.goto(`/poses/${poseId as number}`);
    await page.getByTestId("pose-regenerate").click();
    await expect(page.getByTestId("pose-regenerate-start")).toBeVisible();

    await page.getByTestId("pose-regenerate-feedback").fill("atomic: double click");

    const start = page.getByTestId("pose-regenerate-start");
    // Fire two clicks as fast as possible; only one request should be made.
    await Promise.all([start.click(), start.click()]);

    await expect.poll(() => fromPoseCalls).toBe(1);
  });
});

