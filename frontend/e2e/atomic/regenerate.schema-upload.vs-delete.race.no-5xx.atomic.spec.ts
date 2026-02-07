import { test, expect } from "@playwright/test";
import { TEST_TOKEN } from "../fixtures";
import { authedFetch, loginWithToken, safeJson } from "./atomic-http";
import { assertNo5xx, getEnvInt } from "./atomic-helpers";

const bigPng = Buffer.concat([
  // Valid 1x1 PNG header+data, then padding bytes to slow upload a bit.
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=",
    "base64",
  ),
  Buffer.alloc(2 * 1024 * 1024, 0x61), // 2MB padding
]);

async function createPose(accessToken: string, code: string): Promise<number> {
  const res = await authedFetch(accessToken, "/api/v1/poses", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, name: `Atomic SchemaVsDelete ${code}` }),
  });
  assertNo5xx(res.status, "create pose (schema vs delete)");
  expect(res.status).toBe(201);
  const json = (await safeJson(res)) as { id?: unknown } | undefined;
  expect(typeof json?.id).toBe("number");
  return json?.id as number;
}

test.describe("Atomic regenerate hardening: schema upload vs delete races (never 5xx)", () => {
  test.describe.configure({ mode: "serial" });

  test("concurrent schema upload + delete never returns 5xx", async () => {
    const accessToken = (await loginWithToken(TEST_TOKEN)).accessToken;
    const iterations = getEnvInt("ATOMIC_SCHEMA_DELETE_RACE_ITER", 10);

    for (let i = 0; i < iterations; i += 1) {
      const code = `SDRACE_${Date.now().toString(36).slice(-8)}_${i}`.slice(0, 20);
      const poseId = await createPose(accessToken, code);

      const form = new FormData();
      form.append("file", new Blob([bigPng], { type: "image/png" }), "schema.png");

      const uploadPromise = authedFetch(accessToken, `/api/v1/poses/${poseId}/schema`, {
        method: "POST",
        body: form,
      });

      // Small delay to increase chance the upload has loaded the pose before deletion commits.
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, 20));

      const deletePromise = authedFetch(accessToken, `/api/v1/poses/${poseId}`, { method: "DELETE" });

      // eslint-disable-next-line no-await-in-loop
      const [uploadRes, deleteRes] = await Promise.all([uploadPromise, deletePromise]);

      assertNo5xx(uploadRes.status, `schema upload vs delete (iter=${i}, pose=${poseId})`);
      // Delete can be 204 (won) or 404 (already deleted by another path).
      expect([204, 404]).toContain(deleteRes.status);
    }
  });
});

