import { test, expect } from "@playwright/test";
import { login, getAccessToken } from "../test-api";
import { getCorePoseIdA, getCorePoseIdB } from "../test-data";
import { assertNo5xx } from "./atomic-helpers";
import { authedFetch } from "./atomic-http";

test.describe("Atomic signed image URL tamper resistance (break-it)", () => {
  test.describe.configure({ mode: "serial" });

  const apiBase = process.env.PLAYWRIGHT_API_URL || "http://localhost:8000";
  let accessToken = "";

  test.beforeAll(async () => {
    await login();
    const token = getAccessToken();
    expect(token).toBeTruthy();
    accessToken = token as string;
  });

  test("signed URL is bound to pose_id + image_type (tampering yields 401, never 5xx)", async () => {
    const poseA = getCorePoseIdA();
    const poseB = getCorePoseIdB();
    test.skip(!poseA || !poseB, "Seed poses not available");

    const signedRes = await authedFetch(
      accessToken,
      `/api/v1/poses/${poseA}/image/schema/signed-url`,
      { headers: { Accept: "application/json" } },
    );
    assertNo5xx(signedRes.status, "signed-url fetch");
    expect(signedRes.status).toBe(200);
    const json = (await signedRes.json()) as { signed_url: string };
    expect(json.signed_url).toBeTruthy();

    // Baseline: signed URL works without Authorization header.
    const okRes = await fetch(json.signed_url, { headers: { Accept: "image/*" } });
    assertNo5xx(okRes.status, "signed-url image fetch");
    expect(okRes.status).toBe(200);
    const buf = await okRes.arrayBuffer();
    expect(buf.byteLength).toBeGreaterThan(16);

    const parsed = new URL(json.signed_url);
    const base = new URL(apiBase);
    expect(parsed.host).toBe(base.host);

    // Tamper 1: change image_type (schema -> photo) but keep query signature.
    const tamperedType = new URL(json.signed_url);
    tamperedType.pathname = tamperedType.pathname.replace("/image/schema", "/image/photo");
    const t1 = await fetch(tamperedType.toString(), { headers: { Accept: "application/json" } });
    assertNo5xx(t1.status, "tampered image_type");
    expect(t1.status).toBe(401);

    // Tamper 2: change pose_id (A -> B) but keep query signature.
    const tamperedPose = new URL(json.signed_url);
    tamperedPose.pathname = tamperedPose.pathname.replace(`/poses/${poseA}/`, `/poses/${poseB}/`);
    const t2 = await fetch(tamperedPose.toString(), { headers: { Accept: "application/json" } });
    assertNo5xx(t2.status, "tampered pose_id");
    expect(t2.status).toBe(401);
  });
});

