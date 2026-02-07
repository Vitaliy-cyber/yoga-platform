import { test, expect, request as playwrightRequest } from "@playwright/test";
import { assertNo5xx } from "./atomic-helpers";
import { makeIsolatedToken } from "./atomic-http";

const API_BASE_URL = process.env.PLAYWRIGHT_API_URL || "http://localhost:8000";

type LoginResponse = { access_token: string; refresh_token: string };

async function loginRaw(
  request: import("@playwright/test").APIRequestContext,
  token: string,
): Promise<LoginResponse> {
  const res = await request.post(`${API_BASE_URL}/api/v1/auth/login`, {
    data: { token },
  });
  assertNo5xx(res.status(), "login");
  expect(res.status()).toBe(200);
  const json = (await res.json()) as LoginResponse;
  expect(json.access_token).toBeTruthy();
  expect(json.refresh_token).toBeTruthy();
  return json;
}

test.describe("Atomic refresh CSRF bearer mismatch (break-it; no 5xx)", () => {
  test.describe.configure({ mode: "serial" });

  test("bearer token from another user must not bypass CSRF for refresh cookie", async ({ request }) => {
    const tokenA = makeIsolatedToken("refresh-bearer-mismatch-a");
    const tokenB = makeIsolatedToken("refresh-bearer-mismatch-b");

    const userA = await loginRaw(request, tokenA);
    const userB = await loginRaw(request, tokenB);

    const bare = await playwrightRequest.newContext({
      storageState: { cookies: [], origins: [] },
    });
    const refreshRes = await bare.post(`${API_BASE_URL}/api/v1/auth/refresh`, {
      headers: {
        Authorization: `Bearer ${userA.access_token}`,
        Cookie: `refresh_token=${userB.refresh_token}`,
      },
    });
    assertNo5xx(refreshRes.status(), "refresh bearer mismatch");
    expect(refreshRes.status()).toBe(403);
    await bare.dispose();
  });
});
