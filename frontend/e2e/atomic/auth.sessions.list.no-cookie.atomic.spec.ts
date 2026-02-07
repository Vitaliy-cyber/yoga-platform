import { test, expect, request as playwrightRequest } from "@playwright/test";
import { assertNo5xx } from "./atomic-helpers";
import { makeIsolatedToken } from "./atomic-http";

const API_BASE_URL = process.env.PLAYWRIGHT_API_URL || "http://localhost:8000";

test.describe("Atomic auth sessions listing without cookie (break-it; no 5xx)", () => {
  test.describe.configure({ mode: "serial" });

  test("sessions list works without refresh cookie and marks none current", async ({ request }) => {
    const token = makeIsolatedToken("auth-sessions-no-cookie");
    const loginRes = await request.post(`${API_BASE_URL}/api/v1/auth/login`, {
      data: { token },
    });
    assertNo5xx(loginRes.status(), "login");
    expect(loginRes.status()).toBe(200);
    const loginJson = (await loginRes.json()) as { access_token: string };

    const bareRequest = await playwrightRequest.newContext({
      storageState: { cookies: [], origins: [] },
    });
    const sessionsRes = await bareRequest.get(`${API_BASE_URL}/api/v1/auth/sessions`, {
      headers: {
        Authorization: `Bearer ${loginJson.access_token}`,
        Cookie: "",
      },
    });
    assertNo5xx(sessionsRes.status(), "sessions without cookie");
    expect(sessionsRes.status()).toBe(200);
    const sessionsJson = (await sessionsRes.json()) as {
      sessions: Array<{ id: number; is_current: boolean }>;
    };
    expect(sessionsJson.sessions.length).toBeGreaterThan(0);
    expect(sessionsJson.sessions.every((s) => !s.is_current)).toBe(true);
    await bareRequest.dispose();
  });
});
