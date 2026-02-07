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

test.describe("Atomic refresh CSRF with blacklisted bearer (break-it; no 5xx)", () => {
  test.describe.configure({ mode: "serial" });

  test("blacklisted bearer must not bypass CSRF requirement", async ({ request }) => {
    const token = makeIsolatedToken("refresh-csrf-blacklisted-bearer");
    const loginRes = await request.post(`${API_BASE_URL}/api/v1/auth/login`, {
      data: { token },
    });
    assertNo5xx(loginRes.status(), "login");
    expect(loginRes.status()).toBe(200);
    const loginJson = (await loginRes.json()) as { access_token: string; refresh_token: string };
    const cookies = getSetCookies(loginRes);
    const csrfToken = getCookieValue(cookies, "csrf_token");
    expect(loginJson.refresh_token).toBeTruthy();
    expect(csrfToken).toBeTruthy();

    const bare = await playwrightRequest.newContext({
      storageState: { cookies: [], origins: [] },
    });

    const logoutRes = await bare.post(`${API_BASE_URL}/api/v1/auth/logout`, {
      headers: {
        Authorization: `Bearer ${loginJson.access_token}`,
      },
    });
    assertNo5xx(logoutRes.status(), "logout to blacklist access token");
    expect(logoutRes.status()).toBe(200);

    const refreshRes = await bare.post(`${API_BASE_URL}/api/v1/auth/refresh`, {
      headers: {
        Authorization: `Bearer ${loginJson.access_token}`,
        Cookie: `refresh_token=${loginJson.refresh_token}; csrf_token=${csrfToken}`,
      },
    });
    assertNo5xx(refreshRes.status(), "refresh with blacklisted bearer");
    expect(refreshRes.status()).toBe(403);

    await bare.dispose();
  });
});
