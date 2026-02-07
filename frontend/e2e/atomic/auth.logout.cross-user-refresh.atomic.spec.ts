import { test, expect } from "@playwright/test";
import { assertNo5xx } from "./atomic-helpers";
import { makeIsolatedToken } from "./atomic-http";

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

async function refresh(refreshToken: string): Promise<Response> {
  return fetch(`${API_BASE_URL}/api/v1/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
}

test.describe("Atomic logout cross-user refresh isolation (break-it; no 5xx)", () => {
  test.describe.configure({ mode: "serial" });

  test("logout should not revoke another user's refresh token", async () => {
    const tokenA = makeIsolatedToken("logout-cross-a");
    const tokenB = makeIsolatedToken("logout-cross-b");

    const userA = await loginRaw(tokenA);
    const userB = await loginRaw(tokenB);

    const logoutRes = await fetch(`${API_BASE_URL}/api/v1/auth/logout`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${userA.accessToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ refresh_token: userB.refreshToken }),
    });

    assertNo5xx(logoutRes.status, "logout cross-user");
    expect([200, 400, 401, 403]).toContain(logoutRes.status);

    const refreshRes = await refresh(userB.refreshToken);
    assertNo5xx(refreshRes.status, "refresh after cross-user logout");
    expect(refreshRes.status).toBe(200);
  });
});
