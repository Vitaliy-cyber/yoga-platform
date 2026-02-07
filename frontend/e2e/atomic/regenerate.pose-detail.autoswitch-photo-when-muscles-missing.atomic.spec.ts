import { test, expect } from "@playwright/test";
import { assertNo5xx, uiLoginWithToken } from "./atomic-helpers";
import { authedFetch, loginWithToken, makeIsolatedToken, safeJson } from "./atomic-http";

const tinyPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=",
  "base64",
);

test.describe("Atomic regenerate: PoseDetail auto-switches to photo when muscles disappear", () => {
  test.describe.configure({ mode: "serial" });

  test("after regeneration updates pose without muscle_layer_path, activeTab falls back to photo", async ({ browser }) => {
    test.setTimeout(120_000);

    const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3000";
    const context = await browser.newContext({
      baseURL,
      storageState: { cookies: [], origins: [] },
    });
    const page = await context.newPage();

    const token = makeIsolatedToken(`regen-autoswitch-${Date.now()}`);
    const { accessToken } = await loginWithToken(token);
    expect(accessToken).toBeTruthy();
    await uiLoginWithToken(page, token);

    // Create a pose record (so Delete cleanup is deterministic).
    const code = `RAT_${Date.now().toString(36).slice(-10)}`.slice(0, 20);
    const createRes = await authedFetch(accessToken, "/api/v1/poses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, name: `Atomic Regen AutoSwitch ${code}` }),
    });
    assertNo5xx(createRes.status, "create pose (autoswitch suite)");
    expect(createRes.status).toBe(201);
    const poseId = ((await safeJson(createRes)) as { id?: number } | undefined)?.id as number;
    expect(typeof poseId).toBe("number");

    // Keep categories + versions lightweight.
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
    await page.route(`**/api/v1/poses/${poseId as number}/versions**`, async (route) => {
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

    // Deterministic bytes for any /storage image loads.
    await page.route("**/storage/**", async (route) => {
      await route.fulfill({ status: 200, headers: { "content-type": "image/png" }, body: tinyPng });
    });

    // Block WS so we use polling path.
    await page.routeWebSocket("**/ws/generate/**", async (ws) => {
      await ws.close({ code: 1001, reason: "Atomic: WS blocked" });
    });

    const oldPhoto = "/storage/generated/atomic_old_photo.png";
    const oldMuscles = "/storage/generated/atomic_old_muscles.png";
    const newPhoto = "/storage/generated/atomic_new_photo.png";

    // Serve PoseDetail with muscles enabled initially.
    await page.route(`**/api/v1/poses/${poseId as number}`, async (route) => {
      if (route.request().method() !== "GET") {
        await route.continue();
        return;
      }
      const real = await authedFetch(accessToken, `/api/v1/poses/${poseId as number}`, { method: "GET" });
      assertNo5xx(real.status, "get pose (autoswitch suite)");
      const json = (await safeJson(real)) as any;
      json.photo_path = oldPhoto;
      json.schema_path = "/storage/uploads/schemas/atomic_schema.png";
      json.muscle_layer_path = oldMuscles;
      json.skeleton_layer_path = null;
      json.muscles = Array.isArray(json.muscles) ? json.muscles : [];
      json.version = 2;
      await route.fulfill({
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(json),
      });
    });

    const taskId = `atomic_autoswitch_${Date.now()}`;
    await page.route(`**/api/v1/generate/from-pose/${poseId as number}`, async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
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
          photo_url: newPhoto,
          muscles_url: "/storage/generated/atomic_new_muscles.png",
          quota_warning: false,
          analyzed_muscles: null,
        }),
      });
    });

    // Apply-generation returns a pose *without* muscle_layer_path (simulates restore/regenerate removing it).
    await page.route(`**/api/v1/poses/${poseId as number}/apply-generation/${taskId}`, async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: poseId,
          code,
          name: `Atomic Regen AutoSwitch ${code}`,
          name_en: null,
          description: null,
          category_id: null,
          photo_path: newPhoto,
          schema_path: "/storage/uploads/schemas/atomic_schema.png",
          muscle_layer_path: null,
          skeleton_layer_path: null,
          muscles: [],
          version: 3,
        }),
      });
    });

    try {
      await page.goto(`/poses/${poseId as number}`);

      // Move to Muscles tab (enabled initially).
      await expect(page.getByTestId("pose-tab-muscles")).toBeEnabled();
      await page.getByTestId("pose-tab-muscles").click();

      // Start regeneration from muscles view.
      await page.getByTestId("pose-regenerate").click();
      await expect(page.getByTestId("pose-regenerate-start")).toBeVisible();
      await page.getByTestId("pose-regenerate-feedback").fill("Atomic: remove muscle layer after apply-generation");
      await page.getByTestId("pose-regenerate-start").click();

      // Modal should close after apply-generation.
      await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 30_000 });

      // Muscles tab is now disabled, so the UI must fall back to photo.
      await expect(page.getByTestId("pose-tab-muscles")).toBeDisabled();
      await expect(page.getByTestId("pose-tab-photo")).toHaveAttribute("data-state", "active");
      await expect(page.getByTestId("pose-active-image")).toHaveAttribute("src", new RegExp(`${newPhoto}$`));
    } finally {
      await authedFetch(accessToken, `/api/v1/poses/${poseId as number}`, { method: "DELETE" }).catch(
        () => undefined,
      );
      await context.close().catch(() => undefined);
    }
  });
});

