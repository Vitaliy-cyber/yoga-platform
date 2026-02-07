import { test, expect, request as playwrightRequest } from "@playwright/test";
import { assertNo5xx } from "./atomic-helpers";

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

test.describe("Atomic refresh failure clears cookies (break-it; no 5xx)", () => {
  test.describe.configure({ mode: "serial" });

  test("invalid refresh token clears refresh + csrf cookies", async ({ request }) => {
    const loginToken = `atomic-refresh-csrf-${Date.now()}`;
    const loginRes = await request.post(`${API_BASE_URL}/api/v1/auth/login`, {
      data: { token: loginToken },
    });
    assertNo5xx(loginRes.status(), "login");
    expect(loginRes.status()).toBe(200);
    const loginCookies = getSetCookies(loginRes);
    const csrfCookie = findCookie(loginCookies, "csrf_token", (cookie) => cookie.includes("Path=/"));
    const csrfToken = csrfCookie ? extractCookieValue(csrfCookie, "csrf_token") : undefined;
    expect(csrfToken).toBeTruthy();

    const bare = await playwrightRequest.newContext({
      storageState: { cookies: [], origins: [] },
    });
    const res = await bare.post(`${API_BASE_URL}/api/v1/auth/refresh`, {
      headers: {
        Cookie: `refresh_token=invalid.refresh.token; csrf_token=${csrfToken}`,
        "X-CSRF-Token": csrfToken ?? "",
      },
    });
    await bare.dispose();

    assertNo5xx(res.status(), "refresh invalid");
    expect([400, 401]).toContain(res.status());

    const cookies = getSetCookies(res);
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
  });
});
