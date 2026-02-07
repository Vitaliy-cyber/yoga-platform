import { test, expect } from "@playwright/test";
import { assertNo5xx } from "./atomic-helpers";
import { authedFetch, loginWithToken, safeJson } from "./atomic-http";

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

async function deleteByCode(accessToken: string, code: string): Promise<void> {
  const res = await authedFetch(accessToken, `/api/v1/poses/code/${encodeURIComponent(code)}`);
  if (res.status !== 200) return;
  const json = (await res.json()) as { id?: number };
  if (typeof json.id !== "number") return;
  await authedFetch(accessToken, `/api/v1/poses/${json.id}`, { method: "DELETE" });
}

test.describe("Atomic import Unicode surrogate hardening (break-it; no 5xx)", () => {
  test.describe.configure({ mode: "serial" });

  let accessToken = "";

  test.beforeAll(async () => {
    accessToken = (await loginWithToken(USER1_TOKEN)).accessToken;
  });

  test("import poses/json rejects unpaired surrogates (400) and never 5xx", async () => {
    const code = `IMPSUR_${Date.now().toString(36).slice(-8)}`.slice(0, 20);
    // Craft raw JSON with an unpaired surrogate escape.
    // IMPORTANT: JSON must contain a single backslash-u escape (\\u in JS string literal).
    // Sending a real JS unpaired surrogate won't survive UTF-8 encoding (TextEncoder replaces it).
    const jsonText = `[{\"code\":\"${code}\",\"name\":\"bad \\ud800 name\",\"description\":\"ok\"}]`;

    const res = await uploadJson(accessToken, jsonText);
    assertNo5xx(res.status, "import poses/json surrogate");

    if (res.status === 200) {
      // If it ever succeeds, clean up to keep the persistent DB tidy.
      await safeJson(res);
      await deleteByCode(accessToken, code);
    }

    expect(res.status).toBe(400);
    const body = (await safeJson(res)) as { detail?: unknown } | undefined;
    expect(body).toBeTruthy();
    expect(typeof body?.detail).toBe("string");
    expect(String(body?.detail)).not.toContain("UnicodeEncodeError");
  });
});
