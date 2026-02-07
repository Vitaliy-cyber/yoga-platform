import { test, expect } from "@playwright/test";
import { assertNo5xx, concurrentAll, getEnvInt } from "./atomic-helpers";
import { authedFetch, loginWithToken, makeIsolatedToken } from "./atomic-http";

const API_BASE_URL = process.env.PLAYWRIGHT_API_URL || "http://127.0.0.1:8000";

function tinyPngBytes(): Uint8Array {
  return Uint8Array.from(
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAOq2G7kAAAAASUVORK5CYII=",
      "base64",
    ),
  );
}

test.describe("Atomic pose create stress (extreme concurrency; never 5xx)", () => {
  test.describe.configure({ mode: "serial" });

  const concurrency = Math.min(getEnvInt("ATOMIC_CREATE_STRESS_CONCURRENCY", 30), 60);
  const posesN = getEnvInt("ATOMIC_CREATE_STRESS_POSES", 500);

  let accessToken = "";
  const createdPoseIds: number[] = [];

  test.beforeAll(async () => {
    const token = makeIsolatedToken(`create-stress-${Date.now().toString(36)}`);
    accessToken = (await loginWithToken(token)).accessToken;
    expect(accessToken).toBeTruthy();
  });

  test.afterAll(async () => {
    const tasks = createdPoseIds.map((id) => async () => {
      const res = await authedFetch(accessToken, `/api/v1/poses/${id}`, { method: "DELETE" });
      assertNo5xx(res.status, "cleanup delete pose");
      return res.status;
    });
    await concurrentAll(tasks, Math.min(concurrency, 24)).catch(() => undefined);
  });

  async function uploadSchema(poseId: number, i: number): Promise<number> {
    const bytes = tinyPngBytes();
    const form = new FormData();
    form.append("file", new Blob([bytes], { type: "image/png" }), `atomic-cs-${i}.png`);

    const res = await fetch(`${API_BASE_URL}/api/v1/poses/${poseId}/schema?i=${i}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
      body: form,
    });
    assertNo5xx(res.status, `schema upload after create #${i}`);
    expect([200, 404, 409]).toContain(res.status);
    return res.status;
  }

  test("many concurrent creates do not 5xx (201/409 only) and server stays alive", async () => {
    test.setTimeout(240_000);

    const tasks = Array.from({ length: posesN }, (_, i) => async () => {
      const suffix = `${Date.now().toString(36).slice(-6)}${i.toString(36)}`.slice(-10);
      const code = `CS${suffix}`.slice(0, 20);

      const res = await authedFetch(accessToken, "/api/v1/poses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, name: `Atomic Create Stress ${code}` }),
      });
      assertNo5xx(res.status, `create pose #${i}`);
      expect([201, 409]).toContain(res.status);

      if (res.status === 201) {
        const json = (await res.json()) as { id: number };
        createdPoseIds.push(json.id);
        // Half the time, immediately follow with a schema upload to increase write pressure.
        if (i % 2 === 0) {
          await uploadSchema(json.id, i);
        }
      }
      return res.status;
    });

    const statuses = await concurrentAll(tasks, Math.min(concurrency, 40));
    expect(statuses.length).toBe(posesN);
    expect(statuses.some((s) => s === 201)).toBeTruthy();
    expect(statuses.every((s) => s === 201 || s === 409)).toBeTruthy();

    const health = await fetch(`${API_BASE_URL}/health`);
    assertNo5xx(health.status, "health after create-stress");
    expect(health.status).toBe(200);
  });
});

