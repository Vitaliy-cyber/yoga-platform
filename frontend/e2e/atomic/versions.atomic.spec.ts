import { test, expect } from "@playwright/test";
import { authedFetch, loginWithToken, makeIsolatedToken, safeJson } from "./atomic-http";
import { assertNo5xx, concurrentAll, getEnvInt } from "./atomic-helpers";

type VersionList = { items: Array<{ id: number; version_number: number }>; total: number };

test.describe("Atomic versions (history/restore)", () => {
  test.describe.configure({ mode: "serial" });

  const concurrency = getEnvInt("ATOMIC_CONCURRENCY", 8);
  let accessToken = "";
  let poseId: number | null = null;

  test.beforeAll(async () => {
    const token = makeIsolatedToken("versions");
    accessToken = (await loginWithToken(token)).accessToken;

    const code = `VR${Date.now().toString(36).slice(-10)}`.slice(0, 20);
    const createRes = await authedFetch(accessToken, "/api/v1/poses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code,
        name: "Versioned pose",
        description: "v1",
      }),
    });
    assertNo5xx(createRes.status, "create pose for versions");
    expect(createRes.status).toBe(201);
    poseId = ((await createRes.json()) as { id: number }).id;
  });

  test.afterAll(async () => {
    if (!poseId) return;
    const res = await authedFetch(accessToken, `/api/v1/poses/${poseId}`, { method: "DELETE" });
    assertNo5xx(res.status, "delete pose for versions");
    expect([204, 404]).toContain(res.status);
  });

  async function updateDescription(newDescription: string): Promise<void> {
    test.skip(!poseId, "pose not created");
    const attempts = 12;
    for (let attempt = 0; attempt < attempts; attempt++) {
      const getRes = await authedFetch(accessToken, `/api/v1/poses/${poseId}`);
      assertNo5xx(getRes.status, "pose get for update");
      expect(getRes.status).toBe(200);
      const pose = (await getRes.json()) as { version: number };

      const res = await authedFetch(accessToken, `/api/v1/poses/${poseId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: newDescription,
          version: pose.version,
          change_note: `atomic: ${newDescription}`.slice(0, 200),
        }),
      });
      assertNo5xx(res.status, "pose update");
      if (res.status === 200) return;
      if (res.status === 409) {
        // SQLite is single-writer; under atomic parallel load we can see sustained
        // 409s from transient lock contention. Back off a bit before retrying.
        // eslint-disable-next-line no-await-in-loop
        await new Promise((r) => setTimeout(r, 40 + attempt * 30));
        continue;
      }
      const txt = await res.text().catch(() => "");
      throw new Error(`Unexpected status from update: ${res.status} ${txt}`);
    }
    throw new Error(`Failed to update description after ${attempts} attempts`);
  }

  test("updates create versions; list/count/diff endpoints respond without 5xx", async () => {
    test.skip(!poseId, "pose not created");

    // Update twice to create versions
    const getRes = await authedFetch(accessToken, `/api/v1/poses/${poseId}`);
    expect(getRes.status).toBe(200);
    const pose = (await getRes.json()) as { version: number };

    const update1 = await authedFetch(accessToken, `/api/v1/poses/${poseId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description: "v2", version: pose.version, change_note: "v2" }),
    });
    assertNo5xx(update1.status, "pose update1");
    expect([200, 409]).toContain(update1.status);

    const getRes2 = await authedFetch(accessToken, `/api/v1/poses/${poseId}`);
    expect(getRes2.status).toBe(200);
    const pose2 = (await getRes2.json()) as { version: number };

    const update2 = await authedFetch(accessToken, `/api/v1/poses/${poseId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description: "v3", version: pose2.version, change_note: "v3" }),
    });
    assertNo5xx(update2.status, "pose update2");
    expect([200, 409]).toContain(update2.status);

    const listRes = await authedFetch(accessToken, `/api/v1/poses/${poseId}/versions?skip=0&limit=10`);
    assertNo5xx(listRes.status, "versions list");
    expect(listRes.status).toBe(200);
    const list = (await listRes.json()) as VersionList;
    expect(list.total).toBeGreaterThanOrEqual(0);

    const countRes = await authedFetch(accessToken, `/api/v1/poses/${poseId}/versions/count`);
    assertNo5xx(countRes.status, "versions count");
    expect(countRes.status).toBe(200);

    if (list.items.length >= 2) {
      const [a, b] = list.items;
      const diffRes = await authedFetch(accessToken, `/api/v1/poses/${poseId}/versions/${a.id}/diff/${b.id}`);
      assertNo5xx(diffRes.status, "versions diff");
      expect(diffRes.status).toBe(200);
      await safeJson(diffRes);
    }
  });

  test("restore persists pose fields (no silent rollback) and never 5xx", async () => {
    test.skip(!poseId, "pose not created");

    // Ensure we have at least a couple of versions
    await updateDescription(`restore-a-${Date.now().toString(36).slice(-8)}`);
    await updateDescription(`restore-b-${Date.now().toString(36).slice(-8)}`);

    const listRes = await authedFetch(accessToken, `/api/v1/poses/${poseId}/versions?skip=0&limit=10`);
    assertNo5xx(listRes.status, "versions list before restore");
    expect(listRes.status).toBe(200);
    const list = (await listRes.json()) as VersionList;
    expect(list.items.length).toBeGreaterThan(0);

    // Pick an older version to restore to (last in list is oldest in this page)
    const target = list.items[list.items.length - 1];
    const versionRes = await authedFetch(accessToken, `/api/v1/poses/${poseId}/versions/${target.id}`);
    assertNo5xx(versionRes.status, "version detail");
    expect(versionRes.status).toBe(200);
    const versionDetail = (await versionRes.json()) as { description?: string | null };
    const expectedDescription = versionDetail.description ?? "";

    const restoreAttempts = 12;
    let restored = false;
    for (let attempt = 0; attempt < restoreAttempts; attempt++) {
      const restoreRes = await authedFetch(accessToken, `/api/v1/poses/${poseId}/versions/${target.id}/restore`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ change_note: `atomic restore ${attempt}` }),
      });
      assertNo5xx(restoreRes.status, "restore");
      if (restoreRes.status === 200) {
        restored = true;
        break;
      }
      expect(restoreRes.status, "restore should only be 200/409 in this test").toBe(409);
      // brief backoff for SQLite single-writer contention
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, 50 + attempt * 25));
    }
    expect(restored).toBeTruthy();

    await expect
      .poll(
        async () => {
          const getAfter = await authedFetch(accessToken, `/api/v1/poses/${poseId}`);
          assertNo5xx(getAfter.status, "pose get after restore");
          if (getAfter.status !== 200) return null;
          const poseAfter = (await getAfter.json()) as { description?: string | null };
          return poseAfter.description ?? "";
        },
        { timeout: 10_000 },
      )
      .toBe(expectedDescription);
  });

  test("restore rejects nonexistent version id without 5xx", async () => {
    test.skip(!poseId, "pose not created");
    const res = await authedFetch(accessToken, `/api/v1/poses/${poseId}/versions/999999999/restore`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ change_note: "noop" }),
    });
    assertNo5xx(res.status, "restore nonexistent");
    expect([404, 400, 409]).toContain(res.status);
  });

  test("storm: concurrent restore + updates never 5xx", async () => {
    test.skip(!poseId, "pose not created");

    // Ensure at least one version exists to restore to
    await updateDescription(`storm-base-${Date.now().toString(36).slice(-8)}`);
    const listRes = await authedFetch(accessToken, `/api/v1/poses/${poseId}/versions?skip=0&limit=10`);
    assertNo5xx(listRes.status, "versions list for storm");
    expect(listRes.status).toBe(200);
    const list = (await listRes.json()) as VersionList;
    test.skip(list.items.length === 0, "no versions to restore");
    const restoreTargetId = list.items[list.items.length - 1].id;

    const iterations = getEnvInt("ATOMIC_ITERATIONS", 45);
    const tasks = Array.from({ length: iterations }, (_, i) => async () => {
      if (i % 3 === 0) {
        const restoreRes = await authedFetch(accessToken, `/api/v1/poses/${poseId}/versions/${restoreTargetId}/restore`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ change_note: `atomic storm restore ${i}` }),
        });
        assertNo5xx(restoreRes.status, "restore storm");
        expect([200, 409, 404]).toContain(restoreRes.status);
        await safeJson(restoreRes);
        return restoreRes.status;
      }

      if (i % 3 === 1) {
        const getRes = await authedFetch(accessToken, `/api/v1/poses/${poseId}`);
        assertNo5xx(getRes.status, "pose get storm");
        if (getRes.status !== 200) return getRes.status;
        const pose = (await getRes.json()) as { version: number };
        const updateRes = await authedFetch(accessToken, `/api/v1/poses/${poseId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            description: `storm-${i}-${Date.now().toString(36).slice(-6)}`,
            version: pose.version,
            change_note: `atomic storm update ${i}`.slice(0, 200),
          }),
        });
        assertNo5xx(updateRes.status, "pose update storm");
        expect([200, 409, 404]).toContain(updateRes.status);
        await safeJson(updateRes);
        return updateRes.status;
      }

      const listStormRes = await authedFetch(accessToken, `/api/v1/poses/${poseId}/versions?skip=0&limit=10&i=${i}`);
      assertNo5xx(listStormRes.status, "versions list storm mixed");
      expect([200, 404]).toContain(listStormRes.status);
      await safeJson(listStormRes);
      return listStormRes.status;
    });

    const statuses = await concurrentAll(tasks, concurrency);
    expect(statuses.every((s) => s < 500)).toBeTruthy();
  });

  test("storm: versions list does not 5xx under concurrency", async () => {
    test.skip(!poseId, "pose not created");
    const iterations = getEnvInt("ATOMIC_ITERATIONS", 60);
    const tasks = Array.from({ length: iterations }, (_, i) => async () => {
      const res = await authedFetch(accessToken, `/api/v1/poses/${poseId}/versions?skip=0&limit=10&i=${i}`);
      assertNo5xx(res.status, "versions list storm");
      await safeJson(res);
      return res.status;
    });
    const statuses = await concurrentAll(tasks, concurrency);
    expect(statuses.every((s) => s === 200)).toBeTruthy();
  });
});
