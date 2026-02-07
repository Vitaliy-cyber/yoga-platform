import { test, expect } from "@playwright/test";
import { assertNo5xx, concurrentAll, getEnvInt } from "./atomic-helpers";

const API_BASE_URL = process.env.PLAYWRIGHT_API_URL || "http://localhost:8000";

async function loginRaw(token: string): Promise<{ accessToken: string; refreshToken: string }> {
  const res = await fetch(`${API_BASE_URL}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ token }),
  });
  assertNo5xx(res.status, "login");
  expect(res.status).toBe(200);
  const json = (await res.json()) as { access_token: string; refresh_token: string };
  expect(json.access_token).toBeTruthy();
  expect(json.refresh_token).toBeTruthy();
  return { accessToken: json.access_token, refreshToken: json.refresh_token };
}

test.describe("Atomic auth refresh concurrency (break-it; no 5xx)", () => {
  test.describe.configure({ mode: "serial" });

  test("concurrent refresh with same refresh token yields 200/401 only (never 5xx)", async () => {
    const token = `atomic-refresh-user-${Date.now()}`;
    const { refreshToken } = await loginRaw(token);

    const concurrency = getEnvInt("ATOMIC_CONCURRENCY", 12);
    const attempts = getEnvInt("ATOMIC_REFRESH_ATTEMPTS", 20);

    const tasks = Array.from({ length: attempts }, (_v, i) => async () => {
      const res = await fetch(`${API_BASE_URL}/api/v1/auth/refresh?i=${i}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });
      assertNo5xx(res.status, "refresh");
      if (res.status === 200) {
        const body = (await res.json()) as { access_token?: string; refresh_token?: string };
        expect(body.access_token).toBeTruthy();
        expect(body.refresh_token).toBeTruthy();
      } else {
        // Should be 401 (token already rotated/revoked) or 400 (if input rejected).
        await res.text().catch(() => "");
        expect([400, 401]).toContain(res.status);
      }
      return res.status;
    });

    const statuses = await concurrentAll(tasks, Math.min(concurrency, 10));
    expect(statuses.length).toBe(attempts);
    expect(statuses.some((s) => s === 200)).toBeTruthy();
  });
});

