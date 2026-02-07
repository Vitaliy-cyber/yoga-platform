import { test, expect, request as playwrightRequest } from "@playwright/test";
import { assertNo5xx } from "./atomic-helpers";
import { makeIsolatedToken } from "./atomic-http";

const API_BASE_URL = process.env.PLAYWRIGHT_API_URL || "http://localhost:8000";

type LoginResponse = { refresh_token: string; csrf_token: string };

function getSetCookies(response: import("@playwright/test").APIResponse): string[] {
  return response
    .headersArray()
    .filter((h) => h.name.toLowerCase() === "set-cookie")
    .map((h) => h.value);
}

function getCookieValue(cookies: string[], name: string): string | undefined {
  const raw = cookies.find((cookie) => cookie.startsWith(`${name}=`));
  if (!raw) return undefined;
  const prefix = `${name}=`;
  return raw.split(";")[0].slice(prefix.length);
}

async function loginRaw(
  request: import("@playwright/test").APIRequestContext,
  token: string,
): Promise<LoginResponse> {
  const res = await request.post(`${API_BASE_URL}/api/v1/auth/login`, {
    data: { token },
  });
  assertNo5xx(res.status(), "login");
  expect(res.status()).toBe(200);
  const json = (await res.json()) as { refresh_token: string };
  expect(json.refresh_token).toBeTruthy();
  const cookies = getSetCookies(res);
  const csrfToken = getCookieValue(cookies, "csrf_token");
  expect(csrfToken).toBeTruthy();
  return { refresh_token: json.refresh_token, csrf_token: csrfToken ?? "" };
}

test.describe("Atomic logout revoked cookie fallback (break-it; no 5xx)", () => {
  test.describe.configure({ mode: "serial" });

  test("revoked refresh cookie should not block body-based logout", async ({ request }) => {
    const token = makeIsolatedToken("logout-revoked-cookie-body");
    const first = await loginRaw(request, token);
    const second = await loginRaw(request, token);

    const bare = await playwrightRequest.newContext({
      storageState: { cookies: [], origins: [] },
    });

    const revokeRes = await bare.post(`${API_BASE_URL}/api/v1/auth/logout`, {
      headers: {
        Cookie: `refresh_token=${first.refresh_token}; csrf_token=${first.csrf_token}`,
        "X-CSRF-Token": first.csrf_token,
      },
    });
    assertNo5xx(revokeRes.status(), "logout revoke first");
    expect(revokeRes.status()).toBe(200);

    const logoutRes = await bare.post(`${API_BASE_URL}/api/v1/auth/logout`, {
      data: { refresh_token: second.refresh_token },
      headers: {
        Cookie: `refresh_token=${first.refresh_token}; csrf_token=${first.csrf_token}`,
        "X-CSRF-Token": first.csrf_token,
      },
    });
    assertNo5xx(logoutRes.status(), "logout fallback to body");
    expect(logoutRes.status()).toBe(200);

    const refreshSecond = await bare.post(`${API_BASE_URL}/api/v1/auth/refresh`, {
      data: { refresh_token: second.refresh_token },
    });
    assertNo5xx(refreshSecond.status(), "refresh after logout");
    expect(refreshSecond.status()).toBe(401);
    await bare.dispose();
  });
});
