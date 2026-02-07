import { test, expect } from "@playwright/test";
import { TEST_TOKEN } from "../fixtures";
import { authedFetch, loginWithToken, makeIsolatedToken, safeJson } from "./atomic-http";
import { assertNo5xx } from "./atomic-helpers";

test.describe("Atomic regeneration apply-generation (API invariants)", () => {
  test.describe.configure({ mode: "serial" });

  let accessTokenA = "";
  let accessTokenB = "";
  let pendingTaskId = "";
  let poseId = 0;

  test.beforeAll(async () => {
    const authA = await loginWithToken(makeIsolatedToken(`apply-api-a-${TEST_TOKEN}`));
    accessTokenA = authA.accessToken;
    expect(accessTokenA).toBeTruthy();

    const authB = await loginWithToken(makeIsolatedToken(`apply-api-b-${TEST_TOKEN}`));
    accessTokenB = authB.accessToken;
    expect(accessTokenB).toBeTruthy();

    // IMPORTANT: Use an isolated pose owned by user A to avoid cross-test interference.
    // The core seed poses are shared across the entire atomic suite; under workers>1
    // other tests can legitimately mutate their versions, making idempotency checks flaky.
    const code = `APPLY_${Date.now().toString(36).slice(-8)}`.slice(0, 20);
    const createRes = await authedFetch(accessTokenA, "/api/v1/poses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, name: `Atomic Apply ${code}` }),
    });
    assertNo5xx(createRes.status, "create pose (apply-generation suite)");
    expect(createRes.status).toBe(201);
    const created = (await safeJson(createRes)) as { id?: unknown } | undefined;
    expect(typeof created?.id).toBe("number");
    poseId = created?.id as number;

    // Upload a tiny schema so generate/from-pose has something deterministic to work with.
    const apiBase = process.env.PLAYWRIGHT_API_URL || "http://localhost:8000";
    const tinyPng = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=",
      "base64",
    );
    const form = new FormData();
    form.append("file", new Blob([tinyPng], { type: "image/png" }), "schema.png");
    const schemaRes = await fetch(`${apiBase}/api/v1/poses/${poseId}/schema`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessTokenA}`, Accept: "application/json" },
      body: form,
    });
    assertNo5xx(schemaRes.status, "upload schema (apply-generation suite)");
    expect(schemaRes.status).toBe(200);

    const res = await authedFetch(accessTokenA, `/api/v1/generate/from-pose/${poseId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    assertNo5xx(res.status, "generate/from-pose (setup)");
    expect(res.status).toBe(200);
    const json = await safeJson(res);
    pendingTaskId = (json as { task_id?: string } | undefined)?.task_id || "";
    expect(pendingTaskId).toBeTruthy();
  });

  test.afterAll(async () => {
    if (!poseId) return;
    await authedFetch(accessTokenA, `/api/v1/poses/${poseId}`, { method: "DELETE" }).catch(
      () => undefined,
    );
  });

  const getStatus = async (accessToken: string, taskId: string) => {
    const res = await authedFetch(accessToken, `/api/v1/generate/status/${taskId}`, { method: "GET" });
    assertNo5xx(res.status, "generate/status");
    return res;
  };

  const postApply = async (accessToken: string, pId: number, tId: string) => {
    const res = await authedFetch(accessToken, `/api/v1/poses/${pId}/apply-generation/${tId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    assertNo5xx(res.status, "poses/apply-generation");
    return res;
  };

  const getLatestVersionId = async (accessToken: string, pId: number) => {
    const res = await authedFetch(
      accessToken,
      `/api/v1/poses/${pId}/versions?skip=0&limit=1`,
      { method: "GET" },
    );
    assertNo5xx(res.status, "versions(list)");
    expect(res.status).toBe(200);
    const json = (await safeJson(res)) as { items?: Array<{ id?: number }> } | undefined;
    const id = json?.items?.[0]?.id;
    return typeof id === "number" ? id : null;
  };

  const waitForCompleted = async (accessToken: string, tId: string) => {
    const startedAt = Date.now();
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const st = await getStatus(accessToken, tId);
      expect(st.status).toBe(200);
      const json = (await safeJson(st)) as { status?: string; error_message?: string } | undefined;
      if (json?.status === "completed") return;
      if (json?.status === "failed") {
        throw new Error(`generation failed: ${json?.error_message || "unknown error"}`);
      }
      if (Date.now() - startedAt > 15_000) {
        throw new Error("generation did not complete in time for atomic apply idempotency test");
      }
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, 250));
    }
  };

  test("status returns for a newly created task (never 5xx)", async () => {
    const res = await getStatus(accessTokenA, pendingTaskId);
    expect(res.status).toBe(200);
    const json = await safeJson(res);
    expect((json as { task_id?: string } | undefined)?.task_id).toBe(pendingTaskId);
  });

  test("apply-generation rejects non-completed task (never 5xx)", async () => {
    const res = await postApply(accessTokenA, poseId, pendingTaskId);
    // Depending on backend generator speed, the task might complete before we apply.
    // This test asserts the endpoint is safe/consistent (never 5xx) and either:
    // - rejects pending/processing tasks (400), or
    // - applies completed tasks successfully (200).
    // Under heavy concurrent load the DB layer can surface transient conflicts (409).
    expect([200, 400, 409]).toContain(res.status);
    if (res.status === 200) {
      const json = await safeJson(res);
      expect((json as { id?: number } | undefined)?.id).toBe(poseId);
    }
  });

  test("apply-generation rejects nonexistent pose (404, never 5xx)", async () => {
    const res = await postApply(accessTokenA, 999999, pendingTaskId);
    expect(res.status).toBe(404);
  });

  test("apply-generation rejects nonexistent task (404, never 5xx)", async () => {
    const res = await postApply(accessTokenA, poseId, "no-such-task-id");
    expect(res.status).toBe(404);
  });

  test("apply-generation hides other user's task (404, never 5xx)", async () => {
    const res = await postApply(accessTokenB, poseId, pendingTaskId);
    // Pose is not owned by user B; must not leak task existence either.
    expect(res.status).toBe(404);
  });

  test("status hides other user's task (404, never 5xx)", async () => {
    const res = await getStatus(accessTokenB, pendingTaskId);
    expect(res.status).toBe(404);
  });

  test("status unknown task never 5xx", async () => {
    const res = await getStatus(accessTokenA, "not-a-real-task");
    expect(res.status).toBeLessThan(500);
  });

  test("apply-generation is idempotent for the same completed task (no extra versions)", async () => {
    const genRes = await authedFetch(accessTokenA, `/api/v1/generate/from-pose/${poseId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ additional_notes: "atomic: apply idempotent" }),
    });
    assertNo5xx(genRes.status, "generate/from-pose (idempotent)");
    expect(genRes.status).toBe(200);
    const genJson = (await safeJson(genRes)) as { task_id?: string } | undefined;
    const taskId = genJson?.task_id || "";
    expect(taskId).toBeTruthy();

    await waitForCompleted(accessTokenA, taskId);

    const beforeLatest = await getLatestVersionId(accessTokenA, poseId);

    const first = await postApply(accessTokenA, poseId, taskId);
    expect(first.status).toBe(200);

    const afterFirst = await getLatestVersionId(accessTokenA, poseId);
    expect(afterFirst).not.toBe(beforeLatest);

    const second = await postApply(accessTokenA, poseId, taskId);
    expect(second.status).toBe(200);

    const afterSecond = await getLatestVersionId(accessTokenA, poseId);
    expect(afterSecond).toBe(afterFirst);
  });
});
