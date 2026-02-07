import { test, expect } from "@playwright/test";
import { getCorePoseIdA } from "../test-data";

test.describe("Atomic regenerate modal: cannot close on outside click while generating", () => {
  test.describe.configure({ mode: "serial" });

  test("clicking backdrop does not close modal while generation is in progress", async ({ page }) => {
    const poseId = getCorePoseIdA();
    test.skip(!poseId, "Core seed pose not available");

    const taskId = `atomic_no_close_outside_${Date.now()}`;

    await page.route(`**/api/v1/generate/from-pose/${poseId as number}`, async (route) => {
      await route.fulfill({
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          task_id: taskId,
          status: "pending",
          progress: 0,
          status_message: "In queue...",
          error_message: null,
          photo_url: null,
          muscles_url: null,
          quota_warning: false,
          analyzed_muscles: null,
        }),
      });
    });

    // Force polling path so we keep "generating" deterministically.
    await page.routeWebSocket("**/ws/generate/**", async (ws) => {
      await ws.close({ code: 1001, reason: "Atomic: ws blocked" });
    });

    await page.route(`**/api/v1/generate/status/${taskId}`, async (route) => {
      await route.fulfill({
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          task_id: taskId,
          status: "processing",
          progress: 10,
          status_message: "Atomic: processing",
          error_message: null,
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

    await page.getByTestId("pose-regenerate-feedback").fill("atomic: no close outside click");
    await page.getByTestId("pose-regenerate-start").click();

    await expect(page.getByTestId("pose-regenerate-progress")).toBeVisible();

    // Click somewhere outside the dialog content (backdrop).
    // Dialog is centered, so top-left is safe.
    await page.mouse.click(5, 5);

    // Modal remains open while generation is active.
    await expect(page.getByTestId("pose-regenerate-progress")).toBeVisible();
    await expect(page.getByTestId("pose-regenerate-start")).toHaveCount(0);
  });
});

