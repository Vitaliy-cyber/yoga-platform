import { test, expect } from "@playwright/test";
import { assertNo5xx, concurrentAll, getEnvInt } from "./atomic-helpers";
import { authedFetch, loginWithToken } from "./atomic-http";

const API_BASE_URL = process.env.PLAYWRIGHT_API_URL || "http://localhost:8000";
const USER_TOKEN = process.env.E2E_TEST_TOKEN || "e2e-test-token-playwright-2024";

function tinyPngBytes(): Uint8Array {
  return Uint8Array.from(
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAOq2G7kAAAAASUVORK5CYII=",
      "base64",
    ),
  );
}

test.describe("Atomic poses schema upload concurrency (break-it; never 5xx)", () => {
  test.describe.configure({ mode: "serial" });

  const iterations = getEnvInt("ATOMIC_SCHEMA_UPLOAD_ITER", 24);
  const concurrency = Math.min(getEnvInt("ATOMIC_SCHEMA_UPLOAD_CONCURRENCY", 8), 16);

  let accessToken = "";
  let poseId: number | null = null;

  test.beforeAll(async () => {
    accessToken = (await loginWithToken(USER_TOKEN)).accessToken;
    expect(accessToken).toBeTruthy();

    // Backend enforces code max length (<= 20). Keep it short + unique.
    const suffix = Date.now().toString(36).slice(-8);
    const code = `ASR_${suffix}`;
    const created = await authedFetch(accessToken, "/api/v1/poses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, name: "Atomic Schema Upload Race", description: "atomic" }),
    });
    assertNo5xx(created.status, "create pose");
    expect(created.ok).toBeTruthy();
    const json = (await created.json()) as { id: number };
    poseId = json.id;
    expect(poseId).toBeTruthy();
  });

  test.afterAll(async () => {
    if (!poseId) return;
    const res = await authedFetch(accessToken, `/api/v1/poses/${poseId}`, {
      method: "DELETE",
    });
    assertNo5xx(res.status, "delete pose cleanup");
    // 404 is acceptable if the race already deleted it elsewhere.
    expect([204, 404]).toContain(res.status);
  });

  async function uploadSchema(i: number): Promise<number> {
    if (!poseId) throw new Error("poseId not set");
    const bytes = tinyPngBytes();
    const form = new FormData();
    form.append("file", new Blob([bytes], { type: "image/png" }), `atomic-${i}.png`);

    const res = await fetch(`${API_BASE_URL}/api/v1/poses/${poseId}/schema?i=${i}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Accept-Language": i % 2 ? "uk" : "en",
      },
      body: form,
    });
    assertNo5xx(res.status, `upload schema #${i}`);
    return res.status;
  }

  test("concurrent schema uploads never 5xx and leave a readable schema_path", async () => {
    const tasks = Array.from({ length: iterations }, (_, i) => async () => uploadSchema(i));
    const statuses = await concurrentAll(tasks, concurrency);
    expect(statuses.length).toBe(iterations);
    // Expect at least one successful upload.
    expect(statuses.some((s) => s === 200)).toBeTruthy();
    // Allow conflicts under contention, but never 5xx.
    expect(statuses.every((s) => s === 200 || s === 409)).toBeTruthy();

    if (!poseId) throw new Error("poseId not set");
    const getPose = await authedFetch(accessToken, `/api/v1/poses/${poseId}`);
    assertNo5xx(getPose.status, "get pose after upload race");
    expect(getPose.status).toBe(200);
    const pose = (await getPose.json()) as { schema_path?: string };
    expect(pose.schema_path).toBeTruthy();
    const schemaPath = String(pose.schema_path);
    expect(schemaPath.startsWith("/storage/")).toBeTruthy();

    const storageRes = await fetch(`${API_BASE_URL}${schemaPath}`, { method: "GET" });
    assertNo5xx(storageRes.status, "schema storage fetch");
    expect(storageRes.status).toBe(200);
    const buf = await storageRes.arrayBuffer();
    expect(buf.byteLength).toBeGreaterThan(50);
  });
});
