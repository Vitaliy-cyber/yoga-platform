import { test, expect } from "@playwright/test";
import { assertNo5xx } from "./atomic-helpers";
import { authedFetch, loginWithToken, safeJson } from "./atomic-http";

const API_BASE_URL = process.env.PLAYWRIGHT_API_URL || "http://localhost:8000";
const USER1_TOKEN =
  process.env.E2E_TEST_TOKEN || "e2e-test-token-playwright-2024";

async function uploadCsv(accessToken: string, csvText: string): Promise<Response> {
  const form = new FormData();
  const blob = new Blob([new TextEncoder().encode(csvText)], { type: "text/csv" });
  form.append("file", blob, "big.csv");
  return fetch(`${API_BASE_URL}/api/v1/import/poses/csv`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      "Accept-Language": "uk",
    },
    body: form,
  });
}

async function deleteByCode(accessToken: string, code: string): Promise<void> {
  const res = await authedFetch(accessToken, `/api/v1/poses/code/${encodeURIComponent(code)}`);
  if (res.status !== 200) return;
  const json = (await safeJson(res)) as { id?: number } | undefined;
  if (typeof json?.id !== "number") return;
  await authedFetch(accessToken, `/api/v1/poses/${json.id}`, { method: "DELETE" });
}

test.describe("Atomic import CSV field size limit (break-it; no 5xx)", () => {
  test.describe.configure({ mode: "serial" });

  let accessToken = "";

  test.beforeAll(async () => {
    accessToken = (await loginWithToken(USER1_TOKEN)).accessToken;
  });

  test("very large quoted field should not 500 (accept or clean 400)", async () => {
    const code = `CSV_BIG_${Date.now().toString(36).slice(-8)}`.slice(0, 20);
    const big = "A".repeat(200_000); // > default csv.field_size_limit in many builds
    const csv = `code,name,description\n${code},BigDesc,\"${big}\"\n`;

    const res = await uploadCsv(accessToken, csv);
    assertNo5xx(res.status, "import poses/csv big field");

    // Preferred: accept (we already cap file size to 10MB).
    if (res.status === 200) {
      await safeJson(res);
      await deleteByCode(accessToken, code);
      return;
    }

    // Acceptable fallback: deterministic 400 without leaking internals.
    expect(res.status).toBe(400);
    const body = (await safeJson(res)) as { detail?: unknown } | undefined;
    expect(typeof body?.detail).toBe("string");
    const detail = String(body?.detail);
    expect(detail).not.toContain("Traceback");
    expect(detail).not.toContain("/home/");
    expect(detail).not.toContain("backend/");
    expect(detail).not.toContain("input_value=");
    expect(detail).not.toContain("pydantic.dev");
    expect(detail.length).toBeLessThan(1000);
    expect(detail).not.toContain("A".repeat(2000));
  });
});
