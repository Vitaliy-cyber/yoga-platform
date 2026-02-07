import { test, expect, request as playwrightRequest } from "@playwright/test";
import { assertNo5xx, concurrentAll, getEnvInt } from "./atomic-helpers";
import { makeIsolatedToken } from "./atomic-http";

const API_BASE_URL = process.env.PLAYWRIGHT_API_URL || "http://127.0.0.1:8000";

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
  const res = await ctx.post(`${API_BASE_URL}/api/v1/auth/login`, { data: { token } });
  assertNo5xx(res.status(), "login");
  expect(res.status()).toBe(200);
  const json = (await res.json()) as { access_token: string };
  const cookies = getSetCookies(res);
  const csrfToken = getCookieValue(cookies, "csrf_token") ?? "";
  expect(json.access_token).toBeTruthy();
  expect(csrfToken).toBeTruthy();
  return { accessToken: json.access_token, csrfToken };
}

test.describe("Atomic logout-all storm (break-it; no 5xx)", () => {
  test.describe.configure({ mode: "serial" });

  const sessionsN = Math.min(getEnvInt("ATOMIC_LOGOUTALL_SESSIONS", 10), 20);
  const concurrency = Math.min(getEnvInt("ATOMIC_LOGOUTALL_CONCURRENCY", 18), 40);
  const logoutOps = getEnvInt("ATOMIC_LOGOUTALL_OPS", 120);
  const refreshOps = getEnvInt("ATOMIC_LOGOUTALL_REFRESH_OPS", 200);

  test("concurrent logout-all + refresh never 5xx", async () => {
    test.setTimeout(180_000);

    const userToken = makeIsolatedToken(`logoutall-storm-${Date.now().toString(36)}`);
    const contexts = await Promise.all(
      Array.from({ length: sessionsN }, async () =>
        playwrightRequest.newContext({ storageState: { cookies: [], origins: [] } }),
      ),
    );

    try {
      const logins = await Promise.all(contexts.map((ctx) => loginWithContext(ctx, userToken)));

      const logoutTasks = Array.from({ length: logoutOps }, (_, i) => async () => {
        const idx = i % contexts.length;
        const ctx = contexts[idx];
        const { accessToken, csrfToken } = logins[idx];
        const res = await ctx.post(`${API_BASE_URL}/api/v1/auth/logout-all?i=${i}`, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "X-CSRF-Token": csrfToken,
            Accept: "application/json",
          },
        });
        assertNo5xx(res.status(), `logout-all#${i}`);
        // Under races, it's okay if the token is already invalidated or CSRF/cookie flow changes.
        expect([200, 400, 401, 403, 409]).toContain(res.status());
        return res.status();
      });

      const refreshTasks = Array.from({ length: refreshOps }, (_, i) => async () => {
        const idx = (i * 7) % contexts.length;
        const ctx = contexts[idx];
        const { accessToken, csrfToken } = logins[idx];
        const res = await ctx.post(`${API_BASE_URL}/api/v1/auth/refresh?i=${i}`, {
          headers: { Authorization: `Bearer ${accessToken}`, "X-CSRF-Token": csrfToken, Accept: "application/json" },
        });
        assertNo5xx(res.status(), `refresh#${i}`);
        expect([200, 400, 401, 403, 409]).toContain(res.status());
        return res.status();
      });

      const statuses = await concurrentAll([...logoutTasks, ...refreshTasks], concurrency);
      expect(statuses.length).toBe(logoutOps + refreshOps);
    } finally {
      await Promise.all(contexts.map((c) => c.dispose().catch(() => undefined)));
    }
  });
});

