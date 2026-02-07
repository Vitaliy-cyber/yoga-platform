import { test, expect } from "@playwright/test";
import { assertNo5xx } from "./atomic-helpers";
import { authedFetch, loginWithToken, safeJson } from "./atomic-http";

const API_BASE_URL = process.env.PLAYWRIGHT_API_URL || "http://localhost:8000";

function resolveUrl(pathOrUrl: string): string {
  if (pathOrUrl.startsWith("http://") || pathOrUrl.startsWith("https://")) {
    return pathOrUrl;
  }
  return `${API_BASE_URL}${pathOrUrl.startsWith("/") ? "" : "/"}${pathOrUrl}`;
}

test.describe("Atomic regeneration", () => {
  test.describe.configure({ mode: "serial" });

  test("regenerate from pose schema (generate/from-pose + apply-generation)", async () => {
    const health = await fetch(`${API_BASE_URL}/health`).then((r) =>
      r.json().catch(() => null),
    );
    const aiEnabled = Boolean((health as { ai_enabled?: boolean } | null)?.ai_enabled);
    test.skip(!aiEnabled, "AI generation not enabled on backend (/health ai_enabled=false)");

    // Use an isolated pose to avoid cross-test conflicts when running atomic
    // with multiple Playwright workers.
    const tokenBase = process.env.E2E_TEST_TOKEN || "e2e-test-token-playwright-2024";
    const token = `${tokenBase}-regen-${test.info().workerIndex}-${Date.now().toString(36)}`;
    const { accessToken } = await loginWithToken(token);

    // Create pose
    const code = `RG_${Date.now().toString(36).slice(-10)}`.slice(0, 20);
    const createRes = await authedFetch(accessToken, "/api/v1/poses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, name: `Atomic Regen ${code}` }),
    });
    assertNo5xx(createRes.status, "create pose");
    expect(createRes.status).toBe(201);
    const poseId = ((await createRes.json()) as { id: number }).id;

    // Upload minimal schema (valid PNG bytes)
    const tinyPng = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=",
      "base64",
    );
    const form = new FormData();
    form.append("file", new Blob([tinyPng], { type: "image/png" }), "schema.png");
    const schemaRes = await fetch(`${API_BASE_URL}/api/v1/poses/${poseId}/schema`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
      body: form,
    });
    assertNo5xx(schemaRes.status, "upload schema");
    expect(schemaRes.status).toBe(200);

    const waitCompleted = async (taskId: string, timeoutMs: number = 60_000) => {
      const startedAt = Date.now();
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const st = await authedFetch(accessToken, `/api/v1/generate/status/${taskId}`);
        assertNo5xx(st.status, "generate/status");
        expect(st.status).toBe(200);
        const json = (await safeJson(st)) as { status?: string } | undefined;
        if (json?.status === "completed") return;
        if (json?.status === "failed") throw new Error("generation failed");
        if (Date.now() - startedAt > timeoutMs) throw new Error("generation timeout");
        // eslint-disable-next-line no-await-in-loop
        await new Promise((r) => setTimeout(r, 250));
      }
    };

    const applyWithRetry = async (taskId: string) => {
      for (let attempt = 0; attempt < 12; attempt += 1) {
        const res = await authedFetch(
          accessToken,
          `/api/v1/poses/${poseId}/apply-generation/${taskId}`,
          { method: "POST" },
        );
        assertNo5xx(res.status, "apply-generation");
        if (res.status === 200) return;
        if (res.status !== 409) {
          const txt = await res.text().catch(() => "");
          throw new Error(`unexpected apply status: ${res.status} ${txt}`);
        }
        // eslint-disable-next-line no-await-in-loop
        await new Promise((r) => setTimeout(r, 100));
      }
      throw new Error("apply-generation kept conflicting (409) after retries");
    };

    const runOnce = async (label: string) => {
      const genRes = await authedFetch(accessToken, `/api/v1/generate/from-pose/${poseId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ additional_notes: `Atomic regenerate ${label}` }),
      });
      assertNo5xx(genRes.status, "generate/from-pose");
      expect(genRes.status).toBe(200);
      const json = (await safeJson(genRes)) as { task_id?: string } | undefined;
      const taskId = json?.task_id || "";
      expect(taskId).toBeTruthy();
      await waitCompleted(taskId);
      await applyWithRetry(taskId);
      const poseRes = await authedFetch(accessToken, `/api/v1/poses/${poseId}`);
      assertNo5xx(poseRes.status, "get pose");
      expect(poseRes.status).toBe(200);
      return (await poseRes.json()) as {
        version?: number;
        photo_path?: string | null;
        muscle_layer_path?: string | null;
      };
    };

    try {
      const after1 = await runOnce("1");
      expect(after1.photo_path).toBeTruthy();
      expect(after1.muscle_layer_path).toBeTruthy();

      const after2 = await runOnce("2");
      expect((after2.version || 0)).toBeGreaterThan(after1.version || 0);
      expect(after2.photo_path).not.toBe(after1.photo_path);
      expect(after2.muscle_layer_path).not.toBe(after1.muscle_layer_path);

      for (const urlOrPath of [after2.photo_path!, after2.muscle_layer_path!]) {
        // eslint-disable-next-line no-await-in-loop
        const res = await fetch(resolveUrl(urlOrPath), { method: "GET" });
        expect(res.status, `status for ${urlOrPath}`).toBe(200);
      }
    } finally {
      await authedFetch(accessToken, `/api/v1/poses/${poseId}`, { method: "DELETE" }).catch(
        () => undefined,
      );
    }
  });
});
