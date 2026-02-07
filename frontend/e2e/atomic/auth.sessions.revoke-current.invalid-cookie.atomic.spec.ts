import { test, expect } from "@playwright/test";
import { assertNo5xx } from "./atomic-helpers";
import { makeIsolatedToken } from "./atomic-http";

const API_BASE_URL = process.env.PLAYWRIGHT_API_URL || "http://localhost:8000";

test.describe("Atomic auth sessions revoke-current with invalid cookie (break-it; no 5xx)", () => {
  test.describe.configure({ mode: "serial" });

  test("invalid refresh cookie must not allow revoking current session", async ({ request }) => {
    const token = makeIsolatedToken("auth-session-current-invalid-cookie");
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
    const current = sessionsJson.sessions.find((s) => s.is_current);
    expect(current).toBeTruthy();

    const revokeRes = await fetch(`${API_BASE_URL}/api/v1/auth/sessions/${current?.id}`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${loginJson.access_token}`,
        Cookie: "refresh_token=invalid.refresh.token",
      },
    });
    assertNo5xx(revokeRes.status, "revoke current session with invalid cookie");
    expect([400, 403]).toContain(revokeRes.status);

    const refreshAfter = await fetch(`${API_BASE_URL}/api/v1/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ refresh_token: loginJson.refresh_token }),
    });
    assertNo5xx(refreshAfter.status, "refresh after invalid-cookie revoke");
    expect(refreshAfter.status).toBe(200);
  });
});
