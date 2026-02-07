import { test, expect } from "@playwright/test";
import { getCorePoseIdA } from "../test-data";

test.describe("Atomic regenerate: photo broken should fall back to muscles overlay", () => {
  test.describe.configure({ mode: "serial" });

  test("when active tab is Photo and photo fetch fails, use muscles overlay as fallback", async ({
    page,
  }) => {
    const poseId = getCorePoseIdA();
    test.skip(!poseId, "Core seed pose not available");

    // Force server-side generation to fail so we exercise client upload path.
    await page.route(`**/api/v1/generate/from-pose/${poseId as number}`, async (route) => {
      await route.fulfill({
        status: 404,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ detail: "Atomic: force client fallback" }),
      });
    });

    const tinyPng = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=",
      "base64",
    );

    let muscleFetches = 0;
    let photoFetches = 0;
    // Make fetchImageAsFile deterministic and simulate broken photo.
    await page.route("**/storage/**", async (route) => {
      const req = route.request();
      if (req.resourceType() !== "fetch") {
        await route.continue();
        return;
      }
      const url = req.url().toLowerCase();

      if (url.includes("schema")) {
        await route.fulfill({ status: 404, body: "Atomic: missing schema" });
        return;
      }

      if (url.includes("muscle")) {
        muscleFetches += 1;
        await route.fulfill({
          status: 200,
          headers: { "content-type": "image/png" },
          body: tinyPng,
        });
        return;
      }

      if (url.includes("photo")) {
        photoFetches += 1;
        await route.fulfill({ status: 404, body: "Atomic: broken photo" });
        return;
      }

      // Default to OK for any other fetches.
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
          task_id: `atomic_photo_fallback_${Date.now()}`,
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

    // Ensure the muscles tab exists; otherwise regeneration can't fall back.
    const musclesTab = page.getByTestId("pose-tab-muscles");
    if (await musclesTab.isDisabled()) {
      test.skip(true, "Muscles overlay not available for this pose");
    }

    // Stay on Photo tab (default) and start regeneration.
    await page.getByTestId("pose-regenerate").click();
    await expect(page.getByTestId("pose-regenerate-start")).toBeVisible();

    await page.getByTestId("pose-regenerate-feedback").fill("atomic: photo broken fallback to muscles");
    await page.getByTestId("pose-regenerate-start").click();

    await expect.poll(() => calledGenerate).toBeTruthy();
    await expect.poll(() => photoFetches).toBeGreaterThan(0);
    await expect.poll(() => muscleFetches).toBeGreaterThan(0);
  });
});

