import { test, expect } from "@playwright/test";
import { getCorePoseIdA } from "../test-data";

test.describe("Atomic regenerate upload fallback: content-type hardening", () => {
  test.describe.configure({ mode: "serial" });

  test("forces schema_file content-type to image/* even when fetched blob is octet-stream", async ({
    page,
  }) => {
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

    // Break schema download so fallback continues with reference photo only.
    await page.route("**/storage/uploads/schemas/**", async (route) => {
      await route.fulfill({ status: 404, body: "Atomic: missing schema" });
    });

    // Intercept the reference photo fetch used by fetchImageAsFile.
    // Serve valid PNG bytes but with an incorrect content-type to simulate
    // misconfigured storage/proxy headers.
    const tinyPng = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=",
      "base64",
    );
    let injectOctetStream = false;
    await page.route("**/storage/**", async (route) => {
      const req = route.request();
      if (!injectOctetStream) {
        await route.continue();
        return;
      }
      // Only affect fetch/XHR, not <img> tags, so the UI still renders.
      if (req.resourceType() !== "fetch") {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 200,
        headers: { "content-type": "application/octet-stream" },
        body: tinyPng,
      });
    });

    // Capture multipart body sent to /generate and ensure schema_file part uses image/png.
    let capturedBody: Buffer | null = null;
    await page.route("**/api/v1/generate", async (route) => {
      const buf = route.request().postDataBuffer?.();
      capturedBody = buf && Buffer.isBuffer(buf) ? buf : Buffer.from(route.request().postData() || "", "utf8");
      await route.fulfill({
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          task_id: `atomic_ct_${Date.now()}`,
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

    injectOctetStream = true;
    await page.getByTestId("pose-regenerate-feedback").fill("atomic: content-type");
    await page.getByTestId("pose-regenerate-start").click();

    await expect.poll(() => capturedBody).not.toBeNull();
    const normalized = (capturedBody as Buffer).toString("latin1").replace(/\r\n/g, "\n");
    expect(normalized).toContain('name="schema_file"');
    expect(normalized).toContain("Content-Type: image/png");
  });
});

