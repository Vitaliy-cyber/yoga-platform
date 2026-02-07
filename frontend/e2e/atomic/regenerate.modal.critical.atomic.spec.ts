import { test, expect, type Page } from "@playwright/test";
import { TEST_TOKEN } from "../fixtures";
import { authedFetch, loginWithToken } from "./atomic-http";
import { assertNo5xx, gotoWithRetry } from "./atomic-helpers";
import { getCorePoseIdA } from "../test-data";

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

async function openRegenerateModal(page: Page, poseId: number) {
  await gotoWithRetry(page, `/poses/${poseId}`);
  await page.getByTestId("pose-regenerate").click();
  await expect(page.getByTestId("pose-regenerate-start")).toBeVisible();
}

test.describe("Atomic regeneration critical UX (no mocks)", () => {
  test.describe.configure({ mode: "serial" });

  let accessToken = "";
  let schemaOnlyPoseId: number | null = null;

  test.beforeAll(async () => {
    accessToken = (await loginWithToken(TEST_TOKEN)).accessToken;
    expect(accessToken).toBeTruthy();

    const code = `RGN${Date.now().toString(36).slice(-10)}`.slice(0, 20);
    schemaOnlyPoseId = await createPose(accessToken, code);
    await uploadSchema(accessToken, schemaOnlyPoseId);
  });

  test.afterAll(async () => {
    if (schemaOnlyPoseId) await deletePose(accessToken, schemaOnlyPoseId);
  });

  test("starts generation from pose schema and forwards user notes (no 5xx)", async ({ page }) => {
    test.skip(!schemaOnlyPoseId, "pose not created");

    await gotoWithRetry(page, `/poses/${schemaOnlyPoseId}`);
    await page.getByTestId("pose-generate").click();
    await expect(page.getByTestId("pose-generate-start")).toBeVisible();
    await page.getByTestId("pose-generate-notes").fill("make it clearer");

    const reqPromise = page.waitForRequest((req) => {
      return (
        req.method() === "POST" &&
        req.url().includes(`/api/v1/generate/from-pose/${schemaOnlyPoseId as number}`)
      );
    });
    const resPromise = page.waitForResponse((res) => {
      return (
        res.request().method() === "POST" &&
        res.url().includes(`/api/v1/generate/from-pose/${schemaOnlyPoseId as number}`)
      );
    });

    await page.getByTestId("pose-generate-start").click();

    const req = await reqPromise;
    const postData = req.postData() || "";
    const json = JSON.parse(postData) as { additional_notes?: string };
    expect(json.additional_notes).toBe("make it clearer");

    const res = await resPromise;
    assertNo5xx(res.status(), "generate/from-pose (ui)");
    expect(res.status()).toBe(200);

    await page.keyboard.press("Escape");
  });

  test("re-enables start button after transient network failure (allows retry)", async ({ page }) => {
    const poseId = getCorePoseIdA();
    test.skip(!poseId, "Core seed pose not available");

    await openRegenerateModal(page, poseId as number);
    const startBtn = page.getByTestId("pose-regenerate-start");

    await page.getByTestId("pose-regenerate-feedback").fill("atomic: offline then retry");

    // Real failure injection: no mocks, just a transient offline window.
    await page.context().setOffline(true);
    await startBtn.click();

    await expect(startBtn).toBeVisible();
    await expect(startBtn).toBeEnabled({ timeout: 15_000 });

    await page.context().setOffline(false);

    const okResPromise = page.waitForResponse((res) => {
      return (
        res.request().method() === "POST" &&
        res.url().includes(`/api/v1/generate/from-pose/${poseId as number}`)
      );
    });
    await startBtn.click();
    const okRes = await okResPromise;
    assertNo5xx(okRes.status(), "generate/from-pose (regen retry)");
    expect(okRes.status()).toBe(200);

    await expect(page.getByTestId("pose-regenerate-progress")).toBeVisible();
    await page.keyboard.press("Escape");
  });
});
