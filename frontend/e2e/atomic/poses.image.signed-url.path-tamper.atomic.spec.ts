import { test, expect } from "@playwright/test";
import { assertNo5xx } from "./atomic-helpers";
import { authedFetch, loginWithToken, safeJson } from "./atomic-http";

const USER1_TOKEN = process.env.E2E_TEST_TOKEN || "e2e-test-token-playwright-2024";

async function getPoseIdByCode(accessToken: string, code: string): Promise<number> {
  const res = await authedFetch(accessToken, `/api/v1/poses/code/${encodeURIComponent(code)}`);
  assertNo5xx(res.status, `get pose by code ${code}`);
  expect(res.status).toBe(200);
  const json = (await safeJson(res)) as { id?: unknown } | undefined;
  expect(typeof json?.id).toBe("number");
  return json?.id as number;
}

test.describe("Atomic pose image signed URL path tamper-resistance (break-it; no 5xx)", () => {
  test.describe.configure({ mode: "serial" });

  test("tampering path segments (pose_id / image kind) never grants access", async () => {
    const accessToken = (await loginWithToken(USER1_TOKEN)).accessToken;
    const poseId = await getPoseIdByCode(accessToken, "E2E_CORE_A");

    const signedRes = await authedFetch(accessToken, `/api/v1/poses/${poseId}/image/schema/signed-url`);
    assertNo5xx(signedRes.status, "get signed-url");
    expect(signedRes.status).toBe(200);
    const signedJson = (await safeJson(signedRes)) as { signed_url?: unknown } | undefined;
    expect(typeof signedJson?.signed_url).toBe("string");

    const signedUrl = new URL(String(signedJson?.signed_url));

    // Baseline should succeed.
    const ok = await fetch(signedUrl.toString());
    assertNo5xx(ok.status, "signed image fetch baseline");
    expect(ok.status).toBe(200);

    // Tamper pose_id in path.
    const tamperedPose = new URL(signedUrl.toString());
    tamperedPose.pathname = tamperedPose.pathname.replace(`/poses/${poseId}/`, `/poses/${poseId + 1}/`);
    const badPose = await fetch(tamperedPose.toString());
    assertNo5xx(badPose.status, "signed url path tamper (pose_id)");
    expect(badPose.status).not.toBe(200);

    // Tamper image kind in path (schema -> photo).
    const tamperedKind = new URL(signedUrl.toString());
    tamperedKind.pathname = tamperedKind.pathname.replace("/image/schema", "/image/photo");
    const badKind = await fetch(tamperedKind.toString());
    assertNo5xx(badKind.status, "signed url path tamper (kind)");
    expect(badKind.status).not.toBe(200);
  });
});

