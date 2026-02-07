import { test, expect } from "@playwright/test";
import { authedFetch, loginWithToken, safeJson } from "./atomic-http";
import { assertNo5xx, getEnvInt, concurrentAll } from "./atomic-helpers";

const USER1_TOKEN = process.env.E2E_TEST_TOKEN || "e2e-test-token-playwright-2024";
const USER2_TOKEN = process.env.E2E_TEST_TOKEN_2 || "e2e-test-token-playwright-2024-user-2";

type VersionList = { items: Array<{ id: number; version_number: number }>; total: number };

test.describe("Atomic versions ACL (multi-user, no enumeration)", () => {
  test.describe.configure({ mode: "serial" });

  const concurrency = getEnvInt("ATOMIC_CONCURRENCY", 10);
  let user1AccessToken = "";
  let user2AccessToken = "";
  let poseId: number | null = null;
  let versionIds: number[] = [];

  test.beforeAll(async () => {
    const [u1, u2] = await Promise.all([loginWithToken(USER1_TOKEN), loginWithToken(USER2_TOKEN)]);
    user1AccessToken = u1.accessToken;
    user2AccessToken = u2.accessToken;

    const code = `VACL${Date.now().toString(36).slice(-8)}`.slice(0, 20);
    const createRes = await authedFetch(user2AccessToken, "/api/v1/poses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, name: "Versions ACL Pose (u2)", description: "v1" }),
    });
    assertNo5xx(createRes.status, "user2 create pose for versions ACL");
    expect(createRes.status).toBe(201);
    poseId = ((await createRes.json()) as { id: number }).id;

    // Create a couple versions (retry 409 under contention)
    for (const desc of ["v2", "v3"]) {
      let updated = false;
      for (let attempt = 0; attempt < 12; attempt += 1) {
        // eslint-disable-next-line no-await-in-loop
        const getRes = await authedFetch(user2AccessToken, `/api/v1/poses/${poseId}`);
        assertNo5xx(getRes.status, "user2 get pose before versioning update");
        expect(getRes.status).toBe(200);
        // eslint-disable-next-line no-await-in-loop
        const pose = (await getRes.json()) as { version: number };
        // eslint-disable-next-line no-await-in-loop
        const putRes = await authedFetch(user2AccessToken, `/api/v1/poses/${poseId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ description: desc, version: pose.version, change_note: `atomic ${desc}` }),
        });
        assertNo5xx(putRes.status, "user2 update pose to create version");
        if (putRes.status === 200) {
          updated = true;
          break;
        }
        expect(putRes.status).toBe(409);
        // eslint-disable-next-line no-await-in-loop
        await new Promise((r) => setTimeout(r, 50 + attempt * 30));
      }
      expect(updated).toBeTruthy();
    }

    const listRes = await authedFetch(user2AccessToken, `/api/v1/poses/${poseId}/versions?skip=0&limit=10`);
    assertNo5xx(listRes.status, "user2 list versions");
    expect(listRes.status).toBe(200);
    const list = (await listRes.json()) as VersionList;
    versionIds = list.items.map((i) => i.id);
    expect(versionIds.length).toBeGreaterThan(0);
  });

  test.afterAll(async () => {
    if (!poseId) return;
    await authedFetch(user2AccessToken, `/api/v1/poses/${poseId}`, { method: "DELETE" }).catch(
      () => undefined,
    );
  });

  async function expectNoAccess(path: string, method: "GET" | "POST" = "GET"): Promise<number> {
    const res = await authedFetch(user1AccessToken, path, {
      method,
      headers: { Accept: "application/json" },
    });
    assertNo5xx(res.status, `user1 cross-tenant ${path}`);
    await safeJson(res);
    expect([403, 404]).toContain(res.status);
    return res.status;
  }

  test("user1 cannot list/count/read/restore/diff user2 versions", async () => {
    test.skip(!poseId, "pose not created");
    const v1 = versionIds[0] ?? 999999999;
    const v2 = versionIds[1] ?? v1;

    await expectNoAccess(`/api/v1/poses/${poseId}/versions?skip=0&limit=10`);
    await expectNoAccess(`/api/v1/poses/${poseId}/versions/count`);
    await expectNoAccess(`/api/v1/poses/${poseId}/versions/${v1}`);
    await expectNoAccess(`/api/v1/poses/${poseId}/versions/${v1}/restore`, "POST");
    await expectNoAccess(`/api/v1/poses/${poseId}/versions/${v1}/diff/${v2}`);
  });

  test("storm: cross-tenant versions endpoints never enumerate under concurrency", async () => {
    test.skip(!poseId, "pose not created");
    const v1 = versionIds[0] ?? 999999999;
    const v2 = versionIds[1] ?? v1;
    const paths: Array<{ path: string; method?: "GET" | "POST" }> = [
      { path: `/api/v1/poses/${poseId}/versions?skip=0&limit=10`, method: "GET" },
      { path: `/api/v1/poses/${poseId}/versions/count`, method: "GET" },
      { path: `/api/v1/poses/${poseId}/versions/${v1}`, method: "GET" },
      { path: `/api/v1/poses/${poseId}/versions/${v1}/restore`, method: "POST" },
      { path: `/api/v1/poses/${poseId}/versions/${v1}/diff/${v2}`, method: "GET" },
    ];
    const iterations = getEnvInt("ATOMIC_ITERATIONS", 40);
    const tasks = Array.from({ length: iterations }, (_, i) => async () => {
      const t = paths[i % paths.length];
      const res = await authedFetch(user1AccessToken, t.path, {
        method: t.method,
        headers: { Accept: "application/json" },
      });
      assertNo5xx(res.status, `storm cross-tenant ${t.method} ${t.path}`);
      await safeJson(res);
      return res.status;
    });
    const statuses = await concurrentAll(tasks, concurrency);
    expect(statuses.every((s) => s === 403 || s === 404)).toBeTruthy();
  });
});
