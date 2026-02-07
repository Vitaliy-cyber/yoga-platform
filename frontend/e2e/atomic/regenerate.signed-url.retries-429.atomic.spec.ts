import { test, expect } from "@playwright/test";
import { assertNo5xx, uiLoginWithToken } from "./atomic-helpers";
import { authedFetch, loginWithToken, makeIsolatedToken, safeJson } from "./atomic-http";

const tinyPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=",
  "base64",
);

test.describe("Atomic regenerate: signed-url retries on 429", () => {
  test.describe.configure({ mode: "serial" });

  test("PoseDetail image loads when signed-url is transiently rate-limited", async ({ browser }) => {
    test.setTimeout(120_000);

    const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3000";
    const context = await browser.newContext({
      baseURL,
      storageState: { cookies: [], origins: [] },
    });
    const page = await context.newPage();

    const token = makeIsolatedToken(`signed-url-429-${Date.now()}`);
    const { accessToken } = await loginWithToken(token);
    expect(accessToken).toBeTruthy();
    await uiLoginWithToken(page, token);

    const code = `SU429_${Date.now().toString(36).slice(-10)}`.slice(0, 20);
    const createRes = await authedFetch(accessToken, "/api/v1/poses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, name: `Atomic SignedUrl 429 ${code}` }),
    });
    assertNo5xx(createRes.status, "create pose (signed-url 429 suite)");
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

    // Force the pose to reference a non-/storage, non-http path so the UI must use signed-url.
    await page.route(`**/api/v1/poses/${poseId as number}`, async (route) => {
      if (route.request().method() !== "GET") {
        await route.continue();
        return;
      }
      const real = await authedFetch(accessToken, `/api/v1/poses/${poseId as number}`, { method: "GET" });
      assertNo5xx(real.status, "get pose (signed-url 429 suite)");
      const json = (await safeJson(real)) as any;
      json.photo_path = "private/photos/atomic.png";
      json.schema_path = null;
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

    const signedUrl = `https://atomic.invalid/signed-photo-${Date.now()}.png`;
    await page.route(signedUrl, async (route) => {
      await route.fulfill({ status: 200, headers: { "content-type": "image/png" }, body: tinyPng });
    });

    let signedUrlCalls = 0;
    await page.route(`**/api/v1/poses/${poseId as number}/image/photo/signed-url`, async (route) => {
      if (route.request().method() !== "GET") {
        await route.continue();
        return;
      }
      signedUrlCalls += 1;
      if (signedUrlCalls === 1) {
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
        body: JSON.stringify({ signed_url: signedUrl }),
      });
    });

    try {
      await page.goto(`/poses/${poseId as number}`);

      const img = page.getByTestId("pose-active-image");
      await expect(img).toBeVisible();

      // Should retry signed-url and eventually show it as src.
      await expect.poll(async () => await img.getAttribute("src"), { timeout: 20_000 }).toBe(signedUrl);
      await expect.poll(() => signedUrlCalls, { timeout: 20_000 }).toBe(2);
    } finally {
      await authedFetch(accessToken, `/api/v1/poses/${poseId as number}`, { method: "DELETE" }).catch(
        () => undefined,
      );
      await context.close().catch(() => undefined);
    }
  });
});

