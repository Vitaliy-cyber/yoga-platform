import { test, expect } from "@playwright/test";
import { getCorePoseIdA } from "../test-data";

const API_BASE_URL = process.env.PLAYWRIGHT_API_URL || "http://localhost:8000";
const TEST_TOKEN = process.env.E2E_TEST_TOKEN || "e2e-test-token-playwright-2024";

const tinyPngBase64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=";
const tinyPng = Buffer.from(tinyPngBase64, "base64");

async function loginAndGetAccessToken(request: import("@playwright/test").APIRequestContext): Promise<string> {
  const res = await request.post(`${API_BASE_URL}/api/v1/auth/login`, {
    data: { token: TEST_TOKEN },
  });
  expect(res.ok()).toBeTruthy();
  const json = (await res.json()) as { access_token: string };
  expect(typeof json.access_token).toBe("string");
  expect(json.access_token.length).toBeGreaterThan(10);
  return json.access_token;
}

test.describe("API smoke (core)", () => {
  test.describe.configure({ mode: "serial" });

  test("GET /health is OK", async ({ request }) => {
    const res = await request.get(`${API_BASE_URL}/health`);
    expect(res.ok()).toBeTruthy();
  });

  test("POST /api/v1/auth/login returns access token", async ({ request }) => {
    await loginAndGetAccessToken(request);
  });

  test("GET /api/v1/categories returns an array", async ({ request }) => {
    const token = await loginAndGetAccessToken(request);
    const res = await request.get(`${API_BASE_URL}/api/v1/categories`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.ok()).toBeTruthy();
    const json = await res.json();
    expect(Array.isArray(json)).toBeTruthy();
  });

  test("GET /api/v1/poses returns items + total", async ({ request }) => {
    const token = await loginAndGetAccessToken(request);
    const res = await request.get(`${API_BASE_URL}/api/v1/poses?skip=0&limit=10`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.ok()).toBeTruthy();
    const json = (await res.json()) as { items: unknown[]; total: number };
    expect(Array.isArray(json.items)).toBeTruthy();
    expect(typeof json.total).toBe("number");
  });

  test("GET /api/sequences returns items + total", async ({ request }) => {
    const token = await loginAndGetAccessToken(request);
    const res = await request.get(`${API_BASE_URL}/api/sequences?skip=0&limit=10`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.ok()).toBeTruthy();
    const json = (await res.json()) as { items: unknown[]; total: number };
    expect(Array.isArray(json.items)).toBeTruthy();
    expect(typeof json.total).toBe("number");
  });

  test("POST /api/v1/muscles/seed is OK", async ({ request }) => {
    const token = await loginAndGetAccessToken(request);
    const res = await request.post(`${API_BASE_URL}/api/v1/muscles/seed`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.ok()).toBeTruthy();
  });

  test("signed-url endpoint returns a signed_url", async ({ request }) => {
    const poseId = getCorePoseIdA();
    test.skip(!poseId, "Core seed pose not available");

    const token = await loginAndGetAccessToken(request);
    const res = await request.get(`${API_BASE_URL}/api/v1/poses/${poseId}/image/schema/signed-url`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.ok()).toBeTruthy();
    const json = (await res.json()) as { signed_url: string };
    expect(typeof json.signed_url).toBe("string");
    expect(json.signed_url.length).toBeGreaterThan(10);
  });

  test("AI generate endpoint produces a completed task", async ({ request }) => {
    const token = await loginAndGetAccessToken(request);

    const createRes = await request.post(`${API_BASE_URL}/api/v1/generate`, {
      headers: { Authorization: `Bearer ${token}` },
      multipart: {
        schema_file: {
          name: "schema.png",
          mimeType: "image/png",
          buffer: tinyPng,
        },
      },
    });
    expect(createRes.ok()).toBeTruthy();
    const created = (await createRes.json()) as { task_id: string };
    expect(typeof created.task_id).toBe("string");

    const startedAt = Date.now();
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const statusRes = await request.get(
        `${API_BASE_URL}/api/v1/generate/status/${created.task_id}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      expect(statusRes.ok()).toBeTruthy();
      const status = (await statusRes.json()) as { status: string; progress: number };
      if (status.status === "completed") break;
      if (status.status === "failed") throw new Error("AI task failed");
      if (Date.now() - startedAt > 30_000) {
        throw new Error("AI task timed out (>30s)");
      }
      await new Promise((r) => setTimeout(r, 300));
    }
  });
});
