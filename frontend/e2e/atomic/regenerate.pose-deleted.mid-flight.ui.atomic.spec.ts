import { test, expect } from "@playwright/test";
import { TEST_TOKEN } from "../fixtures";
import { authedFetch, loginWithToken } from "./atomic-http";
import { assertNo5xx, gotoWithRetry } from "./atomic-helpers";

const API_BASE_URL = process.env.PLAYWRIGHT_API_URL || "http://localhost:8000";

const tinyPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=",
  "base64",
);

async function createPose(accessToken: string, code: string): Promise<number> {
  const res = await authedFetch(accessToken, "/api/v1/poses", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, name: `Atomic Regen ${code}` }),
  });
  assertNo5xx(res.status, "create pose");
  expect(res.status).toBe(201);
  const json = (await res.json()) as { id: number };
  return json.id;
}

async function deletePose(accessToken: string, poseId: number): Promise<void> {
  await authedFetch(accessToken, `/api/v1/poses/${poseId}`, { method: "DELETE" }).catch(
    () => undefined,
  );
}

async function uploadSchema(accessToken: string, poseId: number): Promise<void> {
  const form = new FormData();
  form.append("file", new Blob([tinyPng], { type: "image/png" }), "schema.png");

  const res = await fetch(`${API_BASE_URL}/api/v1/poses/${poseId}/schema`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
    body: form,
  });
  assertNo5xx(res.status, "upload schema");
  expect(res.status).toBe(200);
}

async function ensureAiEnabled(): Promise<void> {
  const health = await fetch(`${API_BASE_URL}/health`).then((r) => r.json().catch(() => null));
  const aiEnabled = Boolean((health as { ai_enabled?: boolean } | null)?.ai_enabled);
  test.skip(!aiEnabled, "AI generation not enabled on backend (/health ai_enabled=false)");
}

async function waitCompleted(accessToken: string, taskId: string, timeoutMs: number = 60_000) {
  const startedAt = Date.now();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const st = await authedFetch(accessToken, `/api/v1/generate/status/${taskId}`);
    assertNo5xx(st.status, "generate/status");
    if (st.status !== 200) {
      const txt = await st.text().catch(() => "");
      throw new Error(`generate/status unexpected status: ${st.status} ${txt}`);
    }
    const json = (await st.json().catch(() => ({}))) as { status?: string };
    if (json.status === "completed") return;
    if (json.status === "failed") throw new Error("generation failed");
    if (Date.now() - startedAt > timeoutMs) throw new Error("generation timeout");
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, 250));
  }
}

async function applyWithRetry(accessToken: string, poseId: number, taskId: string) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const res = await authedFetch(accessToken, `/api/v1/poses/${poseId}/apply-generation/${taskId}`, {
      method: "POST",
    });
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
}

async function ensurePoseHasGeneratedPhoto(accessToken: string, poseId: number): Promise<void> {
  const genRes = await authedFetch(accessToken, `/api/v1/generate/from-pose/${poseId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ additional_notes: `Atomic initial generate ${Date.now()}` }),
  });
  assertNo5xx(genRes.status, "generate/from-pose initial");
  expect(genRes.status).toBe(200);
  const json = (await genRes.json()) as { task_id?: string };
  const taskId = json.task_id || "";
  expect(taskId).toBeTruthy();
  await waitCompleted(accessToken, taskId, 90_000);
  await applyWithRetry(accessToken, poseId, taskId);

  const poseRes = await authedFetch(accessToken, `/api/v1/poses/${poseId}`);
  assertNo5xx(poseRes.status, "get pose (post-initial-generate)");
  expect(poseRes.status).toBe(200);
  const poseJson = (await poseRes.json()) as { photo_path?: string | null };
  expect(poseJson.photo_path, "pose must have generated photo to show Regenerate").toBeTruthy();
}

function watchApi5xx(page: import("@playwright/test").Page): { get: () => Array<{ url: string; status: number }> } {
  const bad: Array<{ url: string; status: number }> = [];
  page.on("response", (res) => {
    const url = res.url();
    if (!url.includes("/api/v1/")) return;
    const status = res.status();
    if (status >= 500) bad.push({ url, status });
  });
  return { get: () => bad };
}

test.describe("Atomic regenerate flow: pose deleted mid-flight (no crash; no white screen; never 5xx)", () => {
  test.describe.configure({ mode: "serial" });

  test("deleting the pose during regeneration yields controlled UI state (404 ok, never 5xx)", async ({
    page,
  }) => {
    test.setTimeout(150_000);

    await ensureAiEnabled();

    await page.addInitScript(() => {
      (window as any).__atomicUnhandled = [];
      window.addEventListener("unhandledrejection", (event) => {
        (window as any).__atomicUnhandled.push({
          reason: String((event as PromiseRejectionEvent).reason || "unknown"),
        });
      });
    });

    const pageErrors: string[] = [];
    page.on("pageerror", (e) => pageErrors.push(String(e)));
    const api5xx = watchApi5xx(page);

    const { accessToken } = await loginWithToken(TEST_TOKEN);
    expect(accessToken).toBeTruthy();

    const code = `RGD${Date.now().toString(36).slice(-10)}`.slice(0, 20);
    const poseId = await createPose(accessToken, code);
    await uploadSchema(accessToken, poseId);
    await ensurePoseHasGeneratedPhoto(accessToken, poseId);

    try {
      await gotoWithRetry(page, `/poses/${poseId}`, { timeoutMs: 45_000 });
      await expect(page.getByTestId("pose-regenerate")).toBeVisible();
      await page.getByTestId("pose-regenerate").click();
      await expect(page.getByTestId("pose-regenerate-start")).toBeVisible();
      await page.getByTestId("pose-regenerate-feedback").fill("atomic: delete pose mid-flight");

      const startResPromise = page.waitForResponse((res) => {
        return (
          res.request().method() === "POST" &&
          res.url().includes(`/api/v1/generate/from-pose/${poseId}`)
        );
      });

      await page.getByTestId("pose-regenerate-start").click();
      const startRes = await startResPromise;
      assertNo5xx(startRes.status(), "generate/from-pose");
      expect(startRes.status()).toBe(200);
      const startJson = (await startRes.json()) as { task_id?: string };
      expect(typeof startJson.task_id).toBe("string");

      // Delete the pose as soon as the generation request is accepted.
      // The UI should survive 404s from status/apply/refresh and surface a controlled state.
      await deletePose(accessToken, poseId);

      // Expect either:
      // - The PoseDetail page surfaces a "not found" error (controlled), OR
      // - The modal surfaces a 404-ish error and allows retry.
      await Promise.race([
        page.getByText(/Pose not found|Поза не знайдена/i).waitFor({ timeout: 60_000 }),
        page.getByRole("dialog").locator("div.bg-red-50").waitFor({ timeout: 60_000 }),
      ]);

      expect(pageErrors, "pageerror indicates a client crash").toEqual([]);
      expect(api5xx.get(), "API 5xx detected during delete-mid-flight flow").toEqual([]);
      const unhandled = await page.evaluate(() => (window as any).__atomicUnhandled || []);
      expect(unhandled, "unhandledrejection indicates broken cleanup on delete").toEqual([]);
    } finally {
      // If delete didn't happen (unexpected), ensure cleanup.
      await deletePose(accessToken, poseId);
    }
  });
});
