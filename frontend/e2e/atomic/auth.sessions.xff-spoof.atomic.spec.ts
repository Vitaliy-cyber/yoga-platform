import { test, expect } from "@playwright/test";
import { assertNo5xx } from "./atomic-helpers";

const API_BASE_URL = process.env.PLAYWRIGHT_API_URL || "http://127.0.0.1:8000";

type LoginResponse = { access_token: string; user: { id: number } };
type SessionsResponse = { sessions: Array<{ id: number; ip_address?: string | null }>; total: number };

test.describe("Atomic auth sessions: X-Forwarded-For spoofing (security; break-it; no 5xx)", () => {
  test.describe.configure({ mode: "serial" });

  test("sessions must not trust XFF when TRUSTED_PROXIES is unset", async () => {
    const spoofedIp = "203.0.113.10";
    const token = `atomic-xff-${Date.now().toString(36)}`.slice(0, 100);

    const loginRes = await fetch(`${API_BASE_URL}/api/v1/auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-Forwarded-For": spoofedIp,
        "X-Real-IP": spoofedIp,
      },
      body: JSON.stringify({ token }),
    });
    assertNo5xx(loginRes.status, "login with spoofed XFF");
    expect(loginRes.status).toBe(200);

    const loginJson = (await loginRes.json()) as LoginResponse;
    expect(typeof loginJson.access_token).toBe("string");
    expect(loginJson.user && typeof loginJson.user.id).toBe("number");

    const sessionsRes = await fetch(`${API_BASE_URL}/api/v1/auth/sessions`, {
      method: "GET",
      headers: { Authorization: `Bearer ${loginJson.access_token}`, Accept: "application/json" },
    });
    assertNo5xx(sessionsRes.status, "sessions list");
    expect(sessionsRes.status).toBe(200);
    const sessionsJson = (await sessionsRes.json()) as SessionsResponse;
    expect(Array.isArray(sessionsJson.sessions)).toBeTruthy();
    expect(sessionsJson.sessions.length).toBeGreaterThanOrEqual(1);

    const ip = String(sessionsJson.sessions[0]?.ip_address || "");
    // In local dev E2E we should see 127.0.0.1 (or unknown), but never the spoofed value.
    expect(ip).not.toBe(spoofedIp);
    expect(ip === "127.0.0.1" || ip === "unknown" || ip === "").toBeTruthy();
  });
});

