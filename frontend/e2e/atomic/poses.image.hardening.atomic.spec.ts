import { test, expect } from "@playwright/test";
import { assertNo5xx } from "./atomic-helpers";
import { authedFetch, loginWithToken, safeJson } from "./atomic-http";

test.describe("Atomic poses image hardening (break-it tests)", () => {
  test.describe.configure({ mode: "serial" });

  const apiBase = process.env.PLAYWRIGHT_API_URL || "http://localhost:8000";
  let accessToken = "";
  let poseId: number | null = null;

  test.beforeAll(async () => {
    // Use a unique token so other atomic auth tests can't revoke our session mid-run.
    const token = `${process.env.E2E_TEST_TOKEN || "e2e-test-token-playwright-2024"}-img-hardening-${Date.now().toString(36)}`;
    accessToken = (await loginWithToken(token)).accessToken;
    expect(accessToken).toBeTruthy();

    const code = `IMG${Date.now().toString(36).slice(-10)}`.slice(0, 20);
    const createRes = await authedFetch(accessToken, "/api/v1/poses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code,
        name: `Atomic Image Hardening ${Date.now()}`,
        description: "baseline",
      }),
    });
    assertNo5xx(createRes.status, "create pose");
    expect(createRes.status).toBe(201);
    poseId = ((await createRes.json()) as { id: number }).id;

    // Upload a minimal schema so signed-url endpoint has something real to sign.
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
    assertNo5xx(schemaRes.status, "upload schema");
    expect(schemaRes.status).toBe(200);
  });

  test.afterAll(async () => {
    if (!poseId) return;
    await authedFetch(accessToken, `/api/v1/poses/${poseId}`, { method: "DELETE" }).catch(
      () => undefined,
    );
  });

  test("PUT /poses ignores user-supplied image URLs (prevents SSRF/open-proxy)", async () => {
    test.skip(!poseId, "pose not created");

    const ssrfUrl1 = `${apiBase}/health`;
    const ssrfUrl2 = `${apiBase}/openapi.json`;

    // Retry on 409 conflicts (can happen under load).
    let updated: {
      description?: string | null;
      photo_path?: string | null;
      muscle_layer_path?: string | null;
    } | null = null;
    let lastStatus: number | null = null;

    for (let attempt = 0; attempt < 16; attempt += 1) {
      const getRes = await authedFetch(accessToken, `/api/v1/poses/${poseId}`);
      assertNo5xx(getRes.status, "get pose (ssrf probe)");
      expect(getRes.status).toBe(200);
      const pose = (await getRes.json()) as { version: number };

      const updateRes = await authedFetch(accessToken, `/api/v1/poses/${poseId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          version: pose.version,
          change_note: "atomic-ssrf-attempt",
          description: `updated-${Date.now()}`,
          photo_path: ssrfUrl1,
          muscle_layer_path: ssrfUrl2,
        }),
      });

      assertNo5xx(updateRes.status, "pose update with injected image URLs");
      lastStatus = updateRes.status;
      if (updateRes.status === 409) {
        // SQLite is single-writer; under heavy atomic parallel load we can see
        // sustained transient conflicts. Back off to avoid flaking.
        // eslint-disable-next-line no-await-in-loop
        await new Promise((r) => setTimeout(r, 60 + attempt * 40));
        continue;
      }
      expect(updateRes.status).toBe(200);
      updated = (await updateRes.json()) as typeof updated;
      break;
    }

    expect(updated, `expected update to succeed; last status=${lastStatus ?? "none"}`).toBeTruthy();
    expect(updated.description || "").toContain("updated-");
    expect(updated.photo_path).not.toBe(ssrfUrl1);
    expect(updated.muscle_layer_path).not.toBe(ssrfUrl2);

    // If the backend accepted the injected URLs, these would become a server-side proxy.
    const proxyRes = await authedFetch(accessToken, `/api/v1/poses/${poseId}/image/photo`, {
      headers: { Accept: "application/json" },
    });
    assertNo5xx(proxyRes.status, "pose image proxy (photo)");
    expect([404, 400].includes(proxyRes.status)).toBeTruthy();
    const body = await proxyRes.text();
    expect(body).not.toContain("openapi");
    expect(body).not.toContain("status");
  });

  test("signed-url endpoint ignores untrusted X-Forwarded-* headers (prevents host injection)", async () => {
    test.skip(!poseId, "pose not created");

    const forwardedRes = await authedFetch(
      accessToken,
      `/api/v1/poses/${poseId}/image/schema/signed-url`,
      {
        headers: {
          Accept: "application/json",
          "X-Forwarded-Proto": "https",
          "X-Forwarded-Host": "evil.example",
        },
      },
    );
    assertNo5xx(forwardedRes.status, "signed-url forwarded headers");
    expect(forwardedRes.status).toBe(200);
    const json = (await forwardedRes.json()) as { signed_url: string };
    expect(json.signed_url).toBeTruthy();

    const out = new URL(json.signed_url);
    const base = new URL(apiBase);
    expect(out.host).toBe(base.host);
    expect(out.protocol).toBe(base.protocol);
    expect(json.signed_url).not.toContain("evil.example");
  });

  test("invalid image type never 5xx and error JSON is parseable", async () => {
    test.skip(!poseId, "pose not created");

    const res = await authedFetch(accessToken, `/api/v1/poses/${poseId}/image/not_a_real_type`, {
      headers: { Accept: "application/json" },
    });
    assertNo5xx(res.status, "invalid image type");
    expect([400, 401, 404].includes(res.status)).toBeTruthy();
    await safeJson(res);
  });
});
