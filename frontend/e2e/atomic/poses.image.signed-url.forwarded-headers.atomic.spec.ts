import { test, expect } from "@playwright/test";
import { login, getAccessToken } from "../test-api";
import { getCorePoseIdA } from "../test-data";
import { authedFetch, safeJson } from "./atomic-http";
import { assertNo5xx } from "./atomic-helpers";

test.describe("Atomic signed-url hardening (forwarded headers; no host injection; no 5xx)", () => {
  test.describe.configure({ mode: "serial" });

  let accessToken = "";
  let poseId: number | null = null;

  test.beforeAll(async () => {
    await login();
    const token = getAccessToken();
    expect(token).toBeTruthy();
    accessToken = token as string;
    poseId = getCorePoseIdA() ?? null;
  });

  test("signed-url ignores X-Forwarded-* unless TRUSTED_PROXIES is configured", async () => {
    test.skip(!poseId, "Core seed pose not available");

    const apiBase = process.env.PLAYWRIGHT_API_URL || "http://localhost:8000";
    const expectedBase = new URL(apiBase);

    const res = await authedFetch(accessToken, `/api/v1/poses/${poseId as number}/image/photo/signed-url`, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "X-Forwarded-Proto": "https",
        "X-Forwarded-Host": "evil.example.test",
      },
    });
    assertNo5xx(res.status, "signed-url with forwarded headers");
    expect(res.status).toBe(200);

    const body = (await safeJson(res)) as { signed_url?: string } | undefined;
    expect(body?.signed_url).toBeTruthy();

    const signedUrl = new URL(body?.signed_url as string);
    expect(signedUrl.host).toBe(expectedBase.host);
    expect(signedUrl.protocol).toBe(expectedBase.protocol);
  });
});

