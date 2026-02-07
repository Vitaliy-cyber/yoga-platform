import { test, expect } from "@playwright/test";
import { assertNo5xx, concurrentAll } from "./atomic-helpers";
import { makeIsolatedToken } from "./atomic-http";

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

test.describe("Atomic refresh concurrency no global revoke (break-it; no 5xx)", () => {
  test.describe.configure({ mode: "serial" });

  test("concurrent refresh should not revoke all sessions", async () => {
    const token = makeIsolatedToken("refresh-concurrent-no-global");
    const { refreshToken } = await loginRaw(token);

    const tasks = Array.from({ length: 4 }, () => async () => refresh(refreshToken));
    const responses = await concurrentAll(tasks, 4);

    const newTokens: string[] = [];
    for (const res of responses) {
      assertNo5xx(res.status, "refresh concurrent");
      if (res.status === 200) {
        const body = (await res.json()) as { refresh_token?: string };
        if (body.refresh_token) newTokens.push(body.refresh_token);
      } else {
        await res.text().catch(() => "");
        expect([400, 401]).toContain(res.status);
      }
    }

    expect(newTokens.length).toBeGreaterThan(0);
    const follow = await refresh(newTokens[0]);
    assertNo5xx(follow.status, "refresh after concurrent");
    expect(follow.status).toBe(200);
  });
});
