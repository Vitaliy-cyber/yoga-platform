import { test, expect, request as playwrightRequest } from "@playwright/test";
import { assertNo5xx } from "./atomic-helpers";
import { makeIsolatedToken } from "./atomic-http";

const API_BASE_URL = process.env.PLAYWRIGHT_API_URL || "http://localhost:8000";

async function loginRaw(
  request: import("@playwright/test").APIRequestContext,
  token: string,
): Promise<{ refreshToken: string; csrfToken: string }> {
  const res = await request.post(`${API_BASE_URL}/api/v1/auth/login`, {
    data: { token },
  });
  assertNo5xx(res.status(), "login");
  expect(res.status()).toBe(200);
  const json = (await res.json()) as { refresh_token: string };
  expect(json.refresh_token).toBeTruthy();
  const cookies = res
    .headersArray()
    .filter((h) => h.name.toLowerCase() === "set-cookie")
    .map((h) => h.value);
  const csrfCookie = cookies.find((cookie) => cookie.startsWith("csrf_token="));
  const csrfToken = csrfCookie ? csrfCookie.split(";")[0].slice("csrf_token=".length) : undefined;
  expect(csrfToken).toBeTruthy();
  return { refreshToken: json.refresh_token, csrfToken: csrfToken ?? "" };
}

test.describe("Atomic logout-all with rotated refresh token (break-it; no 5xx)", () => {
  test.describe.configure({ mode: "serial" });

  test("rotated (old) refresh token must not authorize logout-all", async ({ request }) => {
    const token = makeIsolatedToken("auth-logout-all-rotated-rt");
    const first = await loginRaw(request, token);

    const rotateRes = await request.post(`${API_BASE_URL}/api/v1/auth/refresh`, {
      data: { refresh_token: first.refreshToken },
    });
    assertNo5xx(rotateRes.status(), "refresh rotate");
    expect(rotateRes.status()).toBe(200);
    const rotateJson = (await rotateRes.json()) as { refresh_token: string };
    const rotated = rotateJson.refresh_token;
    expect(rotated).toBeTruthy();
    expect(rotated).not.toBe(first.refreshToken);

    const bareRequest = await playwrightRequest.newContext({
      storageState: { cookies: [], origins: [] },
    });
    const logoutAllRes = await bareRequest.post(`${API_BASE_URL}/api/v1/auth/logout-all`, {
      data: { refresh_token: first.refreshToken },
      headers: {
        Cookie: `refresh_token=${first.refreshToken}; csrf_token=${first.csrfToken}`,
        "X-CSRF-Token": first.csrfToken,
      },
    });
    assertNo5xx(logoutAllRes.status(), "logout-all with rotated refresh token");
    expect([400, 401, 403]).toContain(logoutAllRes.status());

    const refreshAfter = await request.post(`${API_BASE_URL}/api/v1/auth/refresh`, {
      data: { refresh_token: rotated },
    });
    assertNo5xx(refreshAfter.status(), "refresh after rotated logout-all attempt");
    expect(refreshAfter.status()).toBe(200);
    await bareRequest.dispose();
  });
});
