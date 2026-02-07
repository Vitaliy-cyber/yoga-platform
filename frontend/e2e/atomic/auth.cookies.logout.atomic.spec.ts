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

test.describe("Atomic auth cookies + logout hardening (break-it; no 5xx)", () => {
  test.describe.configure({ mode: "serial" });

  test("login sets refresh+csrf cookies with expected flags", async ({ request }) => {
    const token = makeIsolatedToken("auth-cookie-login");
    const res = await request.post(`${API_BASE_URL}/api/v1/auth/login`, {
      data: { token },
    });

    assertNo5xx(res.status(), "login");
    expect(res.status()).toBe(200);

    const cookies = getSetCookies(res);

    const refreshCookie = findCookie(
      cookies,
      "refresh_token",
      (cookie) => cookie.includes("Path=/") && !cookie.toLowerCase().includes("max-age=0"),
    );
    expect(refreshCookie).toBeTruthy();
    const refreshLower = (refreshCookie ?? "").toLowerCase();
    expect(refreshLower).toContain("httponly");
    expect(refreshLower).toContain("samesite=lax");

    const csrfCookie = findCookie(cookies, "csrf_token", (cookie) => cookie.includes("Path=/"));
    expect(csrfCookie).toBeTruthy();
    const csrfLower = (csrfCookie ?? "").toLowerCase();
    expect(csrfLower).toContain("samesite=strict");
    expect(csrfLower).not.toContain("httponly");
  });

  test("refresh accepts cookie and rotates refresh token", async ({ request }) => {
    const token = makeIsolatedToken("auth-cookie-refresh");
    const loginRes = await request.post(`${API_BASE_URL}/api/v1/auth/login`, {
      data: { token },
    });
    assertNo5xx(loginRes.status(), "login");
    expect(loginRes.status()).toBe(200);
    const loginJson = (await loginRes.json()) as { refresh_token: string };
    const loginCookies = getSetCookies(loginRes);
    const csrfCookie = findCookie(
      loginCookies,
      "csrf_token",
      (cookie) => cookie.includes("Path=/"),
    );
    const csrfToken = csrfCookie ? extractCookieValue(csrfCookie, "csrf_token") : undefined;
    expect(csrfToken).toBeTruthy();

    const refreshRes = await request.post(`${API_BASE_URL}/api/v1/auth/refresh`, {
      headers: {
        Cookie: `refresh_token=${loginJson.refresh_token}; csrf_token=${csrfToken}`,
        "X-CSRF-Token": csrfToken ?? "",
      },
    });
    assertNo5xx(refreshRes.status(), "refresh");
    expect(refreshRes.status()).toBe(200);

    const refreshJson = (await refreshRes.json()) as { refresh_token: string; access_token: string };
    expect(refreshJson.access_token).toBeTruthy();
    expect(refreshJson.refresh_token).toBeTruthy();
    expect(refreshJson.refresh_token).not.toBe(loginJson.refresh_token);

    const cookies = getSetCookies(refreshRes);
    const refreshCookie = findCookie(
      cookies,
      "refresh_token",
      (cookie) => cookie.includes("Path=/") && !cookie.toLowerCase().includes("max-age=0"),
    );
    expect(refreshCookie).toBeTruthy();
  });

  test("logout without Authorization clears cookies and revokes refresh token", async ({ request }) => {
    const token = makeIsolatedToken("auth-cookie-logout");
    const loginRes = await request.post(`${API_BASE_URL}/api/v1/auth/login`, {
      data: { token },
    });
    assertNo5xx(loginRes.status(), "login");
    expect(loginRes.status()).toBe(200);
    const loginJson = (await loginRes.json()) as { refresh_token: string };
    const cookies = getSetCookies(loginRes);
    const csrfCookie = findCookie(cookies, "csrf_token", (cookie) => cookie.includes("Path=/"));
    const csrfToken = csrfCookie ? extractCookieValue(csrfCookie, "csrf_token") : undefined;
    expect(csrfToken).toBeTruthy();

    const logoutRes = await request.post(`${API_BASE_URL}/api/v1/auth/logout`, {
      headers: {
        Cookie: `refresh_token=${loginJson.refresh_token}; csrf_token=${csrfToken}`,
        "X-CSRF-Token": csrfToken ?? "",
      },
    });
    assertNo5xx(logoutRes.status(), "logout");
    expect(logoutRes.status()).toBe(200);

    const logoutCookies = getSetCookies(logoutRes);
    const refreshClear = findCookie(
      logoutCookies,
      "refresh_token",
      (cookie) => cookie.includes("Path=/") && cookie.toLowerCase().includes("max-age=0"),
    );
    expect(refreshClear).toBeTruthy();

    const csrfClear = findCookie(
      logoutCookies,
      "csrf_token",
      (cookie) => cookie.includes("Path=/") && cookie.toLowerCase().includes("max-age=0"),
    );
    expect(csrfClear).toBeTruthy();

    const refreshAfter = await request.post(`${API_BASE_URL}/api/v1/auth/refresh`, {
      data: { refresh_token: loginJson.refresh_token },
    });
    assertNo5xx(refreshAfter.status(), "refresh after logout");
    expect(refreshAfter.status()).toBe(401);
  });
});
