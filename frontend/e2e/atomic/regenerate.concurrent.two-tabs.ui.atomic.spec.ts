import { test, expect } from "@playwright/test";
import { TEST_TOKEN } from "../fixtures";
import { authedFetch, loginWithToken } from "./atomic-http";
import { assertNo5xx, gotoWithRetry } from "./atomic-helpers";
import {
  expectNoClientCrash,
  installUnhandledRejectionProbe,
  watchApi5xx,
  watchPageErrors,
} from "./ui-helpers";

const API_BASE_URL = process.env.PLAYWRIGHT_API_URL || "http://127.0.0.1:8000";

const tinyPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=",
  "base64",
);

async function ensureAiEnabled(): Promise<void> {
  const health = await fetch(`${API_BASE_URL}/health`).then((r) => r.json().catch(() => null));
  const aiEnabled = Boolean((health as { ai_enabled?: boolean } | null)?.ai_enabled);
  test.skip(!aiEnabled, "AI generation not enabled on backend (/health ai_enabled=false)");
}

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

async function waitCompleted(accessToken: string, taskId: string, timeoutMs: number = 90_000) {
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
    await new Promise((r) => setTimeout(r, 150));
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
  await waitCompleted(accessToken, taskId);
  await applyWithRetry(accessToken, poseId, taskId);

  const poseRes = await authedFetch(accessToken, `/api/v1/poses/${poseId}`);
  assertNo5xx(poseRes.status, "get pose (post-initial-generate)");
  expect(poseRes.status).toBe(200);
  const poseJson = (await poseRes.json()) as { photo_path?: string | null };
  expect(poseJson.photo_path, "pose must have generated photo to show Regenerate").toBeTruthy();
}

test.describe("Atomic regenerate flow: two tabs concurrently regenerate same pose (200/409 ok; no hangs/crash; never 5xx)", () => {
  test.describe.configure({ mode: "serial" });

  test("two pages start regeneration concurrently and both recover to a usable state", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await ensureAiEnabled();

    // Second tab in the same authenticated browser context.
    const page2 = await page.context().newPage();

    await installUnhandledRejectionProbe(page);
    await installUnhandledRejectionProbe(page2);
    const pageErrors1 = watchPageErrors(page);
    const api5xx_1 = watchApi5xx(page);
    const pageErrors2 = watchPageErrors(page2);
    const api5xx_2 = watchApi5xx(page2);

    const { accessToken } = await loginWithToken(TEST_TOKEN);
    expect(accessToken).toBeTruthy();

    const code = `RGT${Date.now().toString(36).slice(-10)}`.slice(0, 20);
    const poseId = await createPose(accessToken, code);
    await uploadSchema(accessToken, poseId);
    await ensurePoseHasGeneratedPhoto(accessToken, poseId);

    try {
      await gotoWithRetry(page, `/poses/${poseId}`, { timeoutMs: 60_000 });
      await gotoWithRetry(page2, `/poses/${poseId}`, { timeoutMs: 60_000 });

      await expect(page.getByTestId("pose-regenerate")).toBeVisible({ timeout: 60_000 });
      await expect(page2.getByTestId("pose-regenerate")).toBeVisible({ timeout: 60_000 });

      await page.getByTestId("pose-regenerate").click();
      await page2.getByTestId("pose-regenerate").click();

      await expect(page.getByTestId("pose-regenerate-start")).toBeVisible();
      await expect(page2.getByTestId("pose-regenerate-start")).toBeVisible();

      await page.getByTestId("pose-regenerate-feedback").fill("atomic: concurrent regen tab A");
      await page2.getByTestId("pose-regenerate-feedback").fill("atomic: concurrent regen tab B");

      const startResPromise1 = page.waitForResponse((res) => {
        return (
          res.request().method() === "POST" &&
          res.url().includes(`/api/v1/generate/from-pose/${poseId}`)
        );
      });
      const startResPromise2 = page2.waitForResponse((res) => {
        return (
          res.request().method() === "POST" &&
          res.url().includes(`/api/v1/generate/from-pose/${poseId}`)
        );
      });

      // Start both regenerations at nearly the same time.
      await Promise.all([
        page.getByTestId("pose-regenerate-start").click(),
        page2.getByTestId("pose-regenerate-start").click(),
      ]);

      const [startRes1, startRes2] = await Promise.all([startResPromise1, startResPromise2]);
      const statuses = [startRes1.status(), startRes2.status()];
      for (const st of statuses) assertNo5xx(st, "generate/from-pose start");
      expect(statuses.some((s) => s === 200), "at least one tab should start generation (200)").toBe(
        true,
      );
      expect(
        statuses.every((s) => s === 200 || s === 409),
        `expected start statuses to be in {200,409}, got ${statuses.join(",")}`,
      ).toBe(true);

      const settleOne = async (p: import("@playwright/test").Page) => {
        const dialog = p.getByRole("dialog");
        const progress = p.getByTestId("pose-regenerate-progress");
        const start = p.getByTestId("pose-regenerate-start");
        const errorBox = dialog.locator('div.bg-red-50, div[class*="bg-red"]').first();

        // Wait for *some* terminal/steady UI signal:
        // - progress appears (generation started), OR
        // - an error box appears (409/etc), OR
        // - dialog closes quickly (rare but ok).
        await Promise.race([
          progress.waitFor({ state: "visible", timeout: 60_000 }),
          errorBox.waitFor({ state: "visible", timeout: 60_000 }),
          dialog.waitFor({ state: "detached", timeout: 60_000 }),
        ]).catch(() => undefined);

        // If generation started, wait until it settles (modal closes) OR it surfaces an error.
        if (await progress.isVisible().catch(() => false)) {
          await Promise.race([
            progress.waitFor({ state: "detached", timeout: 180_000 }),
            errorBox.waitFor({ state: "visible", timeout: 180_000 }),
            dialog.waitFor({ state: "detached", timeout: 180_000 }),
          ]).catch(() => undefined);
        }

        // If the dialog is still open now, it must be usable (no infinite disabled Start).
        if (await dialog.isVisible().catch(() => false)) {
          // If an error is surfaced, the user must be able to retry.
          if (await errorBox.isVisible().catch(() => false)) {
            await expect(start).toBeVisible({ timeout: 30_000 });
            await expect(start).toBeEnabled({ timeout: 60_000 });
          } else {
            // Otherwise it's likely closing; ensure it fully closes promptly.
            await dialog.waitFor({ state: "detached", timeout: 60_000 });
          }
        }
      };

      await Promise.all([settleOne(page), settleOne(page2)]);

      await expectNoClientCrash({
        page,
        pageErrors: pageErrors1,
        api5xx: api5xx_1,
        label: "regen concurrent tab A",
      });
      await expectNoClientCrash({
        page: page2,
        pageErrors: pageErrors2,
        api5xx: api5xx_2,
        label: "regen concurrent tab B",
      });
    } finally {
      await deletePose(accessToken, poseId);
      await page2.close().catch(() => undefined);
    }
  });
});
