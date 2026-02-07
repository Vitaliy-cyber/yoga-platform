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

async function loginWithContext(
  ctx: import("@playwright/test").APIRequestContext,
  token: string,
): Promise<{ accessToken: string; csrfToken: string }> {
  const res = await ctx.post(`${API_BASE_URL}/api/v1/auth/login`, {
    data: { token },
  });
  assertNo5xx(res.status(), "login");
  expect(res.status()).toBe(200);
  const json = (await res.json()) as { access_token: string };
  const cookies = getSetCookies(res);
  const csrfToken = getCookieValue(cookies, "csrf_token");
  expect(json.access_token).toBeTruthy();
  expect(csrfToken).toBeTruthy();
  return { accessToken: json.access_token, csrfToken: csrfToken ?? "" };
}

test.describe("Atomic sessions revoke other user (break-it; no 5xx)", () => {
  test.describe.configure({ mode: "serial" });

  test("cannot revoke another user's session id", async () => {
    const ctxA = await playwrightRequest.newContext({
      storageState: { cookies: [], origins: [] },
    });
    const ctxB = await playwrightRequest.newContext({
      storageState: { cookies: [], origins: [] },
    });

    const tokenA = makeIsolatedToken("auth-revoke-other-a");
    const tokenB = makeIsolatedToken("auth-revoke-other-b");

    const loginA = await loginWithContext(ctxA, tokenA);
    const loginB = await loginWithContext(ctxB, tokenB);

    const sessionsRes = await ctxB.get(`${API_BASE_URL}/api/v1/auth/sessions`, {
      headers: {
        Authorization: `Bearer ${loginB.accessToken}`,
      },
    });
    assertNo5xx(sessionsRes.status(), "sessions");
    expect(sessionsRes.status()).toBe(200);
    const sessionsJson = (await sessionsRes.json()) as { sessions: Array<{ id: number; is_current: boolean }> };
    const currentB = sessionsJson.sessions.find((s) => s.is_current);
    expect(currentB).toBeTruthy();

    const revokeRes = await ctxA.delete(
      `${API_BASE_URL}/api/v1/auth/sessions/${currentB?.id}`,
      {
        headers: {
          Authorization: `Bearer ${loginA.accessToken}`,
          "X-CSRF-Token": loginA.csrfToken,
        },
      }
    );
    assertNo5xx(revokeRes.status(), "revoke other user");
    expect([403, 404]).toContain(revokeRes.status());

    const refreshRes = await ctxB.post(`${API_BASE_URL}/api/v1/auth/refresh`, {
      headers: { "X-CSRF-Token": loginB.csrfToken },
    });
    assertNo5xx(refreshRes.status(), "refresh after other-user revoke");
    expect(refreshRes.status()).toBe(200);

    await ctxA.dispose();
    await ctxB.dispose();
  });
});
