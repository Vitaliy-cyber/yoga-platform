import { test, expect } from "@playwright/test";
import { assertNo5xx, uiLoginWithToken } from "./atomic-helpers";
import { authedFetch, loginWithToken, makeIsolatedToken, safeJson } from "./atomic-http";

test.describe("Atomic VersionHistory: retries on 429 rate limit", () => {
  test.describe.configure({ mode: "serial" });

  test("when /versions returns 429 once, UI still loads version history without showing error state", async ({
    browser,
  }) => {
    test.setTimeout(90_000);

    const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3000";
    const context = await browser.newContext({
      baseURL,
      storageState: { cookies: [], origins: [] },
    });
    const page = await context.newPage();

    const token = makeIsolatedToken(`vh-429-${Date.now()}`);
    const { accessToken } = await loginWithToken(token);
    expect(accessToken).toBeTruthy();
    await uiLoginWithToken(page, token);

    const code = `VH429_${Date.now().toString(36).slice(-10)}`.slice(0, 20);
    const createRes = await authedFetch(accessToken, "/api/v1/poses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, name: `Atomic VH 429 ${code}` }),
    });
    assertNo5xx(createRes.status, "create pose (vh 429 suite)");
    expect(createRes.status).toBe(201);
    const poseId = ((await safeJson(createRes)) as { id?: number } | undefined)?.id as number;
    expect(typeof poseId).toBe("number");

    let calls = 0;
    await page.route(`**/api/v1/poses/${poseId as number}/versions**`, async (route) => {
      if (route.request().method() !== "GET") {
        await route.continue();
        return;
      }
      calls += 1;
      if (calls === 1) {
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
        body: JSON.stringify([]),
      });
    });

    try {
      await page.goto(`/poses/${poseId as number}`);
      await expect(page.getByTestId("pose-version-history")).toBeVisible({ timeout: 30_000 });
      await expect.poll(() => calls).toBeGreaterThanOrEqual(2);
      await expect(page.getByTestId("pose-version-count")).toHaveText("0");
    } finally {
      await authedFetch(accessToken, `/api/v1/poses/${poseId as number}`, { method: "DELETE" }).catch(
        () => undefined,
      );
      await context.close().catch(() => undefined);
    }
  });
});

