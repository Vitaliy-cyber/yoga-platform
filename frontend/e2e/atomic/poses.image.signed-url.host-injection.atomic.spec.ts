import { test, expect } from "@playwright/test";
import { assertNo5xx } from "./atomic-helpers";
import { authedFetch, loginWithToken, safeJson } from "./atomic-http";

const API_BASE_URL = process.env.PLAYWRIGHT_API_URL || "http://localhost:8000";
const USER1_TOKEN =
  process.env.E2E_TEST_TOKEN || "e2e-test-token-playwright-2024";

test.describe("Atomic signed URL host/proto injection hardening (break-it; no 5xx)", () => {
  test.describe.configure({ mode: "serial" });

  test("x-forwarded-host/proto are ignored unless TRUSTED_PROXIES configured", async () => {
    const accessToken = (await loginWithToken(USER1_TOKEN)).accessToken;

    const poseRes = await authedFetch(accessToken, "/api/v1/poses/code/E2E_CORE_A");
    assertNo5xx(poseRes.status, "get pose by code");
    expect(poseRes.status).toBe(200);
    const poseJson = (await safeJson(poseRes)) as { id?: unknown } | undefined;
    expect(typeof poseJson?.id).toBe("number");
    const poseId = poseJson?.id as number;

    const res = await authedFetch(
      accessToken,
      `/api/v1/poses/${poseId}/image/schema/signed-url`,
      {
        headers: {
          "x-forwarded-host": "attacker.example",
          "x-forwarded-proto": "https",
        },
      },
    );
    assertNo5xx(res.status, "signed-url host injection");
    expect(res.status).toBe(200);
    const json = (await safeJson(res)) as { signed_url?: unknown } | undefined;
    expect(typeof json?.signed_url).toBe("string");
    const signedUrl = String(json?.signed_url);
    expect(signedUrl).toContain("/api/v1/poses/");
    expect(signedUrl).not.toContain("attacker.example");
  });
});

