import { test, expect } from "@playwright/test";
import { assertNo5xx } from "./atomic-helpers";
import { authedFetch, loginWithToken, safeJson } from "./atomic-http";

const API_BASE_URL = process.env.PLAYWRIGHT_API_URL || "http://localhost:8000";
const USER1_TOKEN =
  process.env.E2E_TEST_TOKEN || "e2e-test-token-playwright-2024";

async function logout(accessToken: string): Promise<Response> {
  return fetch(`${API_BASE_URL}/api/v1/auth/logout`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });
}

test.describe("Atomic logout revokes access token (break-it; no 5xx)", () => {
  test.describe.configure({ mode: "serial" });

  test("access token becomes unusable immediately after logout", async () => {
    const { accessToken } = await loginWithToken(USER1_TOKEN);

    const me1 = await authedFetch(accessToken, "/api/v1/auth/me");
    assertNo5xx(me1.status, "auth/me before logout");
    expect(me1.status).toBe(200);

    const out = await logout(accessToken);
    assertNo5xx(out.status, "logout");
    expect([200, 401, 403]).toContain(out.status);
    await safeJson(out);

    const me2 = await authedFetch(accessToken, "/api/v1/auth/me");
    assertNo5xx(me2.status, "auth/me after logout");
    expect(me2.status).toBe(401);
  });
});

