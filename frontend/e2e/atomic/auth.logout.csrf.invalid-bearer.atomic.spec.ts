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

function getCookieValue(cookies: string[], name: string): string | undefined {
  const raw = cookies.find((cookie) => cookie.startsWith(`${name}=`));
  if (!raw) return undefined;
  const prefix = `${name}=`;
  return raw.split(";")[0].slice(prefix.length);
}

test.describe("Atomic logout CSRF with invalid bearer (break-it; no 5xx)", () => {
  test.describe.configure({ mode: "serial" });

  test("invalid bearer must not bypass CSRF requirement", async ({ request }) => {
    const token = makeIsolatedToken("logout-csrf-invalid-bearer");
    const loginRes = await request.post(`${API_BASE_URL}/api/v1/auth/login`, {
      data: { token },
    });
    assertNo5xx(loginRes.status(), "login");
    expect(loginRes.status()).toBe(200);
    const loginJson = (await loginRes.json()) as { refresh_token: string };
    expect(loginJson.refresh_token).toBeTruthy();
    const cookies = getSetCookies(loginRes);
    const csrfToken = getCookieValue(cookies, "csrf_token");
    expect(csrfToken).toBeTruthy();

    const logoutRes = await request.post(`${API_BASE_URL}/api/v1/auth/logout`, {
      headers: {
        Cookie: `refresh_token=${loginJson.refresh_token}; csrf_token=${csrfToken}`,
        Authorization: "Bearer invalid.token",
      },
    });
    assertNo5xx(logoutRes.status(), "logout invalid bearer");
    expect(logoutRes.status()).toBe(403);
  });
});
