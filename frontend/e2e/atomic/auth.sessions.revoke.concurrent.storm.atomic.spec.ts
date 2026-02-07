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

test.describe("Atomic sessions revoke storm (break-it; no 5xx)", () => {
  test.describe.configure({ mode: "serial" });

  const contextsN = Math.min(getEnvInt("ATOMIC_SESSIONS_CTX", 10), 20);
  const concurrency = Math.min(getEnvInt("ATOMIC_SESSIONS_STORM_CONCURRENCY", 20), 40);
  const revokeOps = getEnvInt("ATOMIC_SESSIONS_REVOKE_OPS", 80);
  const refreshOps = getEnvInt("ATOMIC_SESSIONS_REFRESH_OPS", 160);

  test("concurrent revoke-session + refresh never 5xx (409/404/401 ok)", async () => {
    test.setTimeout(180_000);

    const userToken = makeIsolatedToken(`sessions-revoke-storm-${Date.now().toString(36)}`);
    const contexts = await Promise.all(
      Array.from({ length: contextsN }, async () =>
        playwrightRequest.newContext({ storageState: { cookies: [], origins: [] } }),
      ),
    );

    try {
      const logins = await Promise.all(contexts.map((ctx) => loginWithContext(ctx, userToken)));
      const controller = contexts[0];
      const controllerAccess = logins[0].accessToken;

      const sessionsRes = await controller.get(`${API_BASE_URL}/api/v1/auth/sessions`, {
        headers: { Authorization: `Bearer ${controllerAccess}` },
      });
      assertNo5xx(sessionsRes.status(), "sessions");
      expect(sessionsRes.status()).toBe(200);
      const sessionsJson = (await sessionsRes.json()) as {
        sessions: Array<{ id: number; is_current?: boolean }>;
      };
      expect(sessionsJson.sessions.length).toBeGreaterThanOrEqual(1);

      const otherSessionIds = sessionsJson.sessions
        .filter((s) => !s.is_current)
        .map((s) => s.id);
      // If we only have one session (rare), still run refresh-only storm.

      const revokeTasks = Array.from({ length: revokeOps }, (_, i) => async () => {
        if (!otherSessionIds.length) return 204;
        const id = otherSessionIds[i % otherSessionIds.length];
        const res = await controller.delete(`${API_BASE_URL}/api/v1/auth/sessions/${id}?i=${i}`, {
          headers: { Authorization: `Bearer ${controllerAccess}`, Accept: "application/json" },
        });
        assertNo5xx(res.status(), `revoke#${i}`);
        expect([200, 400, 404, 409]).toContain(res.status());
        return res.status();
      });

      const refreshTasks = Array.from({ length: refreshOps }, (_, i) => async () => {
        const idx = i % contexts.length;
        const ctx = contexts[idx];
        const { accessToken, csrfToken } = logins[idx];
        const res = await ctx.post(`${API_BASE_URL}/api/v1/auth/refresh?i=${i}`, {
          headers: { Authorization: `Bearer ${accessToken}`, "X-CSRF-Token": csrfToken, Accept: "application/json" },
        });
        assertNo5xx(res.status(), `refresh#${i}`);
        // After a session is revoked, the backend may clear refresh cookies on 401,
        // and subsequent refreshes legitimately become 400 (missing token).
        expect([200, 400, 401, 403, 409]).toContain(res.status());
        return res.status();
      });

      const allTasks = [...revokeTasks, ...refreshTasks];
      const statuses = await concurrentAll(allTasks, concurrency);
      expect(statuses.length).toBe(allTasks.length);

      const sessionsRes2 = await controller.get(`${API_BASE_URL}/api/v1/auth/sessions?final=1`, {
        headers: { Authorization: `Bearer ${controllerAccess}` },
      });
      assertNo5xx(sessionsRes2.status(), "sessions final");
      expect(sessionsRes2.status()).toBe(200);
    } finally {
      await Promise.all(contexts.map((c) => c.dispose().catch(() => undefined)));
    }
  });
});
