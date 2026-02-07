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

test.describe("Atomic logout-all cross-user cookie isolation (break-it; no 5xx)", () => {
  test.describe.configure({ mode: "serial" });

  test("logout-all with access token must not revoke another user's refresh token", async ({ request }) => {
    const tokenA = makeIsolatedToken("logoutall-cross-a");
    const tokenB = makeIsolatedToken("logoutall-cross-b");

    const userA = await loginRaw(request, tokenA);
    const userB = await loginRaw(request, tokenB);

    const logoutAllRes = await request.post(`${API_BASE_URL}/api/v1/auth/logout-all`, {
      headers: {
        Authorization: `Bearer ${userA.accessToken}`,
        Cookie: `refresh_token=${userB.refreshToken}`,
      },
    });
    assertNo5xx(logoutAllRes.status(), "logout-all cross-user");
    expect(logoutAllRes.status()).toBe(200);

    const refreshA = await request.post(`${API_BASE_URL}/api/v1/auth/refresh`, {
      data: { refresh_token: userA.refreshToken },
    });
    assertNo5xx(refreshA.status(), "refresh after logout-all (user A)");
    expect(refreshA.status()).toBe(401);

    const refreshB = await request.post(`${API_BASE_URL}/api/v1/auth/refresh`, {
      data: { refresh_token: userB.refreshToken },
    });
    assertNo5xx(refreshB.status(), "refresh after logout-all (user B)");
    expect(refreshB.status()).toBe(200);
  });
});
