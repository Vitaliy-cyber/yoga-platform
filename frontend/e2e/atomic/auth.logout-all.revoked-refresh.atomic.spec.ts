import { test, expect, request as playwrightRequest } from "@playwright/test";
import { assertNo5xx } from "./atomic-helpers";
import { makeIsolatedToken } from "./atomic-http";

const API_BASE_URL = process.env.PLAYWRIGHT_API_URL || "http://localhost:8000";

async function loginRaw(
  request: import("@playwright/test").APIRequestContext,
  token: string,
): Promise<{ accessToken: string; refreshToken: string; csrfToken: string }> {
  const res = await request.post(`${API_BASE_URL}/api/v1/auth/login`, {
    data: { token },
  });
  assertNo5xx(res.status(), "login");
  expect(res.status()).toBe(200);
  const json = (await res.json()) as { access_token: string; refresh_token: string };
  expect(json.access_token).toBeTruthy();
  expect(json.refresh_token).toBeTruthy();
  const cookies = res
    .headersArray()
    .filter((h) => h.name.toLowerCase() === "set-cookie")
    .map((h) => h.value);
  const csrfCookie = cookies.find((cookie) => cookie.startsWith("csrf_token="));
  const csrfToken = csrfCookie ? csrfCookie.split(";")[0].slice("csrf_token=".length) : undefined;
  expect(csrfToken).toBeTruthy();
  return { accessToken: json.access_token, refreshToken: json.refresh_token, csrfToken: csrfToken ?? "" };
}

test.describe("Atomic logout-all with revoked refresh token (break-it; no 5xx)", () => {
  test.describe.configure({ mode: "serial" });

  test("revoked refresh token must not authorize logout-all", async ({ request }) => {
    const token = makeIsolatedToken("auth-logout-all-revoked-rt");
    const first = await loginRaw(request, token);
    const second = await loginRaw(request, token);

    const bareRequest = await playwrightRequest.newContext({
      storageState: { cookies: [], origins: [] },
    });
    const logoutRes = await bareRequest.post(`${API_BASE_URL}/api/v1/auth/logout`, {
      data: { refresh_token: first.refreshToken },
      headers: {
        Cookie: `refresh_token=${first.refreshToken}; csrf_token=${first.csrfToken}`,
        "X-CSRF-Token": first.csrfToken,
      },
    });
    assertNo5xx(logoutRes.status(), "logout (revoke first)");
    expect(logoutRes.status()).toBe(200);

    const logoutAllRes = await bareRequest.post(`${API_BASE_URL}/api/v1/auth/logout-all`, {
      data: { refresh_token: first.refreshToken },
      headers: {
        Cookie: `refresh_token=${first.refreshToken}; csrf_token=${first.csrfToken}`,
        "X-CSRF-Token": first.csrfToken,
      },
    });
    assertNo5xx(logoutAllRes.status(), "logout-all with revoked refresh token");
    expect([400, 401, 403]).toContain(logoutAllRes.status());

    const refreshSecond = await request.post(`${API_BASE_URL}/api/v1/auth/refresh`, {
      data: { refresh_token: second.refreshToken },
    });
    assertNo5xx(refreshSecond.status(), "refresh after revoked logout-all attempt");
    expect(refreshSecond.status()).toBe(200);
    await bareRequest.dispose();
  });
});
