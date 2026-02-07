import { test, expect } from "@playwright/test";
import { TEST_TOKEN } from "../fixtures";
import { authedFetch, loginWithToken, safeJson } from "./atomic-http";
import { assertNo5xx, concurrentAll, getEnvInt } from "./atomic-helpers";

const tinyPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=",
  "base64",
);

async function createPose(accessToken: string, code: string): Promise<{ id: number; version: number }> {
  const res = await authedFetch(accessToken, "/api/v1/poses", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, name: `Atomic SchemaVsUpdate ${code}` }),
  });
  assertNo5xx(res.status, "create pose (schema vs update)");
  expect(res.status).toBe(201);
  const json = (await safeJson(res)) as { id?: unknown; version?: unknown } | undefined;
  expect(typeof json?.id).toBe("number");
  expect(typeof json?.version).toBe("number");
  return { id: json?.id as number, version: json?.version as number };
}

async function getPoseVersion(accessToken: string, poseId: number): Promise<number> {
  const res = await authedFetch(accessToken, `/api/v1/poses/${poseId}`);
  assertNo5xx(res.status, "get pose (schema vs update)");
  expect(res.status).toBe(200);
  const json = (await safeJson(res)) as { version?: unknown } | undefined;
  expect(typeof json?.version).toBe("number");
  return json?.version as number;
}

async function updatePoseName(accessToken: string, poseId: number, version: number, name: string): Promise<Response> {
  return authedFetch(accessToken, `/api/v1/poses/${poseId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, version, change_note: "atomic schema-vs-update race" }),
  });
}

async function uploadSchema(accessToken: string, poseId: number): Promise<Response> {
  const form = new FormData();
  form.append("file", new Blob([tinyPng], { type: "image/png" }), "schema.png");
  return authedFetch(accessToken, `/api/v1/poses/${poseId}/schema`, {
    method: "POST",
    body: form,
  });
}

test.describe("Atomic regenerate hardening: schema upload vs update races (never 5xx)", () => {
  test.describe.configure({ mode: "serial" });

  test("concurrent schema upload + update yields 200/409 only (never 5xx)", async () => {
    const accessToken = (await loginWithToken(TEST_TOKEN)).accessToken;
    const code = `SUVURACE_${Date.now().toString(36).slice(-8)}`.slice(0, 20);
    const { id: poseId } = await createPose(accessToken, code);

    try {
      const iterations = getEnvInt("ATOMIC_SCHEMA_UPDATE_RACE_ITER", 24);
      const concurrency = Math.min(getEnvInt("ATOMIC_CONCURRENCY", 12), 6);

      const tasks = Array.from({ length: iterations }, (_v, i) => async () => {
        if (i % 2 === 0) {
          const res = await uploadSchema(accessToken, poseId);
          assertNo5xx(res.status, `upload schema#${i}`);
          return res.status;
        }

        const version = await getPoseVersion(accessToken, poseId);
        const res = await updatePoseName(accessToken, poseId, version, `U${i}-${code}`);
        assertNo5xx(res.status, `update#${i}`);
        return res.status;
      });

      const statuses = await concurrentAll(tasks, concurrency);
      expect(statuses.every((s) => [200, 409].includes(s))).toBeTruthy();

      const final = await authedFetch(accessToken, `/api/v1/poses/${poseId}`);
      assertNo5xx(final.status, "final pose fetch");
      expect(final.status).toBe(200);
    } finally {
      await authedFetch(accessToken, `/api/v1/poses/${poseId}`, { method: "DELETE" }).catch(
        () => undefined,
      );
    }
  });
});

