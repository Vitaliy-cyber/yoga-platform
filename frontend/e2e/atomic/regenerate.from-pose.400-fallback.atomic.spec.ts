import { test, expect } from "@playwright/test";
import { getCorePoseIdA } from "../test-data";
import { gotoWithRetry } from "./atomic-helpers";

test.describe("Atomic regenerate: from-pose 400 should fall back to upload /generate", () => {
  test.describe.configure({ mode: "serial" });

  test("falls back to /generate when /generate/from-pose returns 400 schema error", async ({ page }) => {
    const poseId = getCorePoseIdA();
    test.skip(!poseId, "Core seed pose not available");

    // Force from-pose to fail with a schema-related 400 (corrupted/missing schema).
    await page.route(`**/api/v1/generate/from-pose/${poseId as number}`, async (route) => {
      await route.fulfill({
        status: 400,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ detail: "Schema image is empty or corrupted. Please re-upload the schema." }),
      });
    });

    // Ensure schema fetch fails so fallback uses current photo as schema_file.
    await page.route("**/storage/uploads/schemas/**", async (route) => {
      await route.fulfill({ status: 404, body: "Atomic: missing schema" });
    });

    const tinyPng = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=",
      "base64",
    );
    // Make the photo fetch used by fetchImageAsFile deterministic.
    await page.route("**/storage/**", async (route) => {
      const req = route.request();
      if (req.resourceType() !== "fetch") {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 200,
        headers: { "content-type": "image/png" },
        body: tinyPng,
      });
    });

    let calledGenerate = false;
    await page.route("**/api/v1/generate", async (route) => {
      calledGenerate = true;
      await route.fulfill({
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          task_id: `atomic_fallback_${Date.now()}`,
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

    // Prevent hanging on the mocked task.
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

    await gotoWithRetry(page, `/poses/${poseId as number}`);
    await page.getByTestId("pose-regenerate").click();
    await expect(page.getByTestId("pose-regenerate-start")).toBeVisible();

    await page.getByTestId("pose-regenerate-feedback").fill("atomic: 400 fallback");
    await page.getByTestId("pose-regenerate-start").click();

    await expect.poll(() => calledGenerate).toBeTruthy();
  });
});
