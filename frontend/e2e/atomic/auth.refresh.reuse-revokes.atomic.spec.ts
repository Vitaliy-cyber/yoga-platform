import { test, expect } from "@playwright/test";
import { assertNo5xx } from "./atomic-helpers";

const API_BASE_URL = process.env.PLAYWRIGHT_API_URL || "http://localhost:8000";

async function loginRaw(token: string): Promise<{ refreshToken: string }> {
  const res = await fetch(`${API_BASE_URL}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ token }),
  });
  assertNo5xx(res.status, "login");
  expect(res.status).toBe(200);
  const json = (await res.json()) as { refresh_token: string };
  expect(json.refresh_token).toBeTruthy();
  return { refreshToken: json.refresh_token };
}

async function refresh(refreshToken: string): Promise<Response> {
  return fetch(`${API_BASE_URL}/api/v1/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
}

test.describe("Atomic refresh token reuse defense (break-it; no 5xx)", () => {
  test.describe.configure({ mode: "serial" });

  test("reusing an old refresh token revokes all sessions (next refresh token stops working)", async () => {
    const token = `atomic-reuse-user-${Date.now()}`;
    const { refreshToken: rt1 } = await loginRaw(token);

    // Normal rotation.
    const r1 = await refresh(rt1);
    assertNo5xx(r1.status, "refresh #1");
    expect(r1.status).toBe(200);
    const j1 = (await r1.json()) as { refresh_token: string };
    const rt2 = j1.refresh_token;
    expect(rt2).toBeTruthy();

    // Note: backend has a small grace window to treat immediate "reuse" after rotation
    // as a benign concurrent refresh race (e.g., two tabs). Wait past that window
    // to exercise the security behavior: reuse-after-rotation => revoke all sessions.
    await new Promise((r) => setTimeout(r, 3_500));

    // Reuse the old token (should be detected and revoke all sessions).
    const reuse = await refresh(rt1);
    assertNo5xx(reuse.status, "refresh reuse");
    expect(reuse.status).toBe(401);

    // After reuse detection, even the "new" token should no longer work.
    const after = await refresh(rt2);
    assertNo5xx(after.status, "refresh after reuse");
    expect(after.status).toBe(401);
  });
});
