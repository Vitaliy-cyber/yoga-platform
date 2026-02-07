import { test, expect, request as playwrightRequest } from "@playwright/test";
import { assertNo5xx } from "./atomic-helpers";
import { makeIsolatedToken } from "./atomic-http";

const API_BASE_URL = process.env.PLAYWRIGHT_API_URL || "http://localhost:8000";

test.describe("Atomic logout invalid cookie fallback (no CSRF) (break-it; no 5xx)", () => {
  test.describe.configure({ mode: "serial" });

  test("invalid refresh cookie should not block body logout without CSRF", async ({ request }) => {
    const token = makeIsolatedToken("logout-invalid-cookie-fallback");
    const loginRes = await request.post(`${API_BASE_URL}/api/v1/auth/login`, {
      data: { token },
    });
    assertNo5xx(loginRes.status(), "login");
    expect(loginRes.status()).toBe(200);
    const loginJson = (await loginRes.json()) as { refresh_token: string };
    expect(loginJson.refresh_token).toBeTruthy();

    const bare = await playwrightRequest.newContext({
      storageState: { cookies: [], origins: [] },
    });
    const logoutRes = await bare.post(`${API_BASE_URL}/api/v1/auth/logout`, {
      data: { refresh_token: loginJson.refresh_token },
      headers: {
        Cookie: "refresh_token=invalid.refresh.token",
      },
    });
    assertNo5xx(logoutRes.status(), "logout invalid cookie fallback");
    expect(logoutRes.status()).toBe(200);

    const refreshAfter = await bare.post(`${API_BASE_URL}/api/v1/auth/refresh`, {
      data: { refresh_token: loginJson.refresh_token },
    });
    assertNo5xx(refreshAfter.status(), "refresh after logout");
    expect(refreshAfter.status()).toBe(401);
    await bare.dispose();
  });
});
