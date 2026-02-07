import { test, expect, request as playwrightRequest } from "@playwright/test";
import { assertNo5xx } from "./atomic-helpers";
import { makeIsolatedToken } from "./atomic-http";

const API_BASE_URL = process.env.PLAYWRIGHT_API_URL || "http://localhost:8000";

type LoginResponse = { access_token: string; refresh_token: string };

async function loginRaw(
  request: import("@playwright/test").APIRequestContext,
  token: string,
): Promise<LoginResponse> {
  const res = await request.post(`${API_BASE_URL}/api/v1/auth/login`, {
    data: { token },
  });
  assertNo5xx(res.status(), "login");
  expect(res.status()).toBe(200);
  const json = (await res.json()) as LoginResponse;
  expect(json.access_token).toBeTruthy();
  expect(json.refresh_token).toBeTruthy();
  return json;
}

test.describe("Atomic logout cookie mismatch allows body token revoke (break-it; no 5xx)", () => {
  test.describe.configure({ mode: "serial" });

  test("logout with mismatched cookie must still revoke body token for authenticated user", async ({ request }) => {
    const tokenA = makeIsolatedToken("logout-cookie-mismatch-a");
    const tokenB = makeIsolatedToken("logout-cookie-mismatch-b");

    const userA = await loginRaw(request, tokenA);
    const userB = await loginRaw(request, tokenB);

    const logoutRes = await request.post(`${API_BASE_URL}/api/v1/auth/logout`, {
      data: { refresh_token: userA.refresh_token },
      headers: {
        Authorization: `Bearer ${userA.access_token}`,
        Cookie: `refresh_token=${userB.refresh_token}`,
      },
    });
    assertNo5xx(logoutRes.status(), "logout cookie mismatch");
    expect(logoutRes.status()).toBe(200);

    const bare = await playwrightRequest.newContext({
      storageState: { cookies: [], origins: [] },
    });
    const refreshA = await bare.post(`${API_BASE_URL}/api/v1/auth/refresh`, {
      data: { refresh_token: userA.refresh_token },
    });
    assertNo5xx(refreshA.status(), "refresh after logout (user A)");
    expect(refreshA.status()).toBe(401);

    const refreshB = await bare.post(`${API_BASE_URL}/api/v1/auth/refresh`, {
      data: { refresh_token: userB.refresh_token },
    });
    assertNo5xx(refreshB.status(), "refresh after logout (user B)");
    expect(refreshB.status()).toBe(200);
    await bare.dispose();
  });
});
