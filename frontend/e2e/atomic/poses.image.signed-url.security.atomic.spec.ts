import { test, expect } from "@playwright/test";
import { TEST_TOKEN } from "../fixtures";
import { getCorePoseIdA } from "../test-data";
import { assertNo5xx, concurrentAll, getEnvInt } from "./atomic-helpers";
import { authedFetch, loginWithToken, safeJson } from "./atomic-http";

test.describe("Atomic pose image signed-URL hardening (break-it; no 5xx, no proxy header injection)", () => {
  test.describe.configure({ mode: "serial" });

  let accessToken = "";

  test.beforeAll(async () => {
    accessToken = (await loginWithToken(TEST_TOKEN)).accessToken;
    expect(accessToken).toBeTruthy();
  });

  async function getSignedUrl(poseId: number, imageType: string, forwardedHost: string): Promise<string> {
    const res = await authedFetch(accessToken, `/api/v1/poses/${poseId}/image/${imageType}/signed-url`, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "x-forwarded-host": forwardedHost,
        "x-forwarded-proto": "https",
      },
    });
    assertNo5xx(res.status, "signed-url");
    expect(res.status).toBe(200);
    const body = (await safeJson(res)) as { signed_url?: unknown } | undefined;
    expect(typeof body?.signed_url).toBe("string");
    return body?.signed_url as string;
  }

  test("x-forwarded-host/proto are ignored when untrusted (no host injection)", async () => {
    const poseId = getCorePoseIdA();
    test.skip(!poseId, "Core seed pose not available");

    const signedUrl = await getSignedUrl(poseId as number, "photo", "evil.example");
    expect(signedUrl).toContain(`/api/v1/poses/${poseId as number}/image/photo?`);
    expect(signedUrl).not.toContain("evil.example");

    // In DEV mode backend forces http scheme even if x-forwarded-proto is sent.
    expect(signedUrl.startsWith("http://")).toBeTruthy();

    // No token leakage to URL.
    const lower = signedUrl.toLowerCase();
    expect(lower).not.toContain("token=");
    expect(lower).not.toContain("access_token");
    expect(lower).not.toContain("authorization");
    expect(lower).toContain("user_id=");
    expect(lower).toContain("expires=");
    expect(lower).toContain("sig=");

    // Signed URL should actually work without Authorization header.
    const imgRes = await fetch(signedUrl, { method: "GET" });
    assertNo5xx(imgRes.status, "fetch image via signed url");
    expect(imgRes.status).toBe(200);
    expect(imgRes.headers.get("cache-control") || "").toContain("private");
    expect(imgRes.headers.get("content-type") || "").toMatch(/^image\//);
    const buf = await imgRes.arrayBuffer();
    expect(buf.byteLength).toBeGreaterThan(64);
  });

  test("tampering signature/expires yields 401 (never 5xx)", async () => {
    const poseId = getCorePoseIdA();
    test.skip(!poseId, "Core seed pose not available");

    const signedUrl = await getSignedUrl(poseId as number, "schema", "evil.example");
    const u = new URL(signedUrl);

    // 1) Sig tamper
    const origSig = u.searchParams.get("sig") || "";
    expect(origSig.length).toBeGreaterThan(0);
    u.searchParams.set("sig", `${origSig.slice(0, -1)}x`);

    const tampered = await fetch(u.toString(), { method: "GET" });
    assertNo5xx(tampered.status, "tampered signed url");
    expect(tampered.status).toBe(401);

    // 2) Expires in the past
    const u2 = new URL(signedUrl);
    u2.searchParams.set("expires", "1");
    const expired = await fetch(u2.toString(), { method: "GET" });
    assertNo5xx(expired.status, "expired signed url");
    expect(expired.status).toBe(401);
  });

  test("concurrent signed-url fetch is stable (all 200; never 5xx)", async () => {
    const poseId = getCorePoseIdA();
    test.skip(!poseId, "Core seed pose not available");

    const iterations = getEnvInt("ATOMIC_POSE_IMAGE_SIGNED_URL_ITER", 16);
    const concurrency = Math.min(getEnvInt("ATOMIC_CONCURRENCY", 12), 6);

    const tasks = Array.from({ length: iterations }, (_v, i) => async () => {
      const signedUrl = await getSignedUrl(
        poseId as number,
        i % 2 === 0 ? "photo" : "muscle_layer",
        `evil.example,evil2.example`,
      );
      const res = await fetch(signedUrl, { method: "GET" });
      assertNo5xx(res.status, "concurrent image fetch via signed url");
      return res.status;
    });

    const statuses = await concurrentAll(tasks, concurrency);
    expect(statuses.every((s) => s === 200)).toBeTruthy();
  });
});

