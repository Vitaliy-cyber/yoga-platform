import { test, expect } from "@playwright/test";
import { assertNo5xx, uiLoginWithToken } from "./atomic-helpers";
import { authedFetch, loginWithToken, makeIsolatedToken, safeJson } from "./atomic-http";

test.describe("Atomic version restore: retries transient 429 (UI)", () => {
  test.describe.configure({ mode: "serial" });

  test("restore succeeds even if the first restore attempt is rate-limited (429)", async ({ browser }) => {
    test.setTimeout(120_000);

    const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3000";
    const context = await browser.newContext({
      baseURL,
      storageState: { cookies: [], origins: [] },
    });
    const page = await context.newPage();

    const token = makeIsolatedToken(`restore-429-${Date.now()}`);
    const { accessToken } = await loginWithToken(token);
    expect(accessToken).toBeTruthy();
    await uiLoginWithToken(page, token);

    const code = `VR429_${Date.now().toString(36).slice(-10)}`.slice(0, 20);
    const createRes = await authedFetch(accessToken, "/api/v1/poses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, name: `Atomic Version Restore 429 ${code}` }),
    });
    assertNo5xx(createRes.status, "create pose (version restore 429 suite)");
    expect(createRes.status).toBe(201);
    const poseId = ((await safeJson(createRes)) as { id?: number } | undefined)?.id as number;
    expect(typeof poseId).toBe("number");

    const versionIdCurrent = 2000 + Math.floor(Math.random() * 1000);
    const versionIdOld = versionIdCurrent - 1;
    const now = new Date();
    const listPayload = {
      items: [
        {
          id: versionIdCurrent,
          version_number: 2,
          created_at: now.toISOString(),
          changed_by_name: "Atomic",
          change_note: "current",
        },
        {
          id: versionIdOld,
          version_number: 1,
          created_at: new Date(now.getTime() - 60_000).toISOString(),
          changed_by_name: "Atomic",
          change_note: "old",
        },
      ],
    };

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

    // Serve a stable versions list (2 items so restore button exists for index>0).
    await page.route(`**/api/v1/poses/${poseId as number}/versions**`, async (route) => {
      if (route.request().method() !== "GET") {
        await route.continue();
        return;
      }
      // Avoid catching restore/diff/detail endpoints (they include extra path segments after /versions).
      const url = route.request().url();
      const parsed = new URL(url);
      const isList = parsed.pathname === `/api/v1/poses/${poseId as number}/versions`;
      if (!isList) {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(listPayload),
      });
    });

    // Restore endpoint: first call 429 (rate limited), second call succeeds.
    let restoreCalls = 0;
    await page.route(
      `**/api/v1/poses/${poseId as number}/versions/${versionIdOld}/restore`,
      async (route) => {
        if (route.request().method() !== "POST") {
          await route.continue();
          return;
        }
        restoreCalls += 1;
        if (restoreCalls === 1) {
          await route.fulfill({
            status: 429,
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ detail: "rate limited", retry_after: 1 }),
          });
          return;
        }
        await route.fulfill({
          status: 200,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ success: true, message: "ok", pose_id: poseId }),
        });
      },
    );

    try {
      await page.goto(`/poses/${poseId as number}`);

      // Wait until version list is loaded.
      await expect(page.getByTestId("pose-version-history")).toBeVisible();
      await expect(page.getByTestId("pose-version-count")).toHaveText("2");

      // Click restore on the non-current version (index>0). Button is icon-only, select by title in both locales.
      const restoreButton = page
        .getByTestId("pose-version-history")
        .locator('button[title="Restore"], button[title="Відновити"]')
        .first();
      await restoreButton.click();

      // Confirm restore in the modal.
      const confirm = page.getByRole("button", {
        name: /Restore Version|Відновити версію/,
      });
      await expect(confirm).toBeVisible();
      await confirm.click();

      // Should transparently retry and close after the 2nd call succeeds.
      await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 20_000 });
      await expect.poll(() => restoreCalls, { timeout: 20_000 }).toBe(2);
    } finally {
      await authedFetch(accessToken, `/api/v1/poses/${poseId as number}`, { method: "DELETE" }).catch(
        () => undefined,
      );
      await context.close().catch(() => undefined);
    }
  });
});
