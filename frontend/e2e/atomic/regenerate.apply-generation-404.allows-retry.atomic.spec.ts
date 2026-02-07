import { test, expect } from "@playwright/test";
import { TEST_TOKEN } from "../fixtures";
import { assertNo5xx } from "./atomic-helpers";
import { authedFetch, loginWithToken, safeJson } from "./atomic-http";

const tinyPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=",
  "base64",
);

test.describe("Atomic regenerate: apply-generation 404 allows retry", () => {
  test.describe.configure({ mode: "serial" });

  test("when apply-generation returns 404 after completion, modal surfaces error and re-enables Start", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    const { accessToken } = await loginWithToken(TEST_TOKEN);
    expect(accessToken).toBeTruthy();

    const code = `AG404_${Date.now().toString(36).slice(-10)}`.slice(0, 20);
    const createRes = await authedFetch(accessToken, "/api/v1/poses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, name: `Atomic Apply 404 ${code}` }),
    });
    assertNo5xx(createRes.status, "create pose (apply 404 suite)");
    expect(createRes.status).toBe(201);
    const poseId = ((await safeJson(createRes)) as { id?: number } | undefined)?.id as number;
    expect(typeof poseId).toBe("number");

    const photoUrl = `https://atomic.invalid/ag404-photo-${Date.now()}.png`;
    const schemaUrl = `https://atomic.invalid/ag404-schema-${Date.now()}.png`;

    await page.route(photoUrl, async (route) => {
      await route.fulfill({ status: 200, headers: { "content-type": "image/png" }, body: tinyPng });
    });
    await page.route(schemaUrl, async (route) => {
      await route.fulfill({ status: 200, headers: { "content-type": "image/png" }, body: tinyPng });
    });

    let poseVersion = 1;
    await page.route(`**/api/v1/poses/${poseId as number}`, async (route) => {
      if (route.request().method() !== "GET") {
        await route.continue();
        return;
      }
      const real = await authedFetch(accessToken, `/api/v1/poses/${poseId as number}`, { method: "GET" });
      assertNo5xx(real.status, "get pose (apply 404 suite)");
      const json = (await safeJson(real)) as any;
      json.photo_path = photoUrl;
      json.schema_path = schemaUrl;
      json.muscle_layer_path = null;
      json.skeleton_layer_path = null;
      json.muscles = Array.isArray(json.muscles) ? json.muscles : [];
      json.version = poseVersion;
      await route.fulfill({
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(json),
      });
    });

    // Force signed-url endpoints to fail so the UI falls back to direct https:// URLs.
    await page.route(`**/api/v1/poses/${poseId as number}/image/**/signed-url`, async (route) => {
      await route.fulfill({
        status: 500,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ detail: "Atomic: signed-url down (apply 404 suite)" }),
      });
    });

    // Force polling path.
    await page.routeWebSocket("**/ws/generate/**", async (ws) => {
      await ws.close({ code: 1001, reason: "Atomic: ws blocked" });
    });

    const taskIds = [`atomic_ag404_${Date.now()}_1`, `atomic_ag404_${Date.now()}_2`];
    let startCount = 0;
    await page.route(`**/api/v1/generate/from-pose/${poseId as number}`, async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      const taskId = taskIds[Math.min(startCount, taskIds.length - 1)];
      startCount += 1;
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

    for (const taskId of taskIds) {
      // eslint-disable-next-line no-await-in-loop
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
    }

    await page.route(`**/api/v1/poses/${poseId as number}/apply-generation/**`, async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      const url = route.request().url();
      const taskId = url.split("/").pop() || "";
      if (taskId === taskIds[0]) {
        await route.fulfill({
          status: 404,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ detail: "Atomic: task not found" }),
        });
        return;
      }
      poseVersion += 1;
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
      await page.getByTestId("pose-regenerate-feedback").fill("atomic: apply-generation 404 then retry");

      await page.getByTestId("pose-regenerate-start").click();

      // Should surface apply-generation error and allow a retry.
      await expect(page.getByRole("dialog")).toContainText("Atomic: task not found", {
        timeout: 20_000,
      });
      await expect(page.getByTestId("pose-regenerate-start")).toBeEnabled({ timeout: 20_000 });

      // Second attempt should succeed and close the modal.
      await page.getByTestId("pose-regenerate-start").click();
      await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 20_000 });
    } finally {
      await authedFetch(accessToken, `/api/v1/poses/${poseId as number}`, { method: "DELETE" }).catch(
        () => undefined,
      );
    }
  });
});

