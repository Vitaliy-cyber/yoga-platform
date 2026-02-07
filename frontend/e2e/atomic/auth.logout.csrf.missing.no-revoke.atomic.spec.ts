import { test, expect, request as playwrightRequest } from "@playwright/test";
import { assertNo5xx } from "./atomic-helpers";
import { makeIsolatedToken } from "./atomic-http";

const API_BASE_URL = process.env.PLAYWRIGHT_API_URL || "http://localhost:8000";

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

test.describe("Atomic logout missing CSRF does not revoke (break-it; no 5xx)", () => {
  test.describe.configure({ mode: "serial" });

  test("logout missing CSRF leaves refresh token valid", async ({ request }) => {
    const token = makeIsolatedToken("logout-csrf-missing-no-revoke");
    const loginRes = await request.post(`${API_BASE_URL}/api/v1/auth/login`, {
      data: { token },
    });
    assertNo5xx(loginRes.status(), "login");
    expect(loginRes.status()).toBe(200);

    const loginJson = (await loginRes.json()) as { refresh_token: string };
    const cookies = getSetCookies(loginRes);
    const refreshToken = loginJson.refresh_token;
    const csrfToken = getCookieValue(cookies, "csrf_token");
    expect(refreshToken).toBeTruthy();
    expect(csrfToken).toBeTruthy();

    const bare = await playwrightRequest.newContext({
      storageState: { cookies: [], origins: [] },
    });

    const missingCsrf = await bare.post(`${API_BASE_URL}/api/v1/auth/logout`, {
      headers: { Cookie: `refresh_token=${refreshToken}; csrf_token=${csrfToken}` },
    });
    assertNo5xx(missingCsrf.status(), "logout missing csrf");
    expect(missingCsrf.status()).toBe(403);

    const refreshRes = await bare.post(`${API_BASE_URL}/api/v1/auth/refresh`, {
      data: { refresh_token: refreshToken },
    });
    assertNo5xx(refreshRes.status(), "refresh after missing csrf logout");
    expect(refreshRes.status()).toBe(200);

    await bare.dispose();
  });
});
