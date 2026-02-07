import { test, expect } from "@playwright/test";
import { assertNo5xx } from "./atomic-helpers";
import { authedFetch, loginWithToken, safeJson } from "./atomic-http";

const API_BASE_URL = process.env.PLAYWRIGHT_API_URL || "http://localhost:8000";
const USER1_TOKEN =
  process.env.E2E_TEST_TOKEN || "e2e-test-token-playwright-2024";

async function getPoseIdByCode(accessToken: string, code: string): Promise<number> {
  const res = await authedFetch(accessToken, `/api/v1/poses/code/${encodeURIComponent(code)}`);
  assertNo5xx(res.status, `get pose by code ${code}`);
  expect(res.status).toBe(200);
  const json = (await safeJson(res)) as { id?: unknown } | undefined;
  expect(typeof json?.id).toBe("number");
  return json?.id as number;
}

test.describe("Atomic pose image signed URL tamper-resistance (break-it; no 5xx)", () => {
  test.describe.configure({ mode: "serial" });

  test("tampering signed URL params yields 401; unsigned requests stay 401 (never 5xx)", async () => {
    const accessToken = (await loginWithToken(USER1_TOKEN)).accessToken;
    const poseId = await getPoseIdByCode(accessToken, "E2E_CORE_A");

    // Baseline: unsigned, no auth header should be 401 (not 5xx).
    const unsigned = await fetch(`${API_BASE_URL}/api/v1/poses/${poseId}/image/schema`);
    expect(unsigned.status).toBe(401);

    // Get signed URL.
    const signedRes = await authedFetch(
      accessToken,
      `/api/v1/poses/${poseId}/image/schema/signed-url`,
    );
    assertNo5xx(signedRes.status, "get signed-url");
    expect(signedRes.status).toBe(200);
    const signedJson = (await safeJson(signedRes)) as { signed_url?: unknown } | undefined;
    expect(typeof signedJson?.signed_url).toBe("string");
    const signedUrl = String(signedJson?.signed_url);

    // Signed URL should work without Authorization header.
    const ok = await fetch(signedUrl);
    assertNo5xx(ok.status, "signed image fetch");
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type") || "").toContain("image/");

    // Tamper user_id
    const u1 = new URL(signedUrl);
    const oldUserId = u1.searchParams.get("user_id") || "";
    u1.searchParams.set("user_id", oldUserId ? String(Number(oldUserId) + 1) : "999");
    const badUser = await fetch(u1.toString());
    expect(badUser.status).toBe(401);

    // Tamper expires
    const u2 = new URL(signedUrl);
    u2.searchParams.set("expires", "1");
    const badExp = await fetch(u2.toString());
    expect(badExp.status).toBe(401);

    // Tamper signature
    const u3 = new URL(signedUrl);
    u3.searchParams.set("sig", "00");
    const badSig = await fetch(u3.toString());
    expect(badSig.status).toBe(401);

    // Token-in-query should not authenticate.
    const qtok = await fetch(`${API_BASE_URL}/api/v1/poses/${poseId}/image/schema?token=abc`);
    expect(qtok.status).toBe(401);
  });
});

