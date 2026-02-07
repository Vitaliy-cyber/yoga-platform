import { test, expect } from "@playwright/test";
import { TEST_TOKEN } from "../fixtures";
import { authedFetch, loginWithToken, safeJson } from "./atomic-http";
import { assertNo5xx, concurrentAll } from "./atomic-helpers";

test.describe("Atomic regeneration concurrent apply-generation (no 5xx)", () => {
  test.describe.configure({ mode: "serial" });

  const API_BASE_URL = process.env.PLAYWRIGHT_API_URL || "http://localhost:8000";
  const tinyPng = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=",
    "base64",
  );

  let accessToken = "";
  let poseId: number | null = null;

  test.beforeAll(async () => {
    const auth = await loginWithToken(TEST_TOKEN);
    accessToken = auth.accessToken;
    expect(accessToken).toBeTruthy();

    // Create an isolated pose + schema so this test is safe even when the atomic suite
    // is executed with multiple Playwright workers (no shared seed pose mutations).
    const code = `APPLY_${Date.now().toString(36).slice(-10)}`.slice(0, 20);
    const createRes = await authedFetch(accessToken, "/api/v1/poses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, name: `Atomic Apply ${code}` }),
    });
    assertNo5xx(createRes.status, "create pose");
    expect(createRes.status).toBe(201);
    poseId = ((await createRes.json()) as { id: number }).id;

    const form = new FormData();
    form.append("file", new Blob([tinyPng], { type: "image/png" }), "schema.png");
    const schemaRes = await fetch(`${API_BASE_URL}/api/v1/poses/${poseId}/schema`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
      body: form,
    });
    assertNo5xx(schemaRes.status, "upload schema");
    expect(schemaRes.status).toBe(200);
  });

  test.afterAll(async () => {
    if (!poseId) return;
    await authedFetch(accessToken, `/api/v1/poses/${poseId}`, { method: "DELETE" }).catch(
      () => undefined,
    );
  });

  async function waitCompleted(taskId: string, timeoutMs: number = 20_000) {
    const startedAt = Date.now();
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const st = await authedFetch(accessToken, `/api/v1/generate/status/${taskId}`, { method: "GET" });
      assertNo5xx(st.status, "generate/status");
      expect(st.status).toBe(200);
      const json = (await safeJson(st)) as { status?: string } | undefined;
      if (json?.status === "completed") return;
      if (Date.now() - startedAt > timeoutMs) {
        throw new Error(`task did not complete in time: ${taskId}`);
      }
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, 250));
    }
  }

  test("concurrent apply-generation does not 5xx (200/409 only)", async () => {
    test.skip(!poseId, "pose not created");

    // Create multiple generation tasks quickly.
    const createTasks = Array.from({ length: 5 }, (_, i) => async () => {
      const res = await authedFetch(accessToken, `/api/v1/generate/from-pose/${poseId as number}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ additional_notes: `atomic concurrent apply #${i}` }),
      });
      assertNo5xx(res.status, "generate/from-pose");
      expect(res.status).toBe(200);
      const json = (await safeJson(res)) as { task_id?: string } | undefined;
      const taskId = json?.task_id;
      expect(taskId).toBeTruthy();
      await waitCompleted(taskId as string);
      return taskId as string;
    });

    const taskIds = await concurrentAll(createTasks, 2);
    expect(taskIds.length).toBe(5);

    const applyTasks = taskIds.map((taskId) => async () => {
      const res = await authedFetch(
        accessToken,
        `/api/v1/poses/${poseId as number}/apply-generation/${taskId}`,
        { method: "POST" },
      );
      assertNo5xx(res.status, "poses/apply-generation");
      expect([200, 409]).toContain(res.status);
      return res.status;
    });

    const statuses = await concurrentAll(applyTasks, 5);
    expect(statuses.some((s) => s === 200)).toBeTruthy();
  });
});
