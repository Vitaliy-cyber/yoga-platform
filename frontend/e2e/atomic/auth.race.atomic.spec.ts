import { test, expect } from "@playwright/test";
import { concurrentAll, getEnvInt, assertNo5xx } from "./atomic-helpers";
import { loginWithToken, makeIsolatedToken } from "./atomic-http";

const API_BASE_URL = process.env.PLAYWRIGHT_API_URL || "http://localhost:8000";

async function refreshWithToken(refreshToken: string): Promise<Response> {
  return fetch(`${API_BASE_URL}/api/v1/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
}

test.describe("Atomic auth race conditions", () => {
  const concurrency = getEnvInt("ATOMIC_CONCURRENCY", 12);

  test("refresh-token rotation storm does not 5xx (concurrent refresh on same token)", async () => {
    const token = makeIsolatedToken("auth-race-refresh-storm");
    const loginRes = await fetch(`${API_BASE_URL}/api/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ token }),
    });
    expect(loginRes.status).toBe(200);
    const loginJson = (await loginRes.json()) as { refresh_token: string };
    expect(loginJson.refresh_token).toBeTruthy();

    const iterations = getEnvInt("ATOMIC_AUTH_REFRESH_STORM", 40);
    const tasks = Array.from({ length: iterations }, () => async () => {
      const res = await refreshWithToken(loginJson.refresh_token);
      assertNo5xx(res.status, "refresh storm");
      return res.status;
    });

    const statuses = await concurrentAll(tasks, concurrency);
    expect(statuses.length).toBe(iterations);
    // Only one should succeed; the rest should fail gracefully (rotation).
    expect(statuses.some((s) => s === 200)).toBeTruthy();
    expect(statuses.every((s) => s === 200 || s === 400 || s === 401)).toBeTruthy();
  });

  test("logout invalidates refresh token (refresh after logout is 4xx, not 5xx)", async () => {
    const token = makeIsolatedToken("auth-race-logout-refresh");
    const loginRes = await fetch(`${API_BASE_URL}/api/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ token }),
    });
    expect(loginRes.status).toBe(200);
    const loginJson = (await loginRes.json()) as {
      access_token: string;
      refresh_token: string;
    };

    const logoutRes = await fetch(`${API_BASE_URL}/api/v1/auth/logout`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${loginJson.access_token}`,
      },
      body: JSON.stringify({ refresh_token: loginJson.refresh_token }),
    });
    assertNo5xx(logoutRes.status, "logout");
    expect([200, 401, 403]).toContain(logoutRes.status);

    const refreshAfter = await refreshWithToken(loginJson.refresh_token);
    assertNo5xx(refreshAfter.status, "refresh after logout");
    expect([400, 401]).toContain(refreshAfter.status);
  });

  test("auth/me storm does not 5xx", async () => {
    const { accessToken } = await loginWithToken(makeIsolatedToken("auth-race-me-storm"));
    const iterations = getEnvInt("ATOMIC_AUTH_ME_STORM", 80);
    const tasks = Array.from({ length: iterations }, () => async () => {
      const res = await fetch(`${API_BASE_URL}/api/v1/auth/me`, {
        headers: { Accept: "application/json", Authorization: `Bearer ${accessToken}` },
      });
      assertNo5xx(res.status, "auth/me");
      return res.status;
    });
    const statuses = await concurrentAll(tasks, concurrency);
    expect(statuses.every((s) => s === 200)).toBeTruthy();
  });
});
