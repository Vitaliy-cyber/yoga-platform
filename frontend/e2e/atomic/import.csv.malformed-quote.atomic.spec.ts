import { test, expect } from "@playwright/test";
import { assertNo5xx } from "./atomic-helpers";
import { loginWithToken } from "./atomic-http";

const API_BASE_URL = process.env.PLAYWRIGHT_API_URL || "http://localhost:8000";
const USER1_TOKEN =
  process.env.E2E_TEST_TOKEN || "e2e-test-token-playwright-2024";

async function uploadCsv(accessToken: string, csvText: string): Promise<Response> {
  const form = new FormData();
  const blob = new Blob([new TextEncoder().encode(csvText)], { type: "text/csv" });
  form.append("file", blob, "bad.csv");
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

test.describe("Atomic import CSV malformed quotes (break-it; no 5xx)", () => {
  test.describe.configure({ mode: "serial" });

  let accessToken = "";

  test.beforeAll(async () => {
    accessToken = (await loginWithToken(USER1_TOKEN)).accessToken;
  });

  test("unclosed quote in CSV never 5xx (400 expected) and does not leak stack/paths", async () => {
    // This triggers csv.Error during iterator.next() (before loop body), which historically can escape and become 500.
    const csv = `code,name,description\nABC,\"unterminated,desc\n`;
    const res = await uploadCsv(accessToken, csv);
    assertNo5xx(res.status, "import poses/csv malformed quote");
    expect(res.status).toBe(400);
    const body = (await res.json()) as { detail?: unknown };
    expect(typeof body.detail).toBe("string");
    const detail = String(body.detail);
    expect(detail).not.toContain("Traceback");
    expect(detail).not.toContain(".py");
    expect(detail.toLowerCase()).not.toContain("csv.error");
  });
});

