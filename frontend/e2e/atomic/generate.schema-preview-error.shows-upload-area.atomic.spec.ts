import { test, expect } from "@playwright/test";
import { assertNo5xx } from "./atomic-helpers";
import { authedFetch, loginWithToken, makeIsolatedToken, safeJson } from "./atomic-http";

const tinyPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=",
  "base64",
);

test.describe("Atomic generate: schema preview errors should surface upload UI", () => {
  test.describe.configure({ mode: "serial" });

  test("shows upload area when existing schema preview fails", async ({ browser }) => {
    test.setTimeout(120_000);

    const token = makeIsolatedToken(`gen-schema-upload-ui-${Date.now()}`);
    const { accessToken } = await loginWithToken(token);
    expect(accessToken).toBeTruthy();

    const code = `GEN_${Date.now().toString(36).slice(-10)}`.slice(0, 20);
    const createRes = await authedFetch(accessToken, "/api/v1/poses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, name: `Atomic Generate ${code}` }),
    });
    assertNo5xx(createRes.status, "create pose (schema upload UI suite)");
    expect(createRes.status).toBe(201);
    const poseId = ((await safeJson(createRes)) as { id?: number } | undefined)?.id as number;
    expect(typeof poseId).toBe("number");

    // Upload schema so pose.schema_path exists.
    const apiBase = process.env.PLAYWRIGHT_API_URL || "http://127.0.0.1:8000";
    const form = new FormData();
    form.append("file", new Blob([tinyPng], { type: "image/png" }), "schema.png");
    const schemaRes = await fetch(`${apiBase}/api/v1/poses/${poseId}/schema`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
      body: form,
    });
    assertNo5xx(schemaRes.status, "upload schema (schema upload UI suite)");
    expect(schemaRes.status).toBe(200);

    const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3000";
    const context = await browser.newContext({
      baseURL,
      storageState: { cookies: [], origins: [] },
    });
    const page = await context.newPage();

    // Break schema preview <img> loading.
    await page.route("**/storage/uploads/schemas/**", async (route) => {
      if (route.request().resourceType() !== "image") {
        await route.continue();
        return;
      }
      await route.fulfill({ status: 404, body: "Atomic: break schema preview" });
    });

    // UI login for this isolated user.
    await page.goto("/login");
    await expect(page).toHaveURL(/\/login(?:\?|#|$)/, { timeout: 20_000 });
    await page.waitForLoadState("networkidle");
    const tokenInput = page
      .locator('input[type="text"], input[type="password"], input[name="token"], input[id="token"]')
      .first();
    await tokenInput.fill(token);
    const submitButton = page
      .locator('button[type="submit"], button:has-text("Sign"), button:has-text("Login"), button:has-text("Увійти")')
      .first();
    await submitButton.click();
    await page.waitForURL("/", { timeout: 20_000 });
    await page.waitForLoadState("networkidle");

    try {
      await page.goto(`/poses/${poseId}`);

      await expect(page.getByTestId("pose-generate")).toBeVisible();
      await page.getByTestId("pose-generate").click();

      await expect(page.getByTestId("pose-generate-start")).toBeVisible();

      // When preview fails, show upload UI so users can re-upload a schema instead of staring at a broken image.
      await expect(page.getByTestId("pose-generate-upload-area")).toBeVisible();
      await expect(page.getByTestId("pose-generate-start")).toBeEnabled();
    } finally {
      await authedFetch(accessToken, `/api/v1/poses/${poseId}`, { method: "DELETE" }).catch(
        () => undefined,
      );
      await context.close().catch(() => undefined);
    }
  });
});

