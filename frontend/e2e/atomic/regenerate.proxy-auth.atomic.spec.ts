import { test, expect } from "@playwright/test";
import { TEST_TOKEN } from "../fixtures";
import { assertNo5xx } from "./atomic-helpers";
import { authedFetch, loginWithToken, safeJson } from "./atomic-http";

const tinyPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=",
  "base64",
);

test.describe("Atomic regenerate upload fallback: proxy auth header", () => {
  test.describe.configure({ mode: "serial" });

  test("adds Authorization when falling back to /api/v1/poses/:id/image/:type proxy URL", async ({
    page,
  }) => {
    test.setTimeout(90_000);

    const { accessToken } = await loginWithToken(TEST_TOKEN);
    expect(accessToken).toBeTruthy();

    // Create isolated pose. We'll override its paths in the UI response to force:
    // - signed-url failure,
    // - proxy fallback (/api/v1/poses/:id/image/photo),
    // - authenticated fetch() with Authorization header.
    const code = `PXAU_${Date.now().toString(36).slice(-10)}`.slice(0, 20);
    const createRes = await authedFetch(accessToken, "/api/v1/poses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, name: `Atomic Proxy Auth ${code}` }),
    });
    assertNo5xx(createRes.status, "create pose");
    expect(createRes.status).toBe(201);
    const poseId = ((await safeJson(createRes)) as { id?: number } | undefined)?.id as number;
    expect(typeof poseId).toBe("number");

    try {
      const patchedPhotoPath = "uploads/atomic_proxy_auth.png";

      // Keep the pose fetch real, but override the payload so the UI thinks:
      // - photo_path is a non-URL, non-/storage path (forces signed-url flow),
      // - schema_path is null (forces client upload fallback regeneration path).
      await page.route(`**/api/v1/poses/${poseId as number}`, async (route) => {
        if (route.request().method() !== "GET") {
          await route.continue();
          return;
        }
        const real = await authedFetch(accessToken, `/api/v1/poses/${poseId as number}`, { method: "GET" });
        assertNo5xx(real.status, "get pose (proxy auth suite)");
        const json = (await safeJson(real)) as any;
        json.photo_path = patchedPhotoPath;
        json.schema_path = null;
        json.muscle_layer_path = null;
        json.skeleton_layer_path = null;
        json.muscles = Array.isArray(json.muscles) ? json.muscles : [];
        await route.fulfill({
          status: 200,
          headers: { "content-type": "application/json" },
          body: JSON.stringify(json),
        });
      });

      // Force signed-url failure so getSignedImageUrl returns proxy URL.
      await page.route(`**/api/v1/poses/${poseId}/image/photo/signed-url`, async (route) => {
        await route.fulfill({
          status: 500,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ detail: "Atomic: signed-url down" }),
        });
      });

      let sawAuthHeader = false;
      await page.route(`**/api/v1/poses/${poseId}/image/photo`, async (route) => {
        const headers = route.request().headers();
        const auth = headers["authorization"] || headers["Authorization"];
        sawAuthHeader = typeof auth === "string" && auth.toLowerCase().startsWith("bearer ");
        await route.fulfill({
          status: 200,
          headers: { "content-type": "image/png" },
          body: tinyPng,
        });
      });

      // We don't need the rest of the pipeline; fail fast after proving the proxy fetch is authenticated.
      await page.route("**/api/v1/generate", async (route) => {
        await route.fulfill({
          status: 400,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ detail: "Atomic: stop after proxy auth check" }),
        });
      });

      await page.goto(`/poses/${poseId}`);
      await page.getByTestId("pose-regenerate").click();
      await expect(page.getByTestId("pose-regenerate-start")).toBeVisible();
      await page.getByTestId("pose-regenerate-feedback").fill("atomic: proxy auth");
      await page.getByTestId("pose-regenerate-start").click();

      await expect.poll(() => sawAuthHeader).toBeTruthy();
      await expect(page.getByTestId("pose-regenerate-start")).toBeEnabled();
    } finally {
      await authedFetch(accessToken, `/api/v1/poses/${poseId}`, { method: "DELETE" }).catch(() => undefined);
    }
  });
});
