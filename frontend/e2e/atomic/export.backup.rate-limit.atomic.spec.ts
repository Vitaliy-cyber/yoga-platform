import { test, expect } from "@playwright/test";
import { assertNo5xx, concurrentAll, getEnvInt } from "./atomic-helpers";
import { loginWithToken, safeJson } from "./atomic-http";

const API_BASE_URL = process.env.PLAYWRIGHT_API_URL || "http://localhost:8000";
const USER1_TOKEN =
  process.env.E2E_TEST_TOKEN || "e2e-test-token-playwright-2024";

async function exportBackup(accessToken: string): Promise<Response> {
  return fetch(`${API_BASE_URL}/api/v1/export/backup`, {
    method: "GET",
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });
}

test.describe("Atomic export backup rate-limit (break-it; no 5xx)", () => {
  test.describe.configure({ mode: "serial" });

  test("burst beyond per-hour limit yields 429 with Retry-After (never 5xx)", async () => {
    const accessToken = (await loginWithToken(USER1_TOKEN)).accessToken;
    const concurrency = Math.min(getEnvInt("ATOMIC_CONCURRENCY", 12), 8);

    const tasks = Array.from({ length: 10 }, (_v, i) => async () => {
      const res = await exportBackup(accessToken);
      assertNo5xx(res.status, `export/backup#${i}`);
      return res;
    });

    const responses = await concurrentAll(tasks, concurrency);
    const statuses = responses.map((r) => r.status);
    expect(statuses.every((s) => s === 200 || s === 429)).toBeTruthy();
    // If earlier tests already consumed the quota, we may see only 429s; that's OK.
    expect(statuses.some((s) => s === 429)).toBeTruthy();

    for (const r of responses) {
      if (r.status === 429) {
        const retryAfter = r.headers.get("retry-after");
        expect(retryAfter).toBeTruthy();
        const json = (await safeJson(r)) as { detail?: unknown } | undefined;
        expect(typeof json?.detail).toBe("string");
        expect(String(json?.detail)).not.toContain("Traceback");
      }
    }
  });
});
