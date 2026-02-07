import { test, expect } from "@playwright/test";
import { assertNo5xx, uiLoginWithToken } from "./atomic-helpers";
import { authedFetch, loginWithToken, makeIsolatedToken, safeJson } from "./atomic-http";

test.describe("Atomic version diff: retries transient 429 (UI)", () => {
  test.describe.configure({ mode: "serial" });

  test("compare succeeds even if the first diff fetch is rate-limited (429)", async ({ browser }) => {
    test.setTimeout(120_000);

    const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3000";
    const context = await browser.newContext({
      baseURL,
      storageState: { cookies: [], origins: [] },
    });
    const page = await context.newPage();

    const token = makeIsolatedToken(`vdiff-429-${Date.now()}`);
    const { accessToken } = await loginWithToken(token);
    expect(accessToken).toBeTruthy();
    await uiLoginWithToken(page, token);

    const code = `VDF429_${Date.now().toString(36).slice(-10)}`.slice(0, 20);
    const createRes = await authedFetch(accessToken, "/api/v1/poses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, name: `Atomic Version Diff 429 ${code}` }),
    });
    assertNo5xx(createRes.status, "create pose (version diff 429 suite)");
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

    const versionIdOld = 4000 + Math.floor(Math.random() * 1000);
    const versionIdNew = versionIdOld + 1;
    const now = new Date();
    const listPayload = {
      items: [
        {
          id: versionIdNew,
          version_number: 2,
          created_at: now.toISOString(),
          changed_by_name: "Atomic",
          change_note: "new",
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

    // Version list.
    await page.route(`**/api/v1/poses/${poseId as number}/versions**`, async (route) => {
      if (route.request().method() !== "GET") {
        await route.continue();
        return;
      }
      const parsed = new URL(route.request().url());
      if (parsed.pathname !== `/api/v1/poses/${poseId as number}/versions`) {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(listPayload),
      });
    });

    // Diff endpoint: first call 429, second returns comparison.
    let diffCalls = 0;
    await page.route(
      `**/api/v1/poses/${poseId as number}/versions/${versionIdOld}/diff/${versionIdNew}`,
      async (route) => {
        if (route.request().method() !== "GET") {
          await route.continue();
          return;
        }
        diffCalls += 1;
        if (diffCalls === 1) {
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
          body: JSON.stringify({
            version_1: {
              id: versionIdOld,
              version_number: 1,
              change_note: "old",
              changed_by_name: "Atomic",
              created_at: new Date(now.getTime() - 60_000).toISOString(),
            },
            version_2: {
              id: versionIdNew,
              version_number: 2,
              change_note: "new",
              changed_by_name: "Atomic",
              created_at: now.toISOString(),
            },
            differences: [
              { field: "name", old_value: "A", new_value: "B" },
            ],
          }),
        });
      },
    );

    try {
      await page.goto(`/poses/${poseId as number}`);

      await expect(page.getByTestId("pose-version-history")).toBeVisible();
      await expect(page.getByTestId("pose-version-count")).toHaveText("2");

      const compareButtons = page
        .getByTestId("pose-version-history")
        .locator('button[title="Select for comparison"], button[title="Вибрати для порівняння"]');
      await expect(compareButtons).toHaveCount(2);
      await compareButtons.nth(0).click();
      await compareButtons.nth(1).click();

      const compare = page.getByRole("button", { name: /Compare|Порівняти/ });
      await expect(compare).toBeEnabled();
      await compare.click();

      // Should transparently retry and show the diff viewer content.
      await expect(page.getByRole("dialog")).toHaveCount(1);
      await expect(page.getByText(/1 changes|1 змін/)).toBeVisible({ timeout: 20_000 });
      // React StrictMode in dev can double-invoke effects; accept extra fetches as long as it retried.
      await expect.poll(() => diffCalls, { timeout: 20_000 }).toBeGreaterThanOrEqual(2);
    } finally {
      await authedFetch(accessToken, `/api/v1/poses/${poseId as number}`, { method: "DELETE" }).catch(
        () => undefined,
      );
      await context.close().catch(() => undefined);
    }
  });
});
