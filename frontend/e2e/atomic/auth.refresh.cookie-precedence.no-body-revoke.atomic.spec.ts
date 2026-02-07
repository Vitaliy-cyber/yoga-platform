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

test.describe("Atomic refresh cookie precedence (no body revoke) (break-it; no 5xx)", () => {
  test.describe.configure({ mode: "serial" });

  test("refresh with cookie must not revoke body refresh token", async () => {
    const ctxA = await playwrightRequest.newContext({
      storageState: { cookies: [], origins: [] },
    });
    const ctxB = await playwrightRequest.newContext({
      storageState: { cookies: [], origins: [] },
    });

    const tokenA = makeIsolatedToken("refresh-cookie-precedence-a");
    const tokenB = makeIsolatedToken("refresh-cookie-precedence-b");

    const loginA = await loginWithContext(ctxA, tokenA);
    const loginB = await loginWithContext(ctxB, tokenB);

    const refreshA = await ctxA.post(`${API_BASE_URL}/api/v1/auth/refresh`, {
      data: { refresh_token: loginB.refresh_token },
      headers: { "X-CSRF-Token": loginA.csrf_token },
    });
    assertNo5xx(refreshA.status(), "refresh cookie precedence");
    expect(refreshA.status()).toBe(200);

    const refreshB = await ctxB.post(`${API_BASE_URL}/api/v1/auth/refresh`, {
      headers: { "X-CSRF-Token": loginB.csrf_token },
    });
    assertNo5xx(refreshB.status(), "refresh body token still valid");
    expect(refreshB.status()).toBe(200);

    await ctxA.dispose();
    await ctxB.dispose();
  });
});
