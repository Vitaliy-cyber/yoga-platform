import { test, expect } from "@playwright/test";
import { assertNo5xx, concurrentAll, getEnvInt } from "./atomic-helpers";
import { authedFetch, loginWithToken } from "./atomic-http";

const API_BASE_URL = process.env.PLAYWRIGHT_API_URL || "http://127.0.0.1:8000";
const USER_TOKEN = process.env.E2E_TEST_TOKEN || "e2e-test-token-playwright-2024";

function tinyPngBytes(): Uint8Array {
  return Uint8Array.from(
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAOq2G7kAAAAASUVORK5CYII=",
      "base64",
    ),
  );
}

async function uploadSchema(accessToken: string, poseId: number, i: number): Promise<number> {
  const bytes = tinyPngBytes();
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: "image/png" }), `atomic-su-${i}.png`);

  const res = await fetch(`${API_BASE_URL}/api/v1/poses/${poseId}/schema?i=${i}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Accept-Language": i % 2 ? "uk" : "en",
    },
    body: form,
  });
  assertNo5xx(res.status, `schema upload #${i}`);
  return res.status;
}

test.describe("Atomic signed-url vs schema upload races (break-it; never 5xx)", () => {
  test.describe.configure({ mode: "serial" });

  const iterations = getEnvInt("ATOMIC_SIGNED_URL_RACE_ITER", 120);
  const concurrency = Math.min(getEnvInt("ATOMIC_SIGNED_URL_RACE_CONCURRENCY", 16), 24);

  let accessToken = "";
  let poseId: number | null = null;

  test.beforeAll(async () => {
    accessToken = (await loginWithToken(USER_TOKEN)).accessToken;
    expect(accessToken).toBeTruthy();

    const suffix = Date.now().toString(36).slice(-8);
    const code = `ASU_${suffix}`.slice(0, 20);
    const created = await authedFetch(accessToken, "/api/v1/poses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, name: "Atomic Signed URL Race", description: "atomic" }),
    });
    assertNo5xx(created.status, "create pose (signed-url race)");
    expect(created.ok).toBeTruthy();
    const json = (await created.json()) as { id: number };
    poseId = json.id;
    expect(poseId).toBeTruthy();

    const first = await uploadSchema(accessToken, poseId, 0);
    expect([200, 409]).toContain(first);
  });

  test.afterAll(async () => {
    if (!poseId) return;
    const res = await authedFetch(accessToken, `/api/v1/poses/${poseId}`, { method: "DELETE" });
    assertNo5xx(res.status, "delete pose cleanup");
    expect([204, 404]).toContain(res.status);
  });

  test("concurrent uploads + signed-url reads never 5xx", async () => {
    if (!poseId) throw new Error("poseId not set");

    const tasks = Array.from({ length: iterations }, (_, i) => async () => {
      // Alternate write/read pressure to maximize lock contention.
      if (i % 3 === 0) {
        const s = await uploadSchema(accessToken, poseId as number, i);
        expect([200, 409]).toContain(s);
        return s;
      }

      const res = await authedFetch(
        accessToken,
        `/api/v1/poses/${poseId as number}/image/schema/signed-url?i=${i}`,
        { method: "GET", headers: { Accept: "application/json" } },
      );
      assertNo5xx(res.status, `signed-url #${i}`);
      expect([200, 404, 409]).toContain(res.status);
      if (res.status === 200) {
        const body = (await res.json()) as { signed_url?: string };
        expect(typeof body.signed_url).toBe("string");
        expect(body.signed_url).toContain("/api/v1/poses/");
      }
      return res.status;
    });

    const statuses = await concurrentAll(tasks, concurrency);
    expect(statuses.length).toBe(iterations);
    expect(statuses.every((s) => s === 200 || s === 404 || s === 409)).toBeTruthy();
    expect(statuses.some((s) => s === 200)).toBeTruthy();
  });
});

