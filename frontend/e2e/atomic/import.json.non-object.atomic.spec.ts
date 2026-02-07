import { test, expect } from "@playwright/test";
import { assertNo5xx } from "./atomic-helpers";
import { loginWithToken, safeJson } from "./atomic-http";

const API_BASE_URL = process.env.PLAYWRIGHT_API_URL || "http://localhost:8000";
const USER1_TOKEN =
  process.env.E2E_TEST_TOKEN || "e2e-test-token-playwright-2024";

async function uploadJson(accessToken: string, jsonText: string): Promise<Response> {
  const form = new FormData();
  const blob = new Blob([new TextEncoder().encode(jsonText)], { type: "application/json" });
  form.append("file", blob, "poses.json");
  return fetch(`${API_BASE_URL}/api/v1/import/poses/json`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    body: form,
  });
}

test.describe("Atomic import JSON non-object items (break-it; no 5xx)", () => {
  test.describe.configure({ mode: "serial" });

  let accessToken = "";

  test.beforeAll(async () => {
    accessToken = (await loginWithToken(USER1_TOKEN)).accessToken;
  });

  test("JSON array containing non-object items returns 400 (never 5xx)", async () => {
    const res = await uploadJson(accessToken, "[[]]");
    assertNo5xx(res.status, "import poses/json non-object item");
    expect(res.status).toBe(400);
    const body = (await safeJson(res)) as { detail?: unknown } | undefined;
    expect(body).toBeTruthy();
    expect(typeof body?.detail).toBe("string");
    const detail = String(body?.detail);
    expect(detail).not.toContain("Traceback");
    expect(detail).not.toContain("TypeError");
  });
});

