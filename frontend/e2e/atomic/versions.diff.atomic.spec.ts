import { test, expect } from "@playwright/test";
import { assertNo5xx, concurrentAll, getEnvInt } from "./atomic-helpers";
import { authedFetch, loginWithToken, makeIsolatedToken, safeJson } from "./atomic-http";

const API_BASE_URL = process.env.PLAYWRIGHT_API_URL || "http://localhost:8000";

async function createPose(accessToken: string, code: string): Promise<number> {
  const res = await authedFetch(accessToken, "/api/v1/poses", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, name: `Diff ${code}` }),
  });
  assertNo5xx(res.status, "create pose");
  expect(res.status).toBe(201);
  const json = (await safeJson(res)) as { id?: unknown } | undefined;
  expect(typeof json?.id).toBe("number");
  return json?.id as number;
}

async function getPoseVersion(accessToken: string, poseId: number): Promise<number> {
  const res = await authedFetch(accessToken, `/api/v1/poses/${poseId}`);
  assertNo5xx(res.status, "get pose");
  expect(res.status).toBe(200);
  const json = (await safeJson(res)) as { version?: unknown } | undefined;
  expect(typeof json?.version).toBe("number");
  return json?.version as number;
}

async function updatePoseName(
  accessToken: string,
  poseId: number,
  version: number,
  name: string,
): Promise<Response> {
  return authedFetch(accessToken, `/api/v1/poses/${poseId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, version, change_note: "atomic versions diff" }),
  });
}

async function listVersionIds(accessToken: string, poseId: number): Promise<number[]> {
  // Under heavy atomic stress (multiple Playwright workers + internal concurrency),
  // SQLite can briefly return 409 while reads are contended. Treat 409 as transient
  // and retry so this test focuses on "no 5xx / no leaks" invariants.
  const maxAttempts = 16;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const res = await authedFetch(accessToken, `/api/v1/poses/${poseId}/versions?skip=0&limit=100`);
    assertNo5xx(res.status, "list versions");
    if (res.status === 200) {
      const json = (await safeJson(res)) as { items?: unknown } | undefined;
      const items = (json as any)?.items as Array<{ id?: unknown }> | undefined;
      expect(Array.isArray(items)).toBeTruthy();
      return (items || []).map((it) => it.id).filter((v): v is number => typeof v === "number");
    }
    if (res.status !== 409) {
      expect(res.status).toBe(200);
    }
    const sleepMs = Math.min(25 * 2 ** Math.min(attempt, 5), 800);
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, sleepMs));
  }
  throw new Error(`list versions did not succeed after ${maxAttempts} attempts (pose=${poseId})`);
}

async function deletePose(accessToken: string, poseId: number): Promise<void> {
  const res = await authedFetch(accessToken, `/api/v1/poses/${poseId}`, { method: "DELETE" });
  assertNo5xx(res.status, "delete pose");
  expect([204, 404]).toContain(res.status);
}

test.describe("Atomic versions diff (break-it; no 5xx, no info leaks)", () => {
  test.describe.configure({ mode: "serial" });

  test("diff between two versions returns 200 and structured differences", async () => {
    const { accessToken } = await loginWithToken(makeIsolatedToken("versions-diff"));
    const code = `VDIFF_${Date.now().toString(36).slice(-8)}`.slice(0, 20);
    const poseId = await createPose(accessToken, code);

    try {
      // Seed multiple committed updates to ensure we have at least 2 versions IDs.
      const seedAttempts = 20;
      let ok = 0;
      for (let i = 0; i < seedAttempts && ok < 2; i += 1) {
        const v = await getPoseVersion(accessToken, poseId);
        const r = await updatePoseName(accessToken, poseId, v, `N${ok}-${code}-${i}`);
        assertNo5xx(r.status, `seed update#${i}`);
        if (r.status === 200) ok += 1;
        else expect(r.status).toBe(409);
      }

      const versionIds = await listVersionIds(accessToken, poseId);
      expect(versionIds.length).toBeGreaterThanOrEqual(2);
      const [v1, v2] = versionIds.slice(0, 2);

      const res = await authedFetch(accessToken, `/api/v1/poses/${poseId}/versions/${v1}/diff/${v2}`);
      assertNo5xx(res.status, "diff versions");
      expect(res.status).toBe(200);
      const body = (await safeJson(res)) as { differences?: unknown } | undefined;
      expect(Array.isArray(body?.differences)).toBeTruthy();
    } finally {
      await deletePose(accessToken, poseId);
    }
  });

  test("diff does not allow cross-pose version IDs (404/422 only; never 5xx)", async () => {
    const { accessToken } = await loginWithToken(makeIsolatedToken("versions-diff-xpose"));
    const codeA = `VDXA_${Date.now().toString(36).slice(-8)}`.slice(0, 20);
    const codeB = `VDXB_${Date.now().toString(36).slice(-8)}`.slice(0, 20);
    const poseA = await createPose(accessToken, codeA);
    const poseB = await createPose(accessToken, codeB);

    try {
      const ensureAtLeastOneVersion = async (pId: number) => {
        for (let attempt = 0; attempt < 32; attempt += 1) {
          const v = await getPoseVersion(accessToken, pId);
          const r = await updatePoseName(accessToken, pId, v, `S-${pId}-${attempt}-${Date.now()}`);
          assertNo5xx(r.status, `seed update#${pId}:${attempt}`);
          if (r.status === 200) return;
          expect(r.status).toBe(409);
          // Under full-suite stress we can hit sustained SQLite contention. Back off a bit.
          const sleepMs = Math.min(25 * 2 ** Math.min(attempt, 4), 250);
          // eslint-disable-next-line no-await-in-loop
          await new Promise((rr) => setTimeout(rr, sleepMs));
        }
        throw new Error(`Could not create any version for pose ${pId} under contention`);
      };
      await ensureAtLeastOneVersion(poseA);
      await ensureAtLeastOneVersion(poseB);

      const aIds = await listVersionIds(accessToken, poseA);
      const bIds = await listVersionIds(accessToken, poseB);
      expect(aIds.length).toBeGreaterThan(0);
      expect(bIds.length).toBeGreaterThan(0);

      const res = await authedFetch(accessToken, `/api/v1/poses/${poseA}/versions/${aIds[0]}/diff/${bIds[0]}`);
      assertNo5xx(res.status, "diff cross pose");
      expect([404, 422]).toContain(res.status);
      if (res.status === 404) {
        const txt = await res.text();
        expect(txt.toLowerCase()).not.toContain("traceback");
        expect(txt.toLowerCase()).not.toContain("sqlalchemy");
      }
    } finally {
      await deletePose(accessToken, poseA);
      await deletePose(accessToken, poseB);
    }
  });

  test("diff is safe under concurrency (200/404/409/422 only; never 5xx)", async () => {
    const { accessToken } = await loginWithToken(makeIsolatedToken("versions-diff-race"));
    const code = `VDR_${Date.now().toString(36).slice(-8)}`.slice(0, 20);
    const poseId = await createPose(accessToken, code);

    try {
      // Create a few versions.
      for (let i = 0; i < 3; i += 1) {
        const v = await getPoseVersion(accessToken, poseId);
        const r = await updatePoseName(accessToken, poseId, v, `Race-${i}-${code}`);
        assertNo5xx(r.status, `seed update#${i}`);
        expect([200, 409]).toContain(r.status);
      }

      const versionIds = await listVersionIds(accessToken, poseId);
      expect(versionIds.length).toBeGreaterThan(0);

      const iterations = getEnvInt("ATOMIC_VERSIONS_DIFF_RACE_ITER", 24);
      const concurrency = Math.min(getEnvInt("ATOMIC_CONCURRENCY", 12), 6);

      const tasks = Array.from({ length: iterations }, (_v, i) => async () => {
        if (i % 3 === 0) {
          const v = await getPoseVersion(accessToken, poseId);
          const r = await updatePoseName(accessToken, poseId, v, `U${i}-${code}`);
          assertNo5xx(r.status, `update#${i}`);
          return r.status;
        }

        const ids = await listVersionIds(accessToken, poseId);
        const a = ids[0] || 0;
        const b = ids[1] || ids[0] || 0;
        const r = await authedFetch(accessToken, `/api/v1/poses/${poseId}/versions/${a}/diff/${b}`);
        assertNo5xx(r.status, `diff#${i}`);
        return r.status;
      });

      const statuses = await concurrentAll(tasks, concurrency);
      expect(statuses.every((s) => [200, 404, 409, 422].includes(s))).toBeTruthy();
    } finally {
      await deletePose(accessToken, poseId);
    }
  });

  test("diff enforces ownership (other user gets 404; never 5xx)", async () => {
    const userA = await loginWithToken(makeIsolatedToken("versions-diff-owner-a"));
    const userB = await loginWithToken(makeIsolatedToken("versions-diff-owner-b"));

    const code = `VDO_${Date.now().toString(36).slice(-8)}`.slice(0, 20);
    const poseId = await createPose(userA.accessToken, code);

    try {
      // Ensure at least one version exists for user A.
      for (let i = 0; i < 6; i += 1) {
        const v = await getPoseVersion(userA.accessToken, poseId);
        const r = await updatePoseName(userA.accessToken, poseId, v, `Owner-${i}-${code}`);
        assertNo5xx(r.status, `seed update#${i}`);
        if (r.status === 200) break;
        expect(r.status).toBe(409);
      }

      const versionIds = await listVersionIds(userA.accessToken, poseId);
      expect(versionIds.length).toBeGreaterThan(0);

      const v1 = versionIds[0];
      const v2 = versionIds[1] || versionIds[0];

      const res = await authedFetch(
        userB.accessToken,
        `/api/v1/poses/${poseId}/versions/${v1}/diff/${v2}`,
      );
      assertNo5xx(res.status, "diff other user's pose");
      expect([404, 422]).toContain(res.status);
      const txt = await res.text();
      expect(txt.toLowerCase()).not.toContain("traceback");
      expect(txt.toLowerCase()).not.toContain("sqlalchemy");
    } finally {
      await deletePose(userA.accessToken, poseId);
    }
  });
});
