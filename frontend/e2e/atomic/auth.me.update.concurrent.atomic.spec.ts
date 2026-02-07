import { test, expect } from "@playwright/test";
import { assertNo5xx, concurrentAll, getEnvInt } from "./atomic-helpers";
import { loginWithToken, makeIsolatedToken, safeJson } from "./atomic-http";

test.describe("Atomic auth/me update concurrency (break-it; never 5xx)", () => {
  test.describe.configure({ mode: "serial" });

  const iterations = getEnvInt("ATOMIC_ME_UPDATE_ITER", 240);
  const concurrency = Math.min(getEnvInt("ATOMIC_ME_UPDATE_CONCURRENCY", 24), 40);

  let accessToken = "";

  test.beforeAll(async () => {
    const token = makeIsolatedToken(`me-update-${Date.now().toString(36)}`);
    accessToken = (await loginWithToken(token)).accessToken;
    expect(accessToken).toBeTruthy();
  });

  test("concurrent PUT /auth/me never 5xx (200/409 only)", async () => {
    const apiBase = process.env.PLAYWRIGHT_API_URL || "http://127.0.0.1:8000";

    const tasks = Array.from({ length: iterations }, (_, i) => async () => {
      const res = await fetch(`${apiBase}/api/v1/auth/me?i=${i}`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ name: `Atomic User ${Date.now().toString(36)} ${i}`.slice(0, 200) }),
      });
      assertNo5xx(res.status, `auth/me update #${i}`);
      expect([200, 409]).toContain(res.status);
      await safeJson(res);
      return res.status;
    });

    const statuses = await concurrentAll(tasks, concurrency);
    expect(statuses.length).toBe(iterations);
    expect(statuses.some((s) => s === 200)).toBeTruthy();
  });
});

