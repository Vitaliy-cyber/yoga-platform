import { test, expect, request as playwrightRequest } from "@playwright/test";
import { assertNo5xx } from "./atomic-helpers";
import { makeIsolatedToken } from "./atomic-http";

const API_BASE_URL = process.env.PLAYWRIGHT_API_URL || "http://localhost:8000";

type LoginResponse = { refresh_token: string; user: { id: number } };
type LoginWithCsrf = LoginResponse & { csrf_token: string };

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
): Promise<LoginWithCsrf> {
  const res = await ctx.post(`${API_BASE_URL}/api/v1/auth/login`, {
    data: { token },
  });
  assertNo5xx(res.status(), "login");
  expect(res.status()).toBe(200);
  const json = (await res.json()) as LoginResponse;
  const cookies = getSetCookies(res);
  const csrfToken = getCookieValue(cookies, "csrf_token");
  expect(csrfToken).toBeTruthy();
  return { ...json, csrf_token: csrfToken ?? "" };
}

test.describe("Atomic logout-all cookie precedence (break-it; no 5xx)", () => {
  test.describe.configure({ mode: "serial" });

  test("logout-all uses cookie when body token differs", async () => {
    const ctxA = await playwrightRequest.newContext({
      storageState: { cookies: [], origins: [] },
    });
    const ctxB = await playwrightRequest.newContext({
      storageState: { cookies: [], origins: [] },
    });

    const tokenA = makeIsolatedToken("logoutall-cookie-a");
    const tokenB = makeIsolatedToken("logoutall-cookie-b");

    const loginA = await loginWithContext(ctxA, tokenA);
    const loginB = await loginWithContext(ctxB, tokenB);

    const logoutAllRes = await ctxA.post(`${API_BASE_URL}/api/v1/auth/logout-all`, {
      data: { refresh_token: loginB.refresh_token },
      headers: { "X-CSRF-Token": loginA.csrf_token },
    });
    assertNo5xx(logoutAllRes.status(), "logout-all cookie precedence");
    expect(logoutAllRes.status()).toBe(200);

    const bare = await playwrightRequest.newContext({
      storageState: { cookies: [], origins: [] },
    });
    const refreshA = await bare.post(`${API_BASE_URL}/api/v1/auth/refresh`, {
      data: { refresh_token: loginA.refresh_token },
    });
    assertNo5xx(refreshA.status(), "refresh after logout-all (cookie session)");
    expect(refreshA.status()).toBe(401);

    const refreshB = await bare.post(`${API_BASE_URL}/api/v1/auth/refresh`, {
      data: { refresh_token: loginB.refresh_token },
    });
    assertNo5xx(refreshB.status(), "refresh after logout-all (body session)");
    expect(refreshB.status()).toBe(200);

    await bare.dispose();
    await ctxA.dispose();
    await ctxB.dispose();
  });
});
