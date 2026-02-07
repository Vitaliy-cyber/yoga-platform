import { test, expect, type Page } from "@playwright/test";
import { authedFetch, loginWithToken } from "./atomic-http";
import { assertNo5xx } from "./atomic-helpers";

const API_BASE_URL = process.env.PLAYWRIGHT_API_URL || "http://localhost:8000";
const USER1_TOKEN =
  process.env.E2E_TEST_TOKEN || "e2e-test-token-playwright-2024";

const tinyPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=",
  "base64",
);

async function createPose(accessToken: string, code: string): Promise<number> {
  const res = await authedFetch(accessToken, "/api/v1/poses", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, name: `Atomic Notes ${code}` }),
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
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    body: form,
  });
  assertNo5xx(res.status, "upload schema");
  expect(res.status).toBe(200);
}

async function openGenerateModal(page: Page, poseId: number) {
  await page.goto(`/poses/${poseId}`);
  await page.getByTestId("pose-generate").click();
  await expect(page.getByTestId("pose-generate-start")).toBeVisible();
}

test.describe("Atomic generation notes (UI sends additional_notes correctly; no mocks)", () => {
  test.describe.configure({ mode: "serial" });

  let accessToken = "";

  test.beforeAll(async () => {
    accessToken = (await loginWithToken(USER1_TOKEN)).accessToken;
    expect(accessToken).toBeTruthy();
  });

  async function createPoseWithSchema(): Promise<number> {
    const code = `NOTES_${Date.now().toString(36).slice(-10)}`.slice(0, 20);
    const poseId = await createPose(accessToken, code);
    await uploadSchema(accessToken, poseId);
    return poseId;
  }

  async function closeGenerateModal(page: Page): Promise<void> {
    // We close the modal ASAP after capturing the request to avoid letting the UI
    // proceed to long-running polling + save/apply flows (keeps the test isolated).
    await page.keyboard.press("Escape").catch(() => undefined);
    await expect(page.getByTestId("pose-generate-start")).toHaveCount(0, { timeout: 10_000 });
  }

  test("trims additional_notes before sending", async ({ page }) => {
    const poseId = await createPoseWithSchema();
    try {
      await openGenerateModal(page, poseId);
      await page.getByTestId("pose-generate-notes").fill("   hello world   ");

      const reqPromise = page.waitForRequest((req) => {
        return req.method() === "POST" && req.url().includes(`/api/v1/generate/from-pose/${poseId}`);
      });
      await page.getByTestId("pose-generate-start").click();

      const req = await reqPromise;
      const body = JSON.parse(req.postData() || "{}") as { additional_notes?: string };
      expect(body.additional_notes).toBe("hello world");

      await closeGenerateModal(page);
    } finally {
      await deletePose(accessToken, poseId);
    }
  });

  test("omits additional_notes when user input is whitespace", async ({ page }) => {
    const poseId = await createPoseWithSchema();
    try {
      await openGenerateModal(page, poseId);
      await page.getByTestId("pose-generate-notes").fill("   \n\t  ");

      const reqPromise = page.waitForRequest((req) => {
        return req.method() === "POST" && req.url().includes(`/api/v1/generate/from-pose/${poseId}`);
      });
      await page.getByTestId("pose-generate-start").click();

      const req = await reqPromise;
      const body = JSON.parse(req.postData() || "{}") as Record<string, unknown>;
      expect(Object.prototype.hasOwnProperty.call(body, "additional_notes")).toBe(false);

      await closeGenerateModal(page);
    } finally {
      await deletePose(accessToken, poseId);
    }
  });

  test("preserves newlines in additional_notes", async ({ page }) => {
    const poseId = await createPoseWithSchema();
    try {
      const notes = "line1\nline2\nline3";
      await openGenerateModal(page, poseId);
      await page.getByTestId("pose-generate-notes").fill(notes);

      const reqPromise = page.waitForRequest((req) => {
        return req.method() === "POST" && req.url().includes(`/api/v1/generate/from-pose/${poseId}`);
      });
      await page.getByTestId("pose-generate-start").click();

      const req = await reqPromise;
      const body = JSON.parse(req.postData() || "{}") as { additional_notes?: string };
      expect(body.additional_notes).toBe(notes);

      await closeGenerateModal(page);
    } finally {
      await deletePose(accessToken, poseId);
    }
  });

  test("prevents double-submit (only one request on double click)", async ({ page }) => {
    const poseId = await createPoseWithSchema();
    try {
      await openGenerateModal(page, poseId);
      await page.getByTestId("pose-generate-notes").fill("double click");

      let count = 0;
      page.on("request", (req) => {
        if (req.method() === "POST" && req.url().includes(`/api/v1/generate/from-pose/${poseId}`)) {
          count += 1;
        }
      });

      const btn = page.getByTestId("pose-generate-start");
      await btn.evaluate((el) => {
        (el as HTMLButtonElement).click();
        (el as HTMLButtonElement).click();
      });

      await expect.poll(() => count).toBe(1);

      await closeGenerateModal(page);
    } finally {
      await deletePose(accessToken, poseId);
    }
  });

  test("handles unpaired surrogate in user notes without crashing the client", async ({ page }) => {
    const poseId = await createPoseWithSchema();
    try {
      const weird = `surrogate:${"\ud800"}`;
      await openGenerateModal(page, poseId);
      await page.getByTestId("pose-generate-notes").fill(weird);

      const reqPromise = page.waitForRequest((req) => {
        return req.method() === "POST" && req.url().includes(`/api/v1/generate/from-pose/${poseId}`);
      });
      await page.getByTestId("pose-generate-start").click();

      const req = await reqPromise;
      const body = JSON.parse(req.postData() || "{}") as { additional_notes?: string };
      expect(body.additional_notes?.includes("surrogate:")).toBeTruthy();

      await closeGenerateModal(page);
    } finally {
      await deletePose(accessToken, poseId);
    }
  });
});
