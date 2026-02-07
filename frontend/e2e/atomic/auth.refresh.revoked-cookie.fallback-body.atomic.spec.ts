import { test, expect, request as playwrightRequest } from "@playwright/test";
import { assertNo5xx } from "./atomic-helpers";
import { makeIsolatedToken } from "./atomic-http";

const API_BASE_URL = process.env.PLAYWRIGHT_API_URL || "http://localhost:8000";

type LoginResponse = { refresh_token: string };

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

async function loginWithCsrf(
  ctx: import("@playwright/test").APIRequestContext,
  token: string,
): Promise<{ refreshToken: string; csrfToken: string }> {
  const res = await ctx.post(`${API_BASE_URL}/api/v1/auth/login`, {
    data: { token },
  });
  assertNo5xx(res.status(), "login");
  expect(res.status()).toBe(200);
  const json = (await res.json()) as LoginResponse;
  const cookies = getSetCookies(res);
  const csrfToken = getCookieValue(cookies, "csrf_token");
  expect(json.refresh_token).toBeTruthy();
  expect(csrfToken).toBeTruthy();
  return { refreshToken: json.refresh_token, csrfToken: csrfToken ?? "" };
}

test.describe("Atomic refresh revoked cookie fallback to body (break-it; no 5xx)", () => {
  test.describe.configure({ mode: "serial" });

  test("revoked cookie must not block valid body refresh token", async ({ request }) => {
    const token = makeIsolatedToken("refresh-revoked-cookie-fallback");
    const first = await loginWithCsrf(request, token);
    const second = await loginWithCsrf(request, token);

    const bare = await playwrightRequest.newContext({
      storageState: { cookies: [], origins: [] },
    });

    const logoutRes = await bare.post(`${API_BASE_URL}/api/v1/auth/logout`, {
      headers: {
        Cookie: `refresh_token=${first.refreshToken}; csrf_token=${first.csrfToken}`,
        "X-CSRF-Token": first.csrfToken,
      },
    });
    assertNo5xx(logoutRes.status(), "logout to revoke first refresh token");
    expect(logoutRes.status()).toBe(200);

    const refreshRes = await bare.post(`${API_BASE_URL}/api/v1/auth/refresh`, {
      data: { refresh_token: second.refreshToken },
      headers: {
        Cookie: `refresh_token=${first.refreshToken}; csrf_token=${first.csrfToken}`,
        "X-CSRF-Token": first.csrfToken,
      },
    });
    assertNo5xx(refreshRes.status(), "refresh with revoked cookie + body token");
    expect(refreshRes.status()).toBe(200);

    await bare.dispose();
  });
});
