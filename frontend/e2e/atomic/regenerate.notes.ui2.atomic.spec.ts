import { test, expect, type Page } from "@playwright/test";
import { TEST_TOKEN } from "../fixtures";
import { authedFetch, loginWithToken, safeJson } from "./atomic-http";
import { assertNo5xx } from "./atomic-helpers";

const tinyPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=",
  "base64",
);

async function createPose(accessToken: string, code: string): Promise<number> {
  const res = await authedFetch(accessToken, "/api/v1/poses", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, name: `Atomic Regen Notes ${code}` }),
  });
  assertNo5xx(res.status, "create pose");
  expect(res.status).toBe(201);
  const json = (await safeJson(res)) as { id?: number } | undefined;
  expect(typeof json?.id).toBe("number");
  return json?.id as number;
}

async function deletePose(accessToken: string, poseId: number): Promise<void> {
  await authedFetch(accessToken, `/api/v1/poses/${poseId}`, { method: "DELETE" }).catch(
    () => undefined,
  );
}

async function openRegenerateModal(page: Page, poseId: number) {
  await page.goto(`/poses/${poseId}`);
  await page.getByTestId("pose-regenerate").click();
  await expect(page.getByTestId("pose-regenerate-start")).toBeVisible();
}

test.describe("Atomic regeneration notes (UI)", () => {
  test.describe.configure({ mode: "serial" });

  let accessToken = "";

  test.beforeAll(async () => {
    accessToken = (await loginWithToken(TEST_TOKEN)).accessToken;
    expect(accessToken).toBeTruthy();
  });

  test("trims additional_notes before sending (from-pose path)", async ({ page }) => {
    const code = `RNOT_${Date.now().toString(36).slice(-10)}`.slice(0, 20);
    const poseId = await createPose(accessToken, code);
    try {
      const photoUrl = `https://atomic.invalid/regen-notes-photo-${Date.now()}.png`;
      const schemaUrl = `https://atomic.invalid/regen-notes-schema-${Date.now()}.png`;

      // Serve deterministic image bytes for preview/fetches.
      await page.route(photoUrl, async (route) => {
        await route.fulfill({ status: 200, headers: { "content-type": "image/png" }, body: tinyPng });
      });
      await page.route(schemaUrl, async (route) => {
        await route.fulfill({ status: 200, headers: { "content-type": "image/png" }, body: tinyPng });
      });

      // Keep the pose fetch real, but override paths so:
      // - photo_path exists => UI shows Regenerate,
      // - schema_path exists => UI uses /generate/from-pose for regeneration,
      // while we fully mock generation/apply to avoid stressing the backend.
      await page.route(`**/api/v1/poses/${poseId as number}`, async (route) => {
        if (route.request().method() !== "GET") {
          await route.continue();
          return;
        }
        const real = await authedFetch(accessToken, `/api/v1/poses/${poseId as number}`, { method: "GET" });
        assertNo5xx(real.status, "get pose (regen notes ui2)");
        const json = (await safeJson(real)) as any;
        json.photo_path = photoUrl;
        json.schema_path = schemaUrl;
        json.muscle_layer_path = null;
        json.skeleton_layer_path = null;
        json.muscles = Array.isArray(json.muscles) ? json.muscles : [];
        await route.fulfill({
          status: 200,
          headers: { "content-type": "application/json" },
          body: JSON.stringify(json),
        });
      });

      // Force signed-url endpoints to fail so the UI falls back to the direct https:// URL.
      await page.route(`**/api/v1/poses/${poseId as number}/image/**/signed-url`, async (route) => {
        await route.fulfill({
          status: 500,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ detail: "Atomic: signed-url down (regen notes ui2)" }),
        });
      });

      const taskId = `atomic_regen_notes_${Date.now()}`;
      await page.route(`**/api/v1/generate/from-pose/${poseId as number}`, async (route) => {
        await route.fulfill({
          status: 200,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            task_id: taskId,
            status: "pending",
            progress: 0,
            status_message: "Atomic: started",
            error_message: null,
            photo_url: null,
            muscles_url: null,
            quota_warning: false,
            analyzed_muscles: null,
          }),
        });
      });
      // Force polling path.
      await page.routeWebSocket("**/ws/generate/**", async (ws) => {
        await ws.close({ code: 1001, reason: "Atomic: ws blocked" });
      });
      await page.route(`**/api/v1/generate/status/${taskId}`, async (route) => {
        await route.fulfill({
          status: 200,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            task_id: taskId,
            status: "completed",
            progress: 100,
            status_message: "Atomic: completed",
            error_message: null,
            photo_url: "/storage/generated/atomic_photo.png",
            muscles_url: "/storage/generated/atomic_muscles.png",
            quota_warning: false,
            analyzed_muscles: null,
          }),
        });
      });
      await page.route(`**/api/v1/poses/${poseId as number}/apply-generation/${taskId}`, async (route) => {
        await route.fulfill({
          status: 200,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: poseId }),
        });
      });

      await openRegenerateModal(page, poseId);
      await page.getByTestId("pose-regenerate-feedback").fill("   hello regen   ");

      const reqPromise = page.waitForRequest((req) => {
        return req.method() === "POST" && req.url().includes(`/api/v1/generate/from-pose/${poseId}`);
      });
      await page.getByTestId("pose-regenerate-start").click();

      const req = await reqPromise;
      const body = JSON.parse(req.postData() || "{}") as { additional_notes?: string };
      expect(body.additional_notes).toBe("hello regen");

      // Ensure the modal finishes and closes (prevents background tasks in long atomic runs).
      await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 20_000 });
    } finally {
      await deletePose(accessToken, poseId);
    }
  });

  test("enforces maxLength=500 in feedback textarea", async ({ page }) => {
    const code = `RMAX_${Date.now().toString(36).slice(-10)}`.slice(0, 20);
    const poseId = await createPose(accessToken, code);
    try {
      const photoUrl = `https://atomic.invalid/regen-notes-photo-${Date.now()}.png`;
      const schemaUrl = `https://atomic.invalid/regen-notes-schema-${Date.now()}.png`;

      await page.route(photoUrl, async (route) => {
        await route.fulfill({ status: 200, headers: { "content-type": "image/png" }, body: tinyPng });
      });
      await page.route(schemaUrl, async (route) => {
        await route.fulfill({ status: 200, headers: { "content-type": "image/png" }, body: tinyPng });
      });

      await page.route(`**/api/v1/poses/${poseId as number}`, async (route) => {
        if (route.request().method() !== "GET") {
          await route.continue();
          return;
        }
        const real = await authedFetch(accessToken, `/api/v1/poses/${poseId as number}`, { method: "GET" });
        assertNo5xx(real.status, "get pose (regen notes ui2 maxlen)");
        const json = (await safeJson(real)) as any;
        json.photo_path = photoUrl;
        json.schema_path = schemaUrl;
        json.muscle_layer_path = null;
        json.skeleton_layer_path = null;
        json.muscles = Array.isArray(json.muscles) ? json.muscles : [];
        await route.fulfill({
          status: 200,
          headers: { "content-type": "application/json" },
          body: JSON.stringify(json),
        });
      });

      await page.route(`**/api/v1/poses/${poseId as number}/image/**/signed-url`, async (route) => {
        await route.fulfill({
          status: 500,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ detail: "Atomic: signed-url down (regen notes ui2 maxlen)" }),
        });
      });

      const taskId = `atomic_regen_maxlen_${Date.now()}`;
      await page.route(`**/api/v1/generate/from-pose/${poseId as number}`, async (route) => {
        await route.fulfill({
          status: 200,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            task_id: taskId,
            status: "pending",
            progress: 0,
            status_message: "Atomic: started",
            error_message: null,
            photo_url: null,
            muscles_url: null,
            quota_warning: false,
            analyzed_muscles: null,
          }),
        });
      });
      await page.routeWebSocket("**/ws/generate/**", async (ws) => {
        await ws.close({ code: 1001, reason: "Atomic: ws blocked" });
      });
      await page.route(`**/api/v1/generate/status/${taskId}`, async (route) => {
        await route.fulfill({
          status: 200,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            task_id: taskId,
            status: "completed",
            progress: 100,
            status_message: "Atomic: completed",
            error_message: null,
            photo_url: "/storage/generated/atomic_photo.png",
            muscles_url: "/storage/generated/atomic_muscles.png",
            quota_warning: false,
            analyzed_muscles: null,
          }),
        });
      });
      await page.route(`**/api/v1/poses/${poseId as number}/apply-generation/${taskId}`, async (route) => {
        await route.fulfill({
          status: 200,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: poseId }),
        });
      });

      await openRegenerateModal(page, poseId);
      const long = "x".repeat(600);
      await page.getByTestId("pose-regenerate-feedback").fill(long);

      const reqPromise = page.waitForRequest((req) => {
        return req.method() === "POST" && req.url().includes(`/api/v1/generate/from-pose/${poseId}`);
      });
      await page.getByTestId("pose-regenerate-start").click();

      const req = await reqPromise;
      const body = JSON.parse(req.postData() || "{}") as { additional_notes?: string };
      expect(body.additional_notes?.length).toBe(500);

      await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 20_000 });
    } finally {
      await deletePose(accessToken, poseId);
    }
  });
});
