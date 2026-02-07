import { test, expect } from "@playwright/test";
import { assertNo5xx } from "./atomic-helpers";
import { loginWithToken } from "./atomic-http";

const API_BASE_URL = process.env.PLAYWRIGHT_API_URL || "http://localhost:8000";
const USER1_TOKEN =
  process.env.E2E_TEST_TOKEN || "e2e-test-token-playwright-2024";

async function uploadRawFile(
  accessToken: string,
  path: "/api/v1/import/backup" | "/api/v1/import/poses/json",
  filename: string,
  bytes: Uint8Array,
  contentType: string = "application/json",
): Promise<Response> {
  const form = new FormData();
  const blob = new Blob([bytes], { type: contentType });
  form.append("file", blob, filename);

  return fetch(`${API_BASE_URL}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
    body: form,
  });
}

function makeDeepJsonArray(depth: number): string {
  return `${"[".repeat(depth)}[]${"]".repeat(depth)}`;
}

test.describe("Atomic import: JSON depth hardening (break-it; no 5xx)", () => {
  test.describe.configure({ mode: "serial" });

  let accessToken = "";

  test.beforeAll(async () => {
    accessToken = (await loginWithToken(USER1_TOKEN)).accessToken;
  });

  test("import poses/json: deeply nested JSON is 400 (never 5xx, never traceback leak)", async () => {
    const bytes = new TextEncoder().encode(makeDeepJsonArray(1600));
    const res = await uploadRawFile(
      accessToken,
      "/api/v1/import/poses/json",
      "deep.json",
      bytes,
    );
    assertNo5xx(res.status, "import poses/json deep json");
    expect(res.status).toBe(400);
    const txt = await res.text();
    expect(txt).not.toContain("Traceback");
    expect(txt).not.toContain("Exception Group");
    expect(txt).not.toContain("/home/");
    const body = JSON.parse(txt) as { detail?: unknown };
    expect(body.detail).toBe("JSON nesting too deep.");
  });

  test("import backup: deeply nested JSON is 400 (never 5xx)", async () => {
    const bytes = new TextEncoder().encode(makeDeepJsonArray(1600));
    const res = await uploadRawFile(accessToken, "/api/v1/import/backup", "deep.json", bytes);
    assertNo5xx(res.status, "import backup deep json");
    expect(res.status).toBe(400);
    const body = (await res.json()) as { detail?: unknown };
    expect(body.detail).toBe("JSON nesting too deep.");
  });
});

