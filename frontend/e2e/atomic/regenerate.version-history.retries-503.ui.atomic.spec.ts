import { test, expect } from "@playwright/test";
import { assertNo5xx, uiLoginWithToken } from "./atomic-helpers";
import { authedFetch, loginWithToken, makeIsolatedToken, safeJson } from "./atomic-http";

const tinyPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=",
  "base64",
);

test.describe("Atomic regenerate: VersionHistory retries transient 503 (UI)", () => {
  test.describe.configure({ mode: "serial" });

  test("PoseDetail loads VersionHistory even if first /versions request is 503", async ({ browser }) => {
    test.setTimeout(120_000);

    const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3000";
    const context = await browser.newContext({
      baseURL,
      storageState: { cookies: [], origins: [] },
    });
    const page = await context.newPage();

    const token = makeIsolatedToken(`verhist-503-${Date.now()}`);
    const { accessToken } = await loginWithToken(token);
    expect(accessToken).toBeTruthy();
    await uiLoginWithToken(page, token);

    const code = `VH503_${Date.now().toString(36).slice(-10)}`.slice(0, 20);
    const createRes = await authedFetch(accessToken, "/api/v1/poses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, name: `Atomic VersionHistory 503 ${code}` }),
    });
    assertNo5xx(createRes.status, "create pose (version-history 503 suite)");
    expect(createRes.status).toBe(201);
    const poseId = ((await safeJson(createRes)) as { id?: number } | undefined)?.id as number;
    expect(typeof poseId).toBe("number");

    // Keep categories lightweight.
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

    await page.route("**/storage/**", async (route) => {
      await route.fulfill({ status: 200, headers: { "content-type": "image/png" }, body: tinyPng });
    });

    // Ensure PoseDetail has a photo_path (avoids draft-only UI branches).
    await page.route(`**/api/v1/poses/${poseId as number}`, async (route) => {
      if (route.request().method() !== "GET") {
        await route.continue();
        return;
      }
      const real = await authedFetch(accessToken, `/api/v1/poses/${poseId as number}`, { method: "GET" });
      assertNo5xx(real.status, "get pose (version-history 503 suite)");
      const json = (await safeJson(real)) as any;
      json.photo_path = "/storage/generated/atomic_photo.png";
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

    let versionsCalls = 0;
    await page.route(`**/api/v1/poses/${poseId as number}/versions**`, async (route) => {
      if (route.request().method() !== "GET") {
        await route.continue();
        return;
      }
      // Only intercept the list endpoint (not /count, /:id, /diff, /restore).
      try {
        const url = new URL(route.request().url());
        const expectedPath = `/api/v1/poses/${poseId as number}/versions`;
        if (url.pathname !== expectedPath) {
          await route.continue();
          return;
        }
      } catch {
        await route.continue();
        return;
      }
      versionsCalls += 1;
      if (versionsCalls === 1) {
        await route.fulfill({
          status: 503,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ detail: "Atomic: service unavailable" }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify([
          {
            id: 101,
            version_number: 1,
            name: "Atomic Version",
            change_note: null,
            changed_by_name: null,
            created_at: new Date().toISOString(),
          },
        ]),
      });
    });

    try {
      await page.goto(`/poses/${poseId as number}`);

      const history = page.getByTestId("pose-version-history");
      const retryBtn = page.getByRole("button", { name: /retry/i });

      // VersionHistory renders different DOM for loading/error/success.
      // Wait for it to settle into either a success state or an error state.
      await Promise.race([
        history.waitFor({ state: "visible", timeout: 30_000 }),
        retryBtn.waitFor({ state: "visible", timeout: 30_000 }),
      ]);

      // Should auto-retry on 503 and render list without requiring manual Retry click.
      await expect.poll(() => versionsCalls, { timeout: 25_000 }).toBe(2);
      await expect(history).toBeVisible({ timeout: 20_000 });
      await expect(page.getByTestId("pose-version-count")).toHaveText("1", { timeout: 20_000 });

      // Error UI should not be shown.
      await expect(retryBtn).toHaveCount(0);
    } finally {
      await authedFetch(accessToken, `/api/v1/poses/${poseId as number}`, { method: "DELETE" }).catch(
        () => undefined,
      );
      await context.close().catch(() => undefined);
    }
  });
});
