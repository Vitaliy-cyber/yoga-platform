import { test, expect } from "@playwright/test";
import { assertNo5xx } from "./atomic-helpers";
import { loginWithToken, safeJson } from "./atomic-http";

const API_BASE_URL = process.env.PLAYWRIGHT_API_URL || "http://localhost:8000";
const USER1_TOKEN =
  process.env.E2E_TEST_TOKEN || "e2e-test-token-playwright-2024";

async function uploadBackup(accessToken: string, jsonText: string): Promise<Response> {
  const form = new FormData();
  const blob = new Blob([new TextEncoder().encode(jsonText)], { type: "application/json" });
  form.append("file", blob, "backup.json");
  return fetch(`${API_BASE_URL}/api/v1/import/backup`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    body: form,
  });
}

test.describe("Atomic backup import Unicode surrogate hardening (break-it; no 5xx)", () => {
  test.describe.configure({ mode: "serial" });

  let accessToken = "";

  test.beforeAll(async () => {
    accessToken = (await loginWithToken(USER1_TOKEN)).accessToken;
  });

  test("import backup rejects unpaired surrogates (400) and never 5xx", async () => {
    const payload =
      `{` +
      `"metadata":{"exported_at":"2026-02-05T00:00:00Z","total_poses":1,"total_categories":1},` +
      `"categories":[{"name":"bad \\ud800 category","description":"x"}],` +
      `"poses":[{"code":"BKSUR1","name":"pose","description":"ok"}]` +
      `}`;

    const res = await uploadBackup(accessToken, payload);
    assertNo5xx(res.status, "import backup surrogate");
    expect(res.status).toBe(400);
    const body = (await safeJson(res)) as { detail?: unknown } | undefined;
    expect(body).toBeTruthy();
    expect(typeof body?.detail).toBe("string");
  });
});

