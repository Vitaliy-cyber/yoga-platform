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

test.describe("Atomic regenerate flow: navigation/refresh during generation (no white screen; no unhandledrejection)", () => {
  test.describe.configure({ mode: "serial" });

  test("route change + reload while generating does not crash and UI remains usable", async ({ page }) => {
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

    const code = `RGR${Date.now().toString(36).slice(-10)}`.slice(0, 20);
    const poseId = await createPose(accessToken, code);
    await uploadSchema(accessToken, poseId);
    await ensurePoseHasGeneratedPhoto(accessToken, poseId);

    try {
      await gotoWithRetry(page, `/poses/${poseId}`, { timeoutMs: 45_000 });
      await expect(page.getByTestId("pose-regenerate")).toBeVisible();
      await page.getByTestId("pose-regenerate").click();
      await expect(page.getByTestId("pose-regenerate-start")).toBeVisible();
      await page.getByTestId("pose-regenerate-feedback").fill("atomic: navigate/refresh while generating");

      await page.getByTestId("pose-regenerate-start").click();

      // Ensure generation actually started so navigation/reload happens mid-flight.
      await expect(page.getByTestId("pose-regenerate-progress")).toBeVisible({ timeout: 30_000 });

      // 1) Navigate away while modal is generating (unmount path).
      await gotoWithRetry(page, "/poses", { timeoutMs: 45_000 });
      await expect(page.getByTestId("pose-gallery-count")).toBeVisible({ timeout: 45_000 });

      // 2) Navigate back, start again, then reload immediately (refresh path).
      await gotoWithRetry(page, `/poses/${poseId}`, { timeoutMs: 45_000 });
      await expect(page.getByTestId("pose-regenerate")).toBeVisible();
      await page.getByTestId("pose-regenerate").click();
      await expect(page.getByTestId("pose-regenerate-start")).toBeVisible();
      await page.getByTestId("pose-regenerate-feedback").fill("atomic: reload during generation");
      await page.getByTestId("pose-regenerate-start").click();
      await expect(page.getByTestId("pose-regenerate-progress")).toBeVisible({ timeout: 30_000 });

      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(page).not.toHaveURL(/\/login(?:\?|#|$)/);
      await expect(page.getByTestId("pose-schema-image")).toBeVisible({ timeout: 45_000 });

      // UI should remain usable after reload: can open the modal again.
      await page.getByTestId("pose-regenerate").click();
      await expect(page.getByTestId("pose-regenerate-start")).toBeVisible({ timeout: 45_000 });
      await page.keyboard.press("Escape").catch(() => undefined);

      expect(pageErrors, "pageerror indicates a client crash").toEqual([]);
      expect(api5xx.get(), "API 5xx detected during navigation/refresh flow").toEqual([]);
      const unhandled = await page.evaluate(() => (window as any).__atomicUnhandled || []);
      expect(unhandled, "unhandledrejection indicates broken cleanup on navigation").toEqual([]);
    } finally {
      await deletePose(accessToken, poseId);
    }
  });
});
