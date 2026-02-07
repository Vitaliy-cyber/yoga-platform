import { test, expect } from "@playwright/test";
import { assertNo5xx, concurrentAll, getEnvInt } from "./atomic-helpers";
import { authedFetch, loginWithToken, safeJson } from "./atomic-http";

const API_BASE_URL = process.env.PLAYWRIGHT_API_URL || "http://localhost:8000";
const USER1_TOKEN =
  process.env.E2E_TEST_TOKEN || "e2e-test-token-playwright-2024";

async function createPose(accessToken: string, code: string): Promise<{ id: number; version: number }> {
  const res = await fetch(`${API_BASE_URL}/api/v1/poses`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ code, name: `Race ${code}` }),
  });
  assertNo5xx(res.status, "create pose");
  expect(res.status).toBe(201);
  const json = (await safeJson(res)) as { id?: unknown; version?: unknown } | undefined;
  expect(typeof json?.id).toBe("number");
  expect(typeof json?.version).toBe("number");
  return { id: json?.id as number, version: json?.version as number };
}

async function getPose(accessToken: string, id: number): Promise<{ version: number }> {
  const res = await authedFetch(accessToken, `/api/v1/poses/${id}`);
  assertNo5xx(res.status, "get pose");
  expect(res.status).toBe(200);
  const json = (await safeJson(res)) as { version?: unknown } | undefined;
  expect(typeof json?.version).toBe("number");
  return { version: json?.version as number };
}

async function updatePoseName(accessToken: string, id: number, version: number, name: string): Promise<Response> {
  return fetch(`${API_BASE_URL}/api/v1/poses/${id}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ name, version, change_note: "atomic race" }),
  });
}

async function listVersions(accessToken: string, id: number): Promise<number[]> {
  const res = await authedFetch(accessToken, `/api/v1/poses/${id}/versions?skip=0&limit=100`);
  assertNo5xx(res.status, "list versions");
  expect(res.status).toBe(200);
  const json = (await safeJson(res)) as { items?: unknown } | undefined;
  expect(Array.isArray((json as any)?.items)).toBeTruthy();
  const items = (json as any).items as Array<{ id?: number }>;
  return items.map((it) => it.id).filter((v): v is number => typeof v === "number");
}

async function restoreVersion(accessToken: string, poseId: number, versionId: number): Promise<Response> {
  return fetch(`${API_BASE_URL}/api/v1/poses/${poseId}/versions/${versionId}/restore`, {
    method: "POST",
    headers: { Accept: "application/json", Authorization: `Bearer ${accessToken}` },
  });
}

async function deletePose(accessToken: string, id: number): Promise<void> {
  const res = await authedFetch(accessToken, `/api/v1/poses/${id}`, { method: "DELETE" });
  assertNo5xx(res.status, "delete pose");
  expect([204, 404]).toContain(res.status);
}

test.describe("Atomic versions restore/update races (break-it; no 5xx)", () => {
  test.describe.configure({ mode: "serial" });

  test("concurrent restore + update yields 200/409 only (never 5xx)", async () => {
    const accessToken = (await loginWithToken(USER1_TOKEN)).accessToken;
    const code = `VRACE_${Date.now().toString(36).slice(-8)}`.slice(0, 20);
    const { id: poseId } = await createPose(accessToken, code);

    try {
      // Create at least one committed update so the versions list is non-empty even
      // under heavy concurrent load (SQLite can return 409 conflicts transiently).
      const seedAttempts = 15;
      let seededOk = 0;
      for (let i = 0; i < seedAttempts && seededOk < 2; i += 1) {
        const current = await getPose(accessToken, poseId);
        const r = await updatePoseName(
          accessToken,
          poseId,
          current.version,
          `V${seededOk}-${code}-${i}`,
        );
        assertNo5xx(r.status, `seed update#${i}`);
        if (r.status === 200) seededOk += 1;
        else expect(r.status).toBe(409);
      }

      const versionIds = await listVersions(accessToken, poseId);
      expect(versionIds.length).toBeGreaterThan(0);
      const oldestVersionId = versionIds[versionIds.length - 1];

      const iterations = getEnvInt("ATOMIC_VERSIONS_RESTORE_RACE_ITER", 12);
      const concurrency = Math.min(getEnvInt("ATOMIC_CONCURRENCY", 12), 6);

      const tasks = Array.from({ length: iterations }, (_v, i) => async () => {
        if (i % 2 === 0) {
          const res = await restoreVersion(accessToken, poseId, oldestVersionId);
          assertNo5xx(res.status, `restore#${i}`);
          return res.status;
        }

        const current = await getPose(accessToken, poseId);
        const res = await updatePoseName(accessToken, poseId, current.version, `U${i}-${code}`);
        assertNo5xx(res.status, `update#${i}`);
        return res.status;
      });

      const statuses = await concurrentAll(tasks, concurrency);
      expect(statuses.every((s) => [200, 409].includes(s))).toBeTruthy();

      const finalPose = await authedFetch(accessToken, `/api/v1/poses/${poseId}`);
      assertNo5xx(finalPose.status, "final pose fetch");
      expect(finalPose.status).toBe(200);
    } finally {
      await deletePose(accessToken, poseId);
    }
  });
});
