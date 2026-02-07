import { test, expect } from "@playwright/test";
import { assertNo5xx, uiLoginWithToken } from "./atomic-helpers";
import { authedFetch, loginWithToken, makeIsolatedToken, safeJson } from "./atomic-http";

test.describe("Atomic regeneration updates Version History (UI)", () => {
  test.describe.configure({ mode: "serial" });

  test("regenerate increments version list on pose detail", async ({ browser }) => {
    test.setTimeout(120_000);

    const getLatestVersionNumber = async (): Promise<number | null> => {
      const history = page.getByTestId("pose-version-history");
      await expect(history).toBeVisible();

      const latest = history.locator('span.font-medium').first();
      const hasAny = (await latest.count()) > 0;
      if (!hasAny) return null;
      if (!(await latest.isVisible().catch(() => false))) {
        // If it is collapsed, best-effort expand.
        const btn = history.locator("button").first();
        if ((await btn.count()) > 0) await btn.click().catch(() => undefined);
      }
      if (!(await latest.isVisible().catch(() => false))) return null;
      const text = (await latest.innerText()).trim();
      const match = /^v(\d+)$/.exec(text);
      return match ? Number.parseInt(match[1], 10) : null;
    };

    const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3000";
    // Explicitly override any project-level storageState so this test is isolated
    // from the shared "User #1" auth state used by other suites.
    const context = await browser.newContext({
      baseURL,
      storageState: { cookies: [], origins: [] },
    });
    const page = await context.newPage();

    const token = makeIsolatedToken("ui-version-history");
    const { accessToken } = await loginWithToken(token);

    // UI login for the same user (no shared storageState to avoid cross-suite token revocations).
    await uiLoginWithToken(page, token);

    // Create an isolated pose + schema so regeneration is deterministic and not
    // contending with persistent core seed poses across runs.
    const code = `UVH_${Date.now().toString(36).slice(-10)}`.slice(0, 20);
    const createRes = await authedFetch(accessToken, "/api/v1/poses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, name: `Atomic UI Version History ${code}` }),
    });
    assertNo5xx(createRes.status, "create pose for UI version history");
    expect(createRes.status).toBe(201);
    const poseId = ((await safeJson(createRes)) as { id?: number } | undefined)?.id;
    expect(typeof poseId).toBe("number");

    // Mock pose paths + version history list so we can validate UI refresh logic
    // without running expensive real generation tasks (prevents backend/webserver OOM in bulk atomic runs).
    const photoUrl = `https://atomic.invalid/ui-vh-photo-${Date.now()}.png`;
    const schemaUrl = `https://atomic.invalid/ui-vh-schema-${Date.now()}.png`;
    const tinyPng = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=",
      "base64",
    );
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
      assertNo5xx(real.status, "get pose (ui version history)");
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
        body: JSON.stringify({ detail: "Atomic: signed-url down (ui version history)" }),
      });
    });

    const now = Date.now();
    const mkVersion = (n: number) => ({
      id: 1000 + n,
      version_number: n,
      created_at: new Date(now + n * 1000).toISOString(),
      changed_by_name: "Atomic",
      change_note: `Atomic Notes: v${n}`,
    });
    let versions = [mkVersion(1)];
    await page.route(`**/api/v1/poses/${poseId as number}/versions**`, async (route) => {
      if (route.request().method() !== "GET") {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(versions),
      });
    });

    // Mock regeneration pipeline.
    const taskId = `atomic_ui_vh_${Date.now()}`;
    await page.route(`**/api/v1/generate/from-pose/${poseId as number}`, async (route) => {
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
    await page.routeWebSocket("**/ws/generate/**", async (ws) => {
      await ws.close({ code: 1001, reason: "Atomic: ws blocked" });
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
          photo_url: "/storage/generated/atomic_photo.png",
          muscles_url: "/storage/generated/atomic_muscles.png",
          quota_warning: false,
          analyzed_muscles: null,
        }),
      });
    });
    await page.route(`**/api/v1/poses/${poseId as number}/apply-generation/${taskId}`, async (route) => {
      poseVersion += 1;
      versions = [mkVersion(poseVersion), ...versions];
      await route.fulfill({
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: poseId }),
      });
    });

    try {
      await page.goto(`/poses/${poseId as number}`);

      const countEl = page.getByTestId("pose-version-count");
      const before = Number.parseInt((await countEl.innerText()).trim(), 10) || 0;
      const beforeLatestNumber = await getLatestVersionNumber();

      await page.getByTestId("pose-regenerate").click();
      await expect(page.getByTestId("pose-regenerate-start")).toBeVisible();

      await page.getByTestId("pose-regenerate-feedback").fill(
        `atomic: version history ui ${Date.now()}`,
      );
      await page.getByTestId("pose-regenerate-start").click();

      // Wait for regeneration to finish and VersionHistory badge to increase.
      await expect.poll(async () => {
        return Number.parseInt((await countEl.innerText()).trim(), 10) || 0;
      }, { timeout: 80_000 }).toBeGreaterThanOrEqual(before + 1);

      // Latest version label should update too.
      await expect
        .poll(getLatestVersionNumber, { timeout: 80_000 })
        .not.toBe(beforeLatestNumber);
    } finally {
      await authedFetch(accessToken, `/api/v1/poses/${poseId as number}`, { method: "DELETE" }).catch(
        () => undefined,
      );
      await context.close().catch(() => undefined);
    }
  });
});
