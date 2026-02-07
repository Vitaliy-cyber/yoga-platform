import { test, expect } from "@playwright/test";
import { TEST_TOKEN } from "../fixtures";
import { getCorePoseIdA } from "../test-data";
import { authedFetch, loginWithToken, safeJson } from "./atomic-http";
import { assertNo5xx } from "./atomic-helpers";

test.describe("Atomic regeneration creates version history", () => {
  test.describe.configure({ mode: "serial" });

  let accessToken = "";

  test.beforeAll(async () => {
    const auth = await loginWithToken(TEST_TOKEN);
    accessToken = auth.accessToken;
    expect(accessToken).toBeTruthy();
  });

  const getVersionCount = async (poseId: number) => {
    const res = await authedFetch(
      accessToken,
      `/api/v1/poses/${poseId}/versions/count`,
      { method: "GET" },
    );
    assertNo5xx(res.status, "versions/count");
    expect(res.status).toBe(200);
    const json = (await safeJson(res)) as { version_count?: number } | undefined;
    return Number(json?.version_count || 0);
  };

  const getLatestVersion = async (poseId: number) => {
    const res = await authedFetch(
      accessToken,
      `/api/v1/poses/${poseId}/versions?skip=0&limit=1`,
      { method: "GET" },
    );
    assertNo5xx(res.status, "versions(list)");
    expect(res.status).toBe(200);
    const json = (await safeJson(res)) as
      | { items?: Array<{ id?: number; change_note?: string | null }> }
      | undefined;
    const item = json?.items?.[0];
    const id = item?.id;
    return {
      id: typeof id === "number" ? id : null,
      changeNote: typeof item?.change_note === "string" ? item?.change_note : null,
    };
  };

  test("apply-generation creates a new PoseVersion (count increases)", async () => {
    const poseId = getCorePoseIdA();
    test.skip(!poseId, "Core seed pose not available");

    const before = await getVersionCount(poseId as number);
    const beforeLatest = await getLatestVersion(poseId as number);

    const genRes = await authedFetch(
      accessToken,
      `/api/v1/generate/from-pose/${poseId as number}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ additional_notes: "  atomic: version history check  " }),
      },
    );
    assertNo5xx(genRes.status, "generate/from-pose");
    expect(genRes.status).toBe(200);
    const genJson = (await safeJson(genRes)) as { task_id?: string } | undefined;
    expect(genJson?.task_id).toBeTruthy();

    // In E2E_FAST_AI mode this typically completes quickly; poll a bit.
    const taskId = genJson?.task_id as string;
    const startedAt = Date.now();
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const st = await authedFetch(
        accessToken,
        `/api/v1/generate/status/${taskId}`,
        { method: "GET" },
      );
      assertNo5xx(st.status, "generate/status");
      expect(st.status).toBe(200);
      const stJson = (await safeJson(st)) as { status?: string } | undefined;
      if (stJson?.status === "completed") break;
      if (Date.now() - startedAt > 10_000) {
        throw new Error("generation did not complete in time for atomic version test");
      }
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, 250));
    }

    const applyRes = await authedFetch(
      accessToken,
      `/api/v1/poses/${poseId as number}/apply-generation/${taskId}`,
      { method: "POST" },
    );
    assertNo5xx(applyRes.status, "poses/apply-generation");
    expect(applyRes.status).toBe(200);

    const after = await getVersionCount(poseId as number);
    // Version history is capped (MAX_VERSIONS_PER_POSE=50). If we're at the cap,
    // total count may stay the same even though a new latest version is created.
    if (before < 50) {
      expect(after).toBeGreaterThan(before);
    } else {
      expect(after).toBe(before);
    }

    const afterLatest = await getLatestVersion(poseId as number);
    if (beforeLatest.id === null) {
      expect(afterLatest.id).not.toBeNull();
    } else {
      expect(afterLatest.id).not.toBe(beforeLatest.id);
    }

    // Regression guard: user notes must be included in the version change_note,
    // and notes should be normalized (trimmed) server-side.
    expect(afterLatest.changeNote).toContain("Notes:");
    expect(afterLatest.changeNote).toContain("atomic: version history check");
  });
});
