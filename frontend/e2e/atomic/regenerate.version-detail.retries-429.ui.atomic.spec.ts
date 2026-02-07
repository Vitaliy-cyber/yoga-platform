import { test, expect } from "@playwright/test";
import { assertNo5xx, uiLoginWithToken } from "./atomic-helpers";
import { authedFetch, loginWithToken, makeIsolatedToken, safeJson } from "./atomic-http";

test.describe("Atomic version detail: retries transient 429 (UI)", () => {
  test.describe.configure({ mode: "serial" });

  test("view details succeeds even if the first fetch is rate-limited (429)", async ({ browser }) => {
    test.setTimeout(120_000);

    const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3000";
    const context = await browser.newContext({
      baseURL,
      storageState: { cookies: [], origins: [] },
    });
    const page = await context.newPage();

    const token = makeIsolatedToken(`vdetail-429-${Date.now()}`);
    const { accessToken } = await loginWithToken(token);
    expect(accessToken).toBeTruthy();
    await uiLoginWithToken(page, token);

    const code = `VD429_${Date.now().toString(36).slice(-10)}`.slice(0, 20);
    const createRes = await authedFetch(accessToken, "/api/v1/poses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, name: `Atomic Version Detail 429 ${code}` }),
    });
    assertNo5xx(createRes.status, "create pose (version detail 429 suite)");
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

    const versionId = 3000 + Math.floor(Math.random() * 1000);
    const now = new Date();
    const listPayload = {
      items: [
        {
          id: versionId,
          version_number: 1,
          created_at: now.toISOString(),
          changed_by_name: "Atomic",
          change_note: "vdetail",
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

    // Version detail: first call 429, second call returns content.
    let detailCalls = 0;
    await page.route(
      `**/api/v1/poses/${poseId as number}/versions/${versionId}`,
      async (route) => {
        if (route.request().method() !== "GET") {
          await route.continue();
          return;
        }
        detailCalls += 1;
        if (detailCalls === 1) {
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
            id: versionId,
            version_number: 1,
            created_at: now.toISOString(),
            changed_by_name: "Atomic",
            change_note: "vdetail",
            name: "Atomic Version Name",
            name_en: null,
            code: "ATOMIC",
            category_id: null,
            description: null,
            effect: null,
            breathing: null,
            schema_path: null,
            photo_path: null,
            muscle_layer_path: null,
            skeleton_layer_path: null,
            muscles: [],
          }),
        });
      },
    );

    try {
      await page.goto(`/poses/${poseId as number}`);

      await expect(page.getByTestId("pose-version-history")).toBeVisible();
      await expect(page.getByTestId("pose-version-count")).toHaveText("1");

      const viewButton = page
        .getByTestId("pose-version-history")
        .locator('button[title="View details"], button[title="Переглянути деталі"]')
        .first();
      await viewButton.click();

      // Should transparently retry and render version content without manual Retry.
      await expect(page.getByRole("dialog")).toHaveCount(1);
      await expect(page.getByText("Atomic Version Name")).toBeVisible({ timeout: 20_000 });
      await expect.poll(() => detailCalls, { timeout: 20_000 }).toBe(2);
    } finally {
      await authedFetch(accessToken, `/api/v1/poses/${poseId as number}`, { method: "DELETE" }).catch(
        () => undefined,
      );
      await context.close().catch(() => undefined);
    }
  });
});

