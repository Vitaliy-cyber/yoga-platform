import { test, expect } from "@playwright/test";
import { assertNo5xx, gotoWithRetry, uiLoginWithToken } from "./atomic-helpers";
import { authedFetch, loginWithToken, makeIsolatedToken, safeJson } from "./atomic-http";

const tinyPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=",
  "base64",
);

test.describe("Atomic generate: broken schema preview must not block generation", () => {
  test.describe.configure({ mode: "serial" });

  test("keeps Start enabled even if existing schema <img> fails to load", async ({ browser }) => {
    test.setTimeout(120_000);

    const token = makeIsolatedToken(`gen-schema-preview-${Date.now()}`);
    const { accessToken } = await loginWithToken(token);
    expect(accessToken).toBeTruthy();

    // Create isolated pose with a schema so the modal has an existing schematic.
    const code = `GEN_${Date.now().toString(36).slice(-10)}`.slice(0, 20);
    const createRes = await authedFetch(accessToken, "/api/v1/poses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, name: `Atomic Generate ${code}` }),
    });
    assertNo5xx(createRes.status, "create pose (schema preview suite)");
    expect(createRes.status).toBe(201);
    const poseId = ((await safeJson(createRes)) as { id?: number } | undefined)?.id as number;
    expect(typeof poseId).toBe("number");

    // Upload schema so pose.schema_path is set.
    const apiBase = process.env.PLAYWRIGHT_API_URL || "http://127.0.0.1:8000";
    const form = new FormData();
    form.append("file", new Blob([tinyPng], { type: "image/png" }), "schema.png");
    const schemaRes = await fetch(`${apiBase}/api/v1/poses/${poseId}/schema`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
      body: form,
    });
    assertNo5xx(schemaRes.status, "upload schema (schema preview suite)");
    expect(schemaRes.status).toBe(200);

    const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3000";
    const context = await browser.newContext({
      baseURL,
      storageState: { cookies: [], origins: [] },
    });
    const page = await context.newPage();

    // Simulate a broken/blocked schema preview (e.g., proxy/static issue) while the server-side schema still exists.
    let sawSchemaImgRequest = false;
    await page.route("**/storage/uploads/schemas/**", async (route) => {
      if (route.request().resourceType() !== "image") {
        await route.continue();
        return;
      }
      sawSchemaImgRequest = true;
      await route.fulfill({ status: 404, body: "Atomic: break schema preview" });
    });

    // UI login for this isolated user (with retry for transient dev-server restarts).
    await uiLoginWithToken(page, token);

    try {
      await gotoWithRetry(page, `/poses/${poseId}`);

      await expect(page.getByTestId("pose-generate")).toBeVisible();
      await page.getByTestId("pose-generate").click();

      await expect(page.getByTestId("pose-generate-start")).toBeVisible();
      await expect.poll(() => sawSchemaImgRequest, { timeout: 20_000 }).toBeTruthy();

      // Even if the preview fails, the pose still has a schema in storage and generation-from-pose should be allowed.
      await expect(page.getByTestId("pose-generate-start")).toBeEnabled();
    } finally {
      await authedFetch(accessToken, `/api/v1/poses/${poseId}`, { method: "DELETE" }).catch(
        () => undefined,
      );
      await context.close().catch(() => undefined);
    }
  });
});
