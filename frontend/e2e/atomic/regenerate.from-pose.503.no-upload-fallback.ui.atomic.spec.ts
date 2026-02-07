import { test, expect } from "@playwright/test";
import { assertNo5xx, uiLoginWithToken } from "./atomic-helpers";
import { authedFetch, loginWithToken, makeIsolatedToken, safeJson } from "./atomic-http";

const tinyPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=",
  "base64",
);

test.describe("Atomic regenerate: from-pose 503 should NOT fall back to upload /generate", () => {
  test.describe.configure({ mode: "serial" });

  test("does not call /generate when /generate/from-pose returns 503", async ({ browser }) => {
    test.setTimeout(120_000);

    const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3000";
    const context = await browser.newContext({
      baseURL,
      storageState: { cookies: [], origins: [] },
    });
    const page = await context.newPage();

    const token = makeIsolatedToken(`regen-503-no-fallback-${Date.now()}`);
    const { accessToken } = await loginWithToken(token);
    expect(accessToken).toBeTruthy();
    await uiLoginWithToken(page, token);

    const code = `R503_${Date.now().toString(36).slice(-10)}`.slice(0, 20);
    const createRes = await authedFetch(accessToken, "/api/v1/poses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, name: `Atomic Regen 503 NoFallback ${code}` }),
    });
    assertNo5xx(createRes.status, "create pose (regen 503 no-fallback suite)");
    expect(createRes.status).toBe(201);
    const poseId = ((await safeJson(createRes)) as { id?: number } | undefined)?.id as number;
    expect(typeof poseId).toBe("number");

    // Keep categories lightweight (PoseDetail loads them on mount).
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

    // Deterministic bytes for any /storage image loads.
    await page.route("**/storage/**", async (route) => {
      await route.fulfill({ status: 200, headers: { "content-type": "image/png" }, body: tinyPng });
    });

    // Ensure RegenerateModal uses /generate/from-pose path (schema_path present).
    await page.route(`**/api/v1/poses/${poseId as number}`, async (route) => {
      if (route.request().method() !== "GET") {
        await route.continue();
        return;
      }
      const real = await authedFetch(accessToken, `/api/v1/poses/${poseId as number}`, { method: "GET" });
      assertNo5xx(real.status, "get pose (regen 503 no-fallback suite)");
      const json = (await safeJson(real)) as any;
      json.photo_path = "/storage/generated/atomic_old.png";
      json.schema_path = "/storage/uploads/schemas/atomic_schema.png";
      json.muscle_layer_path = null;
      json.skeleton_layer_path = null;
      json.muscles = Array.isArray(json.muscles) ? json.muscles : [];
      json.version = 1;
      await route.fulfill({
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(json),
      });
    });

    let fromPoseCalls = 0;
    await page.route(`**/api/v1/generate/from-pose/${poseId as number}`, async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      fromPoseCalls += 1;
      await route.fulfill({
        status: 503,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ detail: "Atomic: service unavailable" }),
      });
    });

    let generateCalls = 0;
    await page.route("**/api/v1/generate", async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      generateCalls += 1;
      await route.fulfill({
        status: 500,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ detail: "Atomic: should not be called" }),
      });
    });

    try {
      await page.goto(`/poses/${poseId as number}`);
      await page.getByTestId("pose-regenerate").click();
      const start = page.getByTestId("pose-regenerate-start");
      await expect(start).toBeVisible();

      await page.getByTestId("pose-regenerate-feedback").fill("atomic: do not fallback on 503");
      await start.click();

      // It should show error and keep modal open (so user can retry later).
      await expect(page.getByRole("dialog")).toHaveCount(1);
      await expect.poll(() => fromPoseCalls, { timeout: 10_000 }).toBe(1);
      await expect.poll(() => generateCalls, { timeout: 3_000 }).toBe(0);

      // Start should be re-enabled after failure (not stuck in isStarting).
      await expect(start).toBeEnabled();
    } finally {
      await authedFetch(accessToken, `/api/v1/poses/${poseId as number}`, { method: "DELETE" }).catch(
        () => undefined,
      );
      await context.close().catch(() => undefined);
    }
  });
});

