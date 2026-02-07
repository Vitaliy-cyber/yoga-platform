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

test.describe("Atomic refresh with bearer (no CSRF) (break-it; no 5xx)", () => {
  test.describe.configure({ mode: "serial" });

  test("refresh with valid bearer + cookie works without X-CSRF-Token", async ({ request }) => {
    const token = makeIsolatedToken("refresh-bearer-no-csrf");
    const loginRes = await request.post(`${API_BASE_URL}/api/v1/auth/login`, {
      data: { token },
    });
    assertNo5xx(loginRes.status(), "login");
    expect(loginRes.status()).toBe(200);

    const loginJson = (await loginRes.json()) as { access_token: string; refresh_token: string };
    const cookies = getSetCookies(loginRes);
    const refreshToken = loginJson.refresh_token;
    const csrfToken = getCookieValue(cookies, "csrf_token");
    expect(loginJson.access_token).toBeTruthy();
    expect(refreshToken).toBeTruthy();
    expect(csrfToken).toBeTruthy();

    const bare = await playwrightRequest.newContext({
      storageState: { cookies: [], origins: [] },
    });
    const refreshRes = await bare.post(`${API_BASE_URL}/api/v1/auth/refresh`, {
      headers: {
        Authorization: `Bearer ${loginJson.access_token}`,
        Cookie: `refresh_token=${refreshToken}; csrf_token=${csrfToken}`,
      },
    });
    assertNo5xx(refreshRes.status(), "refresh bearer no csrf");
    expect(refreshRes.status()).toBe(200);
    await bare.dispose();
  });
});
