import { test, expect, type Page, type BrowserContext } from "@playwright/test";
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

async function installUnhandledRejectionProbe(page: Page): Promise<void> {
  await page.addInitScript(() => {
    (window as any).__atomicUnhandled = [];
    window.addEventListener("unhandledrejection", (event) => {
      (window as any).__atomicUnhandled.push({
        reason: String((event as PromiseRejectionEvent).reason || "unknown"),
      });
    });
  });
}

async function getUnhandled(page: Page): Promise<unknown[]> {
  return page.evaluate(() => (window as any).__atomicUnhandled || []);
}

function watchApi5xx(page: Page): { get: () => Array<{ url: string; status: number }> } {
  const bad: Array<{ url: string; status: number }> = [];
  page.on("response", (res) => {
    const url = res.url();
    if (!url.includes("/api/v1/")) return;
    const status = res.status();
    if (status >= 500) bad.push({ url, status });
  });
  return { get: () => bad };
}

async function uiLoginWithToken(page: Page, token: string): Promise<void> {
  await gotoWithRetry(page, "/login", { timeoutMs: 45_000, waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(/\/login(?:\?|#|$)/, { timeout: 45_000 });

  const tokenInput = page
    .locator('input[name="token"], input#token, input[placeholder*="token" i]')
    .first();
  await expect(tokenInput).toBeVisible({ timeout: 60_000 });
  await tokenInput.fill(token);

  const submit = page
    .locator(
      'button[type="submit"], button:has-text("Sign In"), button:has-text("Sign"), button:has-text("Login"), button:has-text("Увійти")',
    )
    .first();
  await expect(submit).toBeVisible({ timeout: 60_000 });
  await expect(submit).toBeEnabled({ timeout: 15_000 });
  await submit.click();

  await page.waitForURL("/", { timeout: 45_000 });
  await page.waitForLoadState("domcontentloaded");
}

async function openRegenAndStart(page: Page, poseId: number, label: string): Promise<number> {
  await gotoWithRetry(page, `/poses/${poseId}`, { timeoutMs: 45_000 });
  await expect(page.getByTestId("pose-regenerate")).toBeVisible();
  await page.getByTestId("pose-regenerate").click();
  await expect(page.getByTestId("pose-regenerate-start")).toBeVisible();
  await page.getByTestId("pose-regenerate-feedback").fill(label);

  const startResPromise = page.waitForResponse((res) => {
    return (
      res.request().method() === "POST" &&
      res.url().includes(`/api/v1/generate/from-pose/${poseId}`)
    );
  });
  await page.getByTestId("pose-regenerate-start").click();
  const startRes = await startResPromise;
  return startRes.status();
}

async function waitRegenSettled(page: Page): Promise<void> {
  // After clicking start, we expect either:
  // - progress becomes visible (generation started), then disappears (modal closes), OR
  // - an error panel appears and the start button becomes enabled again.
  const dialog = page.getByRole("dialog");
  const progress = page.getByTestId("pose-regenerate-progress");
  const start = page.getByTestId("pose-regenerate-start");
  const errorPanel = dialog.locator("div.bg-red-50");

  await Promise.race([
    progress.waitFor({ state: "visible", timeout: 30_000 }).catch(() => undefined),
    errorPanel.waitFor({ state: "visible", timeout: 30_000 }).catch(() => undefined),
    dialog.waitFor({ state: "detached", timeout: 60_000 }).catch(() => undefined),
  ]);

  await Promise.race([
    dialog.waitFor({ state: "detached", timeout: 75_000 }).catch(() => undefined),
    (async () => {
      await expect(errorPanel).toBeVisible({ timeout: 75_000 });
      await expect(start).toBeVisible();
      await expect(start).toBeEnabled({ timeout: 75_000 });
    })(),
  ]);
}

test.describe("Atomic regenerate flow: two sessions concurrent on same pose (no crashes; never 5xx)", () => {
  test.describe.configure({ mode: "serial" });

  test("two independent browser contexts can start regeneration concurrently on the same pose", async ({
    browser,
  }) => {
    test.setTimeout(150_000);

    await ensureAiEnabled();

    const { accessToken } = await loginWithToken(TEST_TOKEN);
    expect(accessToken).toBeTruthy();

    const code = `RG2${Date.now().toString(36).slice(-10)}`.slice(0, 20);
    const poseId = await createPose(accessToken, code);
    await uploadSchema(accessToken, poseId);
    await ensurePoseHasGeneratedPhoto(accessToken, poseId);

    const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3000";
    const mkContext = async (): Promise<{ context: BrowserContext; page: Page }> => {
      const context = await browser.newContext({
        baseURL,
        storageState: { cookies: [], origins: [] },
      });
      const page = await context.newPage();
      await installUnhandledRejectionProbe(page);
      return { context, page };
    };

    const pageErrors: string[] = [];
    const { context: ctxA, page: pageA } = await mkContext();
    const { context: ctxB, page: pageB } = await mkContext();
    pageA.on("pageerror", (e) => pageErrors.push(`A:${String(e)}`));
    pageB.on("pageerror", (e) => pageErrors.push(`B:${String(e)}`));
    const a5xx = watchApi5xx(pageA);
    const b5xx = watchApi5xx(pageB);

    try {
      await Promise.all([uiLoginWithToken(pageA, TEST_TOKEN), uiLoginWithToken(pageB, TEST_TOKEN)]);

      const [statusA, statusB] = await Promise.all([
        openRegenAndStart(pageA, poseId, `atomic two-session A ${Date.now()}`),
        openRegenAndStart(pageB, poseId, `atomic two-session B ${Date.now()}`),
      ]);
      expect([200, 409], `session A from-pose status=${statusA}`).toContain(statusA);
      expect([200, 409], `session B from-pose status=${statusB}`).toContain(statusB);
      expect(statusA === 200 || statusB === 200, "at least one session should start regeneration (200)").toBeTruthy();

      await Promise.all([waitRegenSettled(pageA), waitRegenSettled(pageB)]);

      expect(pageErrors, "pageerror indicates a client crash").toEqual([]);
      expect(a5xx.get(), "API 5xx detected in session A").toEqual([]);
      expect(b5xx.get(), "API 5xx detected in session B").toEqual([]);

      const unhandledA = await getUnhandled(pageA);
      const unhandledB = await getUnhandled(pageB);
      expect(unhandledA, "unhandledrejection in session A").toEqual([]);
      expect(unhandledB, "unhandledrejection in session B").toEqual([]);
    } finally {
      await deletePose(accessToken, poseId);
      await Promise.all([ctxA.close().catch(() => undefined), ctxB.close().catch(() => undefined)]);
    }
  });
});
