import { test, expect } from "@playwright/test";
import { getCorePoseIdA } from "../test-data";

test.describe("Atomic regenerate upload fallback: schema-only path", () => {
  test.describe.configure({ mode: "serial" });

  test("proceeds with schema_file even when reference photo fetch would fail", async ({ page }) => {
    const poseId = getCorePoseIdA();
    test.skip(!poseId, "Core seed pose not available");

    // Force server-side from-pose to fail so the client uses upload fallback.
    await page.route("**/api/v1/generate/from-pose/**", async (route) => {
      await route.fulfill({
        status: 502,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ detail: "Atomic: force upload fallback" }),
      });
    });

    // If the fallback tries to fetch the current photo as a File, return 404 for fetch/XHR only.
    // <img> tags should still load (so the UI renders).
    await page.route("**/storage/generated/**", async (route) => {
      const req = route.request();
      if (req.resourceType() !== "fetch") {
        await route.continue();
        return;
      }
      await route.fulfill({ status: 404, body: "Atomic: break photo fetchImageAsFile" });
    });

    let capturedBody: Buffer | null = null;
    const mockedTaskId = `atomic_schema_only_${Date.now()}`;

    await page.route("**/api/v1/generate", async (route) => {
      const buf = route.request().postDataBuffer?.();
      capturedBody =
        buf && Buffer.isBuffer(buf) ? buf : Buffer.from(route.request().postData() || "", "utf8");
      await route.fulfill({
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          task_id: mockedTaskId,
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

    await page.goto(`/poses/${poseId as number}`);
    await page.getByTestId("pose-regenerate").click();
    await expect(page.getByTestId("pose-regenerate-start")).toBeVisible();

    await page.getByTestId("pose-regenerate-feedback").fill("atomic: schema-only fallback");
    await page.getByTestId("pose-regenerate-start").click();

    await expect.poll(() => capturedBody).not.toBeNull();
    const normalized = (capturedBody as Buffer).toString("latin1").replace(/\r\n/g, "\n");
    expect(normalized).toContain('name="schema_file"');
    expect(normalized).toContain("_schema.png");
    expect(normalized).not.toContain("_photo.png");
    expect(normalized).not.toContain("_muscles.png");
  });
});

