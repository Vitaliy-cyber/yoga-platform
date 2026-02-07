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

test.describe("Atomic refresh cookie precedence with revoked body (break-it; no 5xx)", () => {
  test.describe.configure({ mode: "serial" });

  test("valid cookie must win even if body token is revoked", async ({ request }) => {
    const token = makeIsolatedToken("refresh-cookie-precedence-revoked-body");
    const loginRes = await request.post(`${API_BASE_URL}/api/v1/auth/login`, {
      data: { token },
    });
    assertNo5xx(loginRes.status(), "login");
    expect(loginRes.status()).toBe(200);

    const loginJson = (await loginRes.json()) as { refresh_token: string };
    const loginCookies = getSetCookies(loginRes);
    const csrf1 = getCookieValue(loginCookies, "csrf_token");
    expect(loginJson.refresh_token).toBeTruthy();
    expect(csrf1).toBeTruthy();

    const bare = await playwrightRequest.newContext({
      storageState: { cookies: [], origins: [] },
    });

    const rotateRes = await bare.post(`${API_BASE_URL}/api/v1/auth/refresh`, {
      headers: {
        Cookie: `refresh_token=${loginJson.refresh_token}; csrf_token=${csrf1}`,
        "X-CSRF-Token": csrf1 ?? "",
      },
    });
    assertNo5xx(rotateRes.status(), "refresh rotation");
    expect(rotateRes.status()).toBe(200);
    const rotateJson = (await rotateRes.json()) as { refresh_token: string };
    const rotateCookies = getSetCookies(rotateRes);
    const csrf2 = getCookieValue(rotateCookies, "csrf_token");
    expect(rotateJson.refresh_token).toBeTruthy();
    expect(csrf2).toBeTruthy();

    const refreshRes = await bare.post(`${API_BASE_URL}/api/v1/auth/refresh`, {
      data: { refresh_token: loginJson.refresh_token },
      headers: {
        Cookie: `refresh_token=${rotateJson.refresh_token}; csrf_token=${csrf2}`,
        "X-CSRF-Token": csrf2 ?? "",
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    });
    assertNo5xx(refreshRes.status(), "refresh cookie precedence over revoked body");
    expect(refreshRes.status()).toBe(200);

    await bare.dispose();
  });
});
