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

test.describe("Atomic logout-all invalid CSRF cross-user fallback (break-it; no 5xx)", () => {
  test.describe.configure({ mode: "serial" });

  test("invalid CSRF with cookie A + body B revokes only B", async ({ request }) => {
    const tokenA = makeIsolatedToken("logoutall-invalid-csrf-a");
    const tokenB = makeIsolatedToken("logoutall-invalid-csrf-b");

    const loginA = await request.post(`${API_BASE_URL}/api/v1/auth/login`, {
      data: { token: tokenA },
    });
    assertNo5xx(loginA.status(), "login A");
    expect(loginA.status()).toBe(200);
    const loginAJson = (await loginA.json()) as { refresh_token: string };
    const cookiesA = getSetCookies(loginA);
    const csrfA = getCookieValue(cookiesA, "csrf_token");
    expect(loginAJson.refresh_token).toBeTruthy();
    expect(csrfA).toBeTruthy();

    const loginB = await request.post(`${API_BASE_URL}/api/v1/auth/login`, {
      data: { token: tokenB },
    });
    assertNo5xx(loginB.status(), "login B");
    expect(loginB.status()).toBe(200);
    const loginBJson = (await loginB.json()) as { refresh_token: string };
    expect(loginBJson.refresh_token).toBeTruthy();

    const bare = await playwrightRequest.newContext({
      storageState: { cookies: [], origins: [] },
    });

    const logoutAllRes = await bare.post(`${API_BASE_URL}/api/v1/auth/logout-all`, {
      data: { refresh_token: loginBJson.refresh_token },
      headers: {
        Cookie: `refresh_token=${loginAJson.refresh_token}; csrf_token=${csrfA}`,
        "X-CSRF-Token": "invalid-csrf-token",
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    });
    assertNo5xx(logoutAllRes.status(), "logout-all invalid csrf cross-user");
    expect(logoutAllRes.status()).toBe(200);

    const refreshA = await bare.post(`${API_BASE_URL}/api/v1/auth/refresh`, {
      data: { refresh_token: loginAJson.refresh_token },
    });
    assertNo5xx(refreshA.status(), "refresh A after logout-all");
    expect(refreshA.status()).toBe(200);

    const refreshB = await bare.post(`${API_BASE_URL}/api/v1/auth/refresh`, {
      data: { refresh_token: loginBJson.refresh_token },
    });
    assertNo5xx(refreshB.status(), "refresh B after logout-all");
    expect(refreshB.status()).toBe(401);

    await bare.dispose();
  });
});
