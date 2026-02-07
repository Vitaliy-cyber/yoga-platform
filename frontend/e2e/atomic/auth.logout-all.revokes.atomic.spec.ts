import { test, expect } from "@playwright/test";
import { assertNo5xx } from "./atomic-helpers";
import { makeIsolatedToken } from "./atomic-http";

const API_BASE_URL = process.env.PLAYWRIGHT_API_URL || "http://localhost:8000";

function getSetCookies(response: import("@playwright/test").APIResponse): string[] {
  return response
    .headersArray()
    .filter((h) => h.name.toLowerCase() === "set-cookie")
    .map((h) => h.value);
}

function findCookie(
  cookies: string[],
  name: string,
  predicate?: (cookie: string) => boolean,
): string | undefined {
  return cookies.find((cookie) => {
    if (!cookie.startsWith(`${name}=`)) return false;
    return predicate ? predicate(cookie) : true;
  });
}

function extractCookieValue(cookie: string, name: string): string | undefined {
  if (!cookie.startsWith(`${name}=`)) return undefined;
  const prefix = `${name}=`;
  return cookie.split(";")[0].slice(prefix.length);
}

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
  const cookies = getSetCookies(res);
  const csrfCookie = findCookie(cookies, "csrf_token", (cookie) => cookie.includes("Path=/"));
  const csrfToken = csrfCookie ? extractCookieValue(csrfCookie, "csrf_token") : undefined;
  expect(csrfToken).toBeTruthy();
  return { accessToken: json.access_token, refreshToken: json.refresh_token, csrfToken: csrfToken ?? "" };
}

test.describe("Atomic auth logout-all revokes sessions (break-it; no 5xx)", () => {
  test.describe.configure({ mode: "serial" });

  test("logout-all with refresh cookie revokes all refresh tokens", async ({ request }) => {
    const token = makeIsolatedToken("auth-logout-all");
    const first = await loginRaw(request, token);
    const second = await loginRaw(request, token);

    const logoutAllRes = await request.post(`${API_BASE_URL}/api/v1/auth/logout-all`, {
      headers: {
        Cookie: `refresh_token=${first.refreshToken}; csrf_token=${first.csrfToken}`,
        "X-CSRF-Token": first.csrfToken,
      },
    });
    assertNo5xx(logoutAllRes.status(), "logout-all");
    expect(logoutAllRes.status()).toBe(200);

    const cookies = getSetCookies(logoutAllRes);
    const refreshClear = findCookie(
      cookies,
      "refresh_token",
      (cookie) => cookie.includes("Path=/") && cookie.toLowerCase().includes("max-age=0"),
    );
    expect(refreshClear).toBeTruthy();

    const csrfClear = findCookie(
      cookies,
      "csrf_token",
      (cookie) => cookie.includes("Path=/") && cookie.toLowerCase().includes("max-age=0"),
    );
    expect(csrfClear).toBeTruthy();

    const refreshFirst = await request.post(`${API_BASE_URL}/api/v1/auth/refresh`, {
      data: { refresh_token: first.refreshToken },
    });
    assertNo5xx(refreshFirst.status(), "refresh after logout-all (first)");
    expect(refreshFirst.status()).toBe(401);

    const refreshSecond = await request.post(`${API_BASE_URL}/api/v1/auth/refresh`, {
      data: { refresh_token: second.refreshToken },
    });
    assertNo5xx(refreshSecond.status(), "refresh after logout-all (second)");
    expect(refreshSecond.status()).toBe(401);
  });
});
