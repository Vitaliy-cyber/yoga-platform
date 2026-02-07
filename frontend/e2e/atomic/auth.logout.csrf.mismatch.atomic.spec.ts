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

test.describe("Atomic logout CSRF mismatch (break-it; no 5xx)", () => {
  test.describe.configure({ mode: "serial" });

  test("logout with cookie rejects mismatched X-CSRF-Token", async ({ request }) => {
    const token = makeIsolatedToken("auth-logout-csrf-mismatch");
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

    const mismatch = await bare.post(`${API_BASE_URL}/api/v1/auth/logout`, {
      headers: {
        Cookie: `refresh_token=${refreshToken}; csrf_token=${csrfToken}`,
        "X-CSRF-Token": "invalid-csrf-token",
      },
    });
    assertNo5xx(mismatch.status(), "logout csrf mismatch");
    expect(mismatch.status()).toBe(403);

    const refreshRes = await bare.post(`${API_BASE_URL}/api/v1/auth/refresh`, {
      data: { refresh_token: refreshToken },
    });
    assertNo5xx(refreshRes.status(), "refresh after mismatch");
    expect(refreshRes.status()).toBe(200);
    const refreshJson = (await refreshRes.json()) as { refresh_token: string };
    const refreshCookies = getSetCookies(refreshRes);
    const rotatedRefresh = refreshJson.refresh_token;
    const rotatedCsrf = getCookieValue(refreshCookies, "csrf_token");
    expect(rotatedRefresh).toBeTruthy();
    expect(rotatedCsrf).toBeTruthy();

    const ok = await bare.post(`${API_BASE_URL}/api/v1/auth/logout`, {
      headers: {
        Cookie: `refresh_token=${rotatedRefresh}; csrf_token=${rotatedCsrf}`,
        "X-CSRF-Token": rotatedCsrf ?? "",
      },
    });
    assertNo5xx(ok.status(), "logout with csrf");
    expect(ok.status()).toBe(200);

    const refreshAfter = await bare.post(`${API_BASE_URL}/api/v1/auth/refresh`, {
      data: { refresh_token: rotatedRefresh },
    });
    assertNo5xx(refreshAfter.status(), "refresh after logout");
    expect(refreshAfter.status()).toBe(401);

    await bare.dispose();
  });
});
