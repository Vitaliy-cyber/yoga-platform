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

async function loginWithCookies(
  request: import("@playwright/test").APIRequestContext,
  token: string,
): Promise<{ refreshToken: string; csrfToken: string }> {
  const res = await request.post(`${API_BASE_URL}/api/v1/auth/login`, {
    data: { token },
  });
  assertNo5xx(res.status(), "login");
  expect(res.status()).toBe(200);
  const json = (await res.json()) as { refresh_token: string };
  const cookies = getSetCookies(res);
  const csrfToken = getCookieValue(cookies, "csrf_token");
  expect(json.refresh_token).toBeTruthy();
  expect(csrfToken).toBeTruthy();
  return { refreshToken: json.refresh_token, csrfToken: csrfToken ?? "" };
}

test.describe("Atomic logout-all CSRF mismatch (break-it; no 5xx)", () => {
  test.describe.configure({ mode: "serial" });

  test("mismatched CSRF token is rejected", async ({ request }) => {
    const userA = await loginWithCookies(request, makeIsolatedToken("logoutall-csrf-a"));
    const userB = await loginWithCookies(request, makeIsolatedToken("logoutall-csrf-b"));

    const bare = await playwrightRequest.newContext({
      storageState: { cookies: [], origins: [] },
    });

    const mismatch = await bare.post(`${API_BASE_URL}/api/v1/auth/logout-all`, {
      headers: {
        Cookie: `refresh_token=${userA.refreshToken}; csrf_token=${userA.csrfToken}`,
        "X-CSRF-Token": userB.csrfToken,
      },
    });
    assertNo5xx(mismatch.status(), "logout-all csrf mismatch");
    expect(mismatch.status()).toBe(403);

    const ok = await bare.post(`${API_BASE_URL}/api/v1/auth/logout-all`, {
      headers: {
        Cookie: `refresh_token=${userA.refreshToken}; csrf_token=${userA.csrfToken}`,
        "X-CSRF-Token": userA.csrfToken,
      },
    });
    assertNo5xx(ok.status(), "logout-all csrf ok");
    expect(ok.status()).toBe(200);

    await bare.dispose();
  });
});
