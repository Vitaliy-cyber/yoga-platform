import { test, expect } from "@playwright/test";
import { assertNo5xx, concurrentAll, getEnvInt } from "./atomic-helpers";

const API_BASE_URL = process.env.PLAYWRIGHT_API_URL || "http://localhost:8000";
const BASE_TOKEN =
  process.env.E2E_TEST_TOKEN || "e2e-test-token-playwright-2024";

type LoginResponse = { access_token: string; refresh_token: string; user: { id: number } };

async function loginRaw(token: string): Promise<LoginResponse> {
  const res = await fetch(`${API_BASE_URL}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ token }),
  });
  expect(res.ok).toBeTruthy();
  return (await res.json()) as LoginResponse;
}

async function refreshRaw(refreshToken: string): Promise<Response> {
  return fetch(`${API_BASE_URL}/api/v1/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
}

async function logoutRaw(accessToken: string, refreshToken: string): Promise<Response> {
  return fetch(`${API_BASE_URL}/api/v1/auth/logout`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
}

test.describe("Atomic auth refresh/logout races (no 5xx)", () => {
  test.describe.configure({ mode: "serial" });

  const concurrency = getEnvInt("ATOMIC_CONCURRENCY", 12);

  test("concurrent refresh with same token yields 200/401 only (no 5xx)", async () => {
    const token = `${BASE_TOKEN}-refresh-race-${test.info().workerIndex}-${Date.now().toString(36)}`;
    const login = await loginRaw(token);
    const iterations = getEnvInt("ATOMIC_REFRESH_RACE_ITER", 12);

    const tasks = Array.from({ length: iterations }, () => async () => {
      const res = await refreshRaw(login.refresh_token);
      assertNo5xx(res.status, "refresh race");
      return res.status;
    });

    const statuses = await concurrentAll(tasks, Math.min(concurrency, 8));
    expect(statuses.some((s) => s === 200)).toBeTruthy();
    expect(statuses.every((s) => s === 200 || s === 401)).toBeTruthy();
  });

  test("refresh vs logout race never 5xx", async () => {
    const token = `${BASE_TOKEN}-refresh-logout-${test.info().workerIndex}-${Date.now().toString(36)}`;
    const login = await loginRaw(token);
    const iterations = getEnvInt("ATOMIC_REFRESH_LOGOUT_ITER", 10);

    const tasks = Array.from({ length: iterations }, (_v, i) => async () => {
      const res = i % 2
        ? await refreshRaw(login.refresh_token)
        : await logoutRaw(login.access_token, login.refresh_token);
      assertNo5xx(res.status, `refresh/logout#${i}`);
      return res.status;
    });

    const statuses = await concurrentAll(tasks, Math.min(concurrency, 6));
    expect(statuses.every((s) => [200, 401, 403].includes(s))).toBeTruthy();
  });
});
