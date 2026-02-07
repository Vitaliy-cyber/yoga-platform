import { test, expect } from "@playwright/test";
import { authedFetch, loginWithToken, makeIsolatedToken, safeJson } from "./atomic-http";
import { assertNo5xx } from "./atomic-helpers";

test.describe("Atomic generate modal: end-to-end (no mocks)", () => {
  test.describe.configure({ mode: "serial" });

  test("starts generation and auto-applies results without 5xx (modal closes)", async ({ browser }) => {
    test.setTimeout(180_000);

    const apiBase = process.env.PLAYWRIGHT_API_URL || "http://127.0.0.1:8000";
    const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3000";

    const token = makeIsolatedToken("generate-modal");
    const { accessToken, userId } = await loginWithToken(token);

    // Create an isolated schema-only pose so the UI shows the Generate button.
    const code = `GEN_${Date.now().toString(36).slice(-10)}`.slice(0, 20);
    const createRes = await authedFetch(accessToken, "/api/v1/poses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, name: `Atomic Generate ${code}` }),
    });
    assertNo5xx(createRes.status, "create pose (generate modal)");
    expect(createRes.status).toBe(201);
    const created = (await safeJson(createRes)) as { id?: number } | undefined;
    const poseId = created?.id as number;
    expect(typeof poseId).toBe("number");

    // Upload tiny schema to enable server-side generate/from-pose.
    const tinyPng = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=",
      "base64",
    );
    const form = new FormData();
    form.append("file", new Blob([tinyPng], { type: "image/png" }), "schema.png");
    const schemaRes = await fetch(`${apiBase}/api/v1/poses/${poseId}/schema`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
      body: form,
    });
    assertNo5xx(schemaRes.status, "upload schema (generate modal)");
    expect(schemaRes.status).toBe(200);

    // Explicitly isolate from the project's shared storageState (User #1).
    const context = await browser.newContext({
      baseURL,
      storageState: { cookies: [], origins: [] },
    });

    // Inject auth directly into localStorage so the UI uses the same user that created the pose.
    const meRes = await authedFetch(accessToken, "/api/v1/auth/me");
    assertNo5xx(meRes.status, "auth/me (generate modal)");
    expect(meRes.status).toBe(200);
    const meJson = (await safeJson(meRes)) as
      | { id?: number; name?: string | null; created_at?: string; last_login?: string | null }
      | undefined;
    expect(meJson?.id).toBe(userId);

    const authKey = "yoga_auth_token";
    const authValue = JSON.stringify({
      state: {
        user: {
          id: meJson?.id as number,
          name: (meJson?.name ?? null) as string | null,
          created_at: (meJson?.created_at ?? new Date().toISOString()) as string,
          last_login: (meJson?.last_login ?? null) as string | null,
        },
        accessToken,
        tokenExpiresAt: Date.now() + 60 * 60 * 1000,
      },
      version: 0,
    });
    await context.addInitScript(
      ({ k, v }) => {
        window.localStorage.setItem(k, v);
      },
      { k: authKey, v: authValue },
    );
    const page = await context.newPage();

    try {
      await page.goto(`/poses/${poseId}`);

      await expect(page.getByTestId("pose-generate")).toBeVisible({ timeout: 30_000 });
      await page.getByTestId("pose-generate").click();

      await expect(page.getByTestId("pose-generate-start")).toBeVisible({ timeout: 30_000 });
      await page.getByTestId("pose-generate-notes").fill("atomic: e2e generate");

      const fromPoseRes = page.waitForResponse((res) => {
        return (
          res.request().method() === "POST" &&
          res.url().includes(`/api/v1/generate/from-pose/${poseId as number}`)
        );
      });
      await page.getByTestId("pose-generate-start").click();

      const r = await fromPoseRes;
      assertNo5xx(r.status(), "generate/from-pose (ui)");
      expect([200, 409, 429]).toContain(r.status());

      if (r.status() === 200) {
        // The modal should eventually close after generation completes and results are applied.
        await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 150_000 });
      } else {
        // On transient conflicts/rate limits, UI must not get stuck.
        const dialog = page.getByRole("dialog");
        await expect(dialog).toBeVisible({ timeout: 30_000 });
        await expect(page.getByTestId("pose-generate-start")).toBeEnabled({ timeout: 30_000 });
        await page.keyboard.press("Escape");
      }
    } finally {
      await context.close().catch(() => undefined);
      await authedFetch(accessToken, `/api/v1/poses/${poseId}`, { method: "DELETE" }).catch(
        () => undefined,
      );
    }
  });
});
