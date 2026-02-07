import { test, expect } from "@playwright/test";
import { assertNo5xx } from "./atomic-helpers";
import { makeIsolatedToken } from "./atomic-http";

const API_BASE_URL = process.env.PLAYWRIGHT_API_URL || "http://localhost:8000";

async function loginRaw(
  request: import("@playwright/test").APIRequestContext,
  token: string,
): Promise<{ accessToken: string; refreshToken: string }> {
  const res = await request.post(`${API_BASE_URL}/api/v1/auth/login`, {
    data: { token },
  });
  assertNo5xx(res.status(), "login");
  expect(res.status()).toBe(200);
  const json = (await res.json()) as { access_token: string; refresh_token: string };
  expect(json.access_token).toBeTruthy();
  expect(json.refresh_token).toBeTruthy();
  return { accessToken: json.access_token, refreshToken: json.refresh_token };
}

test.describe("Atomic logout cross-user cookie+body isolation (break-it; no 5xx)", () => {
  test.describe.configure({ mode: "serial" });

  test("logout with access A and cookie/body B must not revoke B", async ({ request }) => {
    const tokenA = makeIsolatedToken("logout-cookie-body-a");
    const tokenB = makeIsolatedToken("logout-cookie-body-b");

    const userA = await loginRaw(request, tokenA);
    const userB = await loginRaw(request, tokenB);

    const logoutRes = await request.post(`${API_BASE_URL}/api/v1/auth/logout`, {
      data: { refresh_token: userB.refreshToken },
      headers: {
        Authorization: `Bearer ${userA.accessToken}`,
        Cookie: `refresh_token=${userB.refreshToken}`,
      },
    });
    assertNo5xx(logoutRes.status(), "logout cross-user cookie+body");
    expect(logoutRes.status()).toBe(200);

    const meAfter = await request.get(`${API_BASE_URL}/api/v1/auth/me`, {
      headers: { Authorization: `Bearer ${userA.accessToken}` },
    });
    assertNo5xx(meAfter.status(), "auth/me after logout");
    expect(meAfter.status()).toBe(401);

    const refreshB = await request.post(`${API_BASE_URL}/api/v1/auth/refresh`, {
      data: { refresh_token: userB.refreshToken },
    });
    assertNo5xx(refreshB.status(), "refresh B after logout");
    expect(refreshB.status()).toBe(200);
  });
});
