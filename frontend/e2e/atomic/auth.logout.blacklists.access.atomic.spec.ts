import { test, expect } from "@playwright/test";
import { assertNo5xx } from "./atomic-helpers";
import { makeIsolatedToken } from "./atomic-http";

const API_BASE_URL = process.env.PLAYWRIGHT_API_URL || "http://localhost:8000";

test.describe("Atomic logout blacklists access token (break-it; no 5xx)", () => {
  test.describe.configure({ mode: "serial" });

  test("access token stops working after logout", async ({ request }) => {
    const token = makeIsolatedToken("auth-logout-blacklist");
    const loginRes = await request.post(`${API_BASE_URL}/api/v1/auth/login`, {
      data: { token },
    });
    assertNo5xx(loginRes.status(), "login");
    expect(loginRes.status()).toBe(200);
    const loginJson = (await loginRes.json()) as { access_token: string; refresh_token: string };

    const meRes = await request.get(`${API_BASE_URL}/api/v1/auth/me`, {
      headers: { Authorization: `Bearer ${loginJson.access_token}` },
    });
    assertNo5xx(meRes.status(), "auth/me before logout");
    expect(meRes.status()).toBe(200);

    const logoutRes = await request.post(`${API_BASE_URL}/api/v1/auth/logout`, {
      data: { refresh_token: loginJson.refresh_token },
      headers: { Authorization: `Bearer ${loginJson.access_token}` },
    });
    assertNo5xx(logoutRes.status(), "logout");
    expect(logoutRes.status()).toBe(200);

    const meAfter = await request.get(`${API_BASE_URL}/api/v1/auth/me`, {
      headers: { Authorization: `Bearer ${loginJson.access_token}` },
    });
    assertNo5xx(meAfter.status(), "auth/me after logout");
    expect(meAfter.status()).toBe(401);

    const refreshAfter = await request.post(`${API_BASE_URL}/api/v1/auth/refresh`, {
      data: { refresh_token: loginJson.refresh_token },
    });
    assertNo5xx(refreshAfter.status(), "refresh after logout");
    expect(refreshAfter.status()).toBe(401);
  });
});
