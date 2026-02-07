import { test, expect } from "@playwright/test";
import { TEST_TOKEN } from "../fixtures";
import { authedFetch, loginWithToken, safeJson } from "./atomic-http";
import { assertNo5xx } from "./atomic-helpers";

test.describe("Atomic regeneration notes (API edge cases)", () => {
  test.describe.configure({ mode: "serial" });

  const API_BASE_URL = process.env.PLAYWRIGHT_API_URL || "http://127.0.0.1:8000";

  let accessToken = "";
  let poseId: number | null = null;

  test.beforeAll(async () => {
    const auth = await loginWithToken(TEST_TOKEN);
    accessToken = auth.accessToken;
    expect(accessToken).toBeTruthy();

    // Create an isolated pose for this spec so it can run under the API-only config
    // (which does not execute the UI global-setup seeding).
    const code = `AT_NOTES_${Date.now().toString(36).slice(-8)}`.slice(0, 20);
    const createRes = await authedFetch(accessToken, "/api/v1/poses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, name: `Atomic ${code}` }),
    });
    assertNo5xx(createRes.status, "create pose");
    expect(createRes.status).toBe(201);
    const created = (await safeJson(createRes)) as { id?: unknown } | undefined;
    expect(typeof created?.id).toBe("number");
    poseId = created?.id as number;

    const tinyPng = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=",
      "base64",
    );
    const form = new FormData();
    form.append("file", new Blob([tinyPng], { type: "image/png" }), "schema.png");
    const schemaRes = await fetch(`${API_BASE_URL}/api/v1/poses/${poseId}/schema`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
      body: form,
    });
    assertNo5xx(schemaRes.status, "upload schema");
    expect(schemaRes.status).toBe(200);
  });

  test.afterAll(async () => {
    if (!poseId) return;
    await authedFetch(accessToken, `/api/v1/poses/${poseId}`, { method: "DELETE" }).catch(() => undefined);
  });

  const postFromPose = async (poseId: number, body: unknown) => {
    const res = await authedFetch(accessToken, `/api/v1/generate/from-pose/${poseId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    assertNo5xx(res.status, "generate/from-pose");
    return res;
  };

  test("from-pose accepts empty object body", async () => {
    test.skip(!poseId, "pose fixture not created");
    const res = await postFromPose(poseId as number, {});
    expect(res.status).toBe(200);
    const json = await safeJson(res);
    expect((json as { task_id?: string } | undefined)?.task_id).toBeTruthy();
  });

  test("from-pose accepts additional_notes (basic)", async () => {
    test.skip(!poseId, "pose fixture not created");
    const res = await postFromPose(poseId as number, { additional_notes: "Focus on shoulders" });
    expect(res.status).toBe(200);
  });

  test("from-pose survives whitespace-only additional_notes (never 5xx)", async () => {
    test.skip(!poseId, "pose fixture not created");
    const res = await postFromPose(poseId as number, { additional_notes: "     " });
    expect(res.status).toBeLessThan(500);
  });

  test("from-pose survives newlines + quotes in additional_notes (never 5xx)", async () => {
    test.skip(!poseId, "pose fixture not created");
    const notes = `Line1\nLine2 "quoted" and \\ backslash`;
    const res = await postFromPose(poseId as number, { additional_notes: notes });
    expect(res.status).toBeLessThan(500);
  });

  test("from-pose survives high Unicode in additional_notes (never 5xx)", async () => {
    test.skip(!poseId, "pose fixture not created");
    const notes = "Юзер: підказка для моделі ✅ — мʼякі символи, емоції, 你好, عربى";
    const res = await postFromPose(poseId as number, { additional_notes: notes });
    expect(res.status).toBeLessThan(500);
  });

  test("from-pose enforces max length for additional_notes (422 over 500 chars)", async () => {
    test.skip(!poseId, "pose fixture not created");
    const ok = await postFromPose(poseId as number, { additional_notes: "x".repeat(500) });
    expect(ok.status).toBe(200);

    const tooLong = await postFromPose(poseId as number, { additional_notes: "x".repeat(501) });
    expect(tooLong.status).toBe(422);
  });

  test("from-pose survives unpaired surrogate in additional_notes (never 5xx)", async () => {
    test.skip(!poseId, "pose fixture not created");
    const notes = `bad-surrogate:${"\ud800"}`;
    const res = await postFromPose(poseId as number, { additional_notes: notes });
    expect(res.status).toBeLessThan(500);
  });

  test("from-pose survives null byte in additional_notes (never 5xx)", async () => {
    test.skip(!poseId, "pose fixture not created");
    const notes = `nullbyte:\u0000:end`;
    const res = await postFromPose(poseId as number, { additional_notes: notes });
    expect(res.status).toBeLessThan(500);
  });

  test("from-pose rejects nonexistent pose id with 404 (not 5xx)", async () => {
    const res = await postFromPose(999999, { additional_notes: "hello" });
    expect(res.status).toBe(404);
  });

  test("from-pose with extra keys never 5xx", async () => {
    test.skip(!poseId, "pose fixture not created");
    const res = await postFromPose(poseId as number, {
      additional_notes: "ok",
      extra: { a: 1, b: [2, 3], c: "x" },
    });
    expect(res.status).toBeLessThan(500);
  });
});
