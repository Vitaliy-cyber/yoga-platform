import { test, expect } from "@playwright/test";
import { assertNo5xx, gotoWithRetry, uiLoginWithToken } from "./atomic-helpers";
import { authedFetch, loginWithToken, makeIsolatedToken, safeJson } from "./atomic-http";

const tinyPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=",
  "base64",
);

test.describe("Atomic generate: Version History refresh after apply", () => {
  test.describe.configure({ mode: "serial" });

  test("Version History count updates after Generate modal applies results", async ({ browser }) => {
    test.setTimeout(150_000);

    const token = makeIsolatedToken(`gen-ui-versions-${Date.now()}`);
    const { accessToken } = await loginWithToken(token);
    expect(accessToken).toBeTruthy();

    const code = `GEN_${Date.now().toString(36).slice(-10)}`.slice(0, 20);
    const createRes = await authedFetch(accessToken, "/api/v1/poses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, name: `Atomic Generate Versions ${code}` }),
    });
    assertNo5xx(createRes.status, "create pose (generate versions suite)");
    expect(createRes.status).toBe(201);
    const poseId = ((await safeJson(createRes)) as { id?: number } | undefined)?.id as number;
    expect(typeof poseId).toBe("number");

    // Upload schema so Generate-from-pose path is available.
    const apiBase = process.env.PLAYWRIGHT_API_URL || "http://127.0.0.1:8000";
    const form = new FormData();
    form.append("file", new Blob([tinyPng], { type: "image/png" }), "schema.png");
    const schemaRes = await fetch(`${apiBase}/api/v1/poses/${poseId}/schema`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
      body: form,
    });
    assertNo5xx(schemaRes.status, "upload schema (generate versions suite)");
    expect(schemaRes.status).toBe(200);

    const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3000";
    const context = await browser.newContext({
      baseURL,
      storageState: { cookies: [], origins: [] },
    });
    const page = await context.newPage();

    // Mock versions list so we can detect whether the UI refetches after apply-generation.
    let versionsList: any[] = [];
    await page.route(`**/api/v1/poses/${poseId as number}/versions**`, async (route) => {
      if (route.request().method() !== "GET") {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(versionsList),
      });
    });

    const taskId = `atomic_generate_versions_${Date.now()}`;
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

    // Force polling path (fast enough: WS fallback is 2.5s, then first poll runs immediately).
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

    await page.route(
      `**/api/v1/poses/${poseId as number}/apply-generation/${taskId}`,
      async (route) => {
        // After apply-generation, the Version History endpoint should be refetched and show the new version.
        versionsList = [
          {
            id: 12345,
            version_number: 1,
            name: `Atomic v1 ${code}`,
            change_note: "Atomic: applied generation",
            changed_by_name: "Atomic",
            created_at: new Date().toISOString(),
          },
        ];
        await route.fulfill({
          status: 200,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: poseId }),
        });
      },
    );

    // UI login for this isolated user (with retry for transient dev-server restarts).
    await uiLoginWithToken(page, token);

    try {
      await gotoWithRetry(page, `/poses/${poseId as number}`);

      // Initial load: 0 versions.
      await expect(page.getByTestId("pose-version-count")).toHaveText("0");

      await expect(page.getByTestId("pose-generate")).toBeVisible();
      await page.getByTestId("pose-generate").click();
      await expect(page.getByTestId("pose-generate-start")).toBeVisible();
      await page.getByTestId("pose-generate-notes").fill("atomic: update versions");
      await page.getByTestId("pose-generate-start").click();

      // Modal should close after apply-generation succeeds.
      await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 30_000 });

      // Version History should refetch and show 1.
      await expect(page.getByTestId("pose-version-count")).toHaveText("1", { timeout: 30_000 });
    } finally {
      await authedFetch(accessToken, `/api/v1/poses/${poseId as number}`, { method: "DELETE" }).catch(
        () => undefined,
      );
      await context.close().catch(() => undefined);
    }
  });
});
