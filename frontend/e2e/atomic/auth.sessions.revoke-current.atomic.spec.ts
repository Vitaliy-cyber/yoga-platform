import { test, expect } from "@playwright/test";
import { assertNo5xx } from "./atomic-helpers";
import { makeIsolatedToken } from "./atomic-http";

const API_BASE_URL = process.env.PLAYWRIGHT_API_URL || "http://localhost:8000";

test.describe("Atomic auth sessions (break-it; no 5xx)", () => {
  test.describe.configure({ mode: "serial" });

  test("cannot revoke current session via /auth/sessions/{id}", async ({ request }) => {
    const token = makeIsolatedToken("auth-session-current");
    const loginRes = await request.post(`${API_BASE_URL}/api/v1/auth/login`, {
      data: { token },
    });
    assertNo5xx(loginRes.status(), "login");
    expect(loginRes.status()).toBe(200);
    const loginJson = (await loginRes.json()) as { access_token: string; refresh_token: string };

    const sessionsRes = await request.get(`${API_BASE_URL}/api/v1/auth/sessions`, {
      headers: {
        Authorization: `Bearer ${loginJson.access_token}`,
        Cookie: `refresh_token=${loginJson.refresh_token}`,
      },
    });
    assertNo5xx(sessionsRes.status(), "sessions");
    expect(sessionsRes.status()).toBe(200);
    const sessionsJson = (await sessionsRes.json()) as { sessions: Array<{ id: number; is_current: boolean }> };
    expect(sessionsJson.sessions.length).toBeGreaterThan(0);

    const current = sessionsJson.sessions.find((s) => s.is_current);
    expect(current).toBeTruthy();

    const revokeRes = await request.delete(
      `${API_BASE_URL}/api/v1/auth/sessions/${current?.id}`,
      {
        headers: { Authorization: `Bearer ${loginJson.access_token}` },
      }
    );
    assertNo5xx(revokeRes.status(), "revoke current session");
    expect([400, 403]).toContain(revokeRes.status());
  });
});
