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
): Promise<{ accessToken: string; refreshToken: string; csrfToken: string }> {
  const res = await ctx.post(`${API_BASE_URL}/api/v1/auth/login`, {
    data: { token },
  });
  assertNo5xx(res.status(), "login");
  expect(res.status()).toBe(200);
  const json = (await res.json()) as { access_token: string; refresh_token: string };
  const cookies = getSetCookies(res);
  const csrfToken = getCookieValue(cookies, "csrf_token");
  expect(json.access_token).toBeTruthy();
  expect(json.refresh_token).toBeTruthy();
  expect(csrfToken).toBeTruthy();
  return { accessToken: json.access_token, refreshToken: json.refresh_token, csrfToken: csrfToken ?? "" };
}

test.describe("Atomic sessions revoke other session (break-it; no 5xx)", () => {
  test.describe.configure({ mode: "serial" });

  test("user can revoke another of their sessions (not current)", async () => {
    const ctxA = await playwrightRequest.newContext({
      storageState: { cookies: [], origins: [] },
    });
    const ctxB = await playwrightRequest.newContext({
      storageState: { cookies: [], origins: [] },
    });

    const userToken = makeIsolatedToken("auth-revoke-other-session");
    const loginA = await loginWithContext(ctxA, userToken);
    const loginB = await loginWithContext(ctxB, userToken);

    const sessionsRes = await ctxA.get(`${API_BASE_URL}/api/v1/auth/sessions`, {
      headers: {
        Authorization: `Bearer ${loginA.accessToken}`,
      },
    });
    assertNo5xx(sessionsRes.status(), "sessions");
    expect(sessionsRes.status()).toBe(200);
    const sessionsJson = (await sessionsRes.json()) as { sessions: Array<{ id: number; is_current: boolean }> };
    expect(sessionsJson.sessions.length).toBeGreaterThan(1);
    const other = sessionsJson.sessions.find((s) => !s.is_current);
    expect(other).toBeTruthy();

    const revokeRes = await ctxA.delete(
      `${API_BASE_URL}/api/v1/auth/sessions/${other?.id}`,
      {
        headers: {
          Authorization: `Bearer ${loginA.accessToken}`,
        },
      }
    );
    assertNo5xx(revokeRes.status(), "revoke other session");
    expect(revokeRes.status()).toBe(200);

    const refreshB = await ctxB.post(`${API_BASE_URL}/api/v1/auth/refresh`, {
      headers: { "X-CSRF-Token": loginB.csrfToken },
    });
    assertNo5xx(refreshB.status(), "refresh revoked session");
    expect(refreshB.status()).toBe(401);

    const refreshA = await ctxA.post(`${API_BASE_URL}/api/v1/auth/refresh`, {
      headers: { "X-CSRF-Token": loginA.csrfToken },
    });
    assertNo5xx(refreshA.status(), "refresh current session");
    expect(refreshA.status()).toBe(200);

    await ctxA.dispose();
    await ctxB.dispose();
  });
});
