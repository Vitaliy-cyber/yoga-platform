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
      "Accept-Language": "uk",
      Accept: "application/json",
    },
    body: form,
  });
}

test.describe("Atomic import malformed payloads (break-it; no 5xx)", () => {
  test.describe.configure({ mode: "serial" });

  let accessToken = "";

  test.beforeAll(async () => {
    accessToken = (await loginWithToken(USER1_TOKEN)).accessToken;
  });

  test("import poses/json: invalid JSON is 400 with sanitized detail", async () => {
    const bytes = new TextEncoder().encode("{");
    const res = await uploadRawFile(
      accessToken,
      "/api/v1/import/poses/json",
      "bad.json",
      bytes,
    );
    assertNo5xx(res.status, "import poses/json invalid json");
    expect(res.status).toBe(400);
    const body = (await res.json()) as { detail?: unknown };
    expect(body.detail).toBe("Invalid JSON");
  });

  test("import backup: invalid JSON is 400 with sanitized detail", async () => {
    const bytes = new TextEncoder().encode("{");
    const res = await uploadRawFile(accessToken, "/api/v1/import/backup", "bad.json", bytes);
    assertNo5xx(res.status, "import backup invalid json");
    expect(res.status).toBe(400);
    const body = (await res.json()) as { detail?: unknown };
    expect(body.detail).toBe("Invalid JSON");
  });

  test("import backup: invalid backup format is 400 with sanitized detail", async () => {
    const bytes = new TextEncoder().encode(JSON.stringify({}));
    const res = await uploadRawFile(accessToken, "/api/v1/import/backup", "bad.json", bytes);
    assertNo5xx(res.status, "import backup invalid format");
    expect(res.status).toBe(400);
    const body = (await res.json()) as { detail?: unknown };
    expect(body.detail).toBe("Invalid backup format");
  });

  test("import endpoints: invalid UTF-8 never 5xx and never leaks decoder text", async () => {
    const bytes = new Uint8Array([0xff, 0xfe, 0xfd, 0x00, 0x80]);

    const res1 = await uploadRawFile(
      accessToken,
      "/api/v1/import/poses/json",
      "bad.json",
      bytes,
    );
    assertNo5xx(res1.status, "import poses/json invalid utf-8");
    expect(res1.status).toBe(400);
    const body1 = (await res1.json()) as { detail?: unknown };
    expect(typeof body1.detail).toBe("string");
    expect(String(body1.detail)).not.toContain("UnicodeDecodeError");
    expect(String(body1.detail).toLowerCase()).not.toContain("codec can't decode");

    const res2 = await uploadRawFile(accessToken, "/api/v1/import/backup", "bad.json", bytes);
    assertNo5xx(res2.status, "import backup invalid utf-8");
    expect(res2.status).toBe(400);
    const body2 = (await res2.json()) as { detail?: unknown };
    expect(typeof body2.detail).toBe("string");
    expect(String(body2.detail)).not.toContain("UnicodeDecodeError");
    expect(String(body2.detail).toLowerCase()).not.toContain("codec can't decode");
  });
});

