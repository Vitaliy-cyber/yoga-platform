import { test, expect } from "@playwright/test";
import { assertNo5xx, concurrentAll, getEnvInt } from "./atomic-helpers";

const API_BASE_URL = process.env.PLAYWRIGHT_API_URL || "http://127.0.0.1:8000";

test.describe("Atomic auth/login concurrency (same token; idempotent; no 5xx)", () => {
  test.describe.configure({ mode: "serial" });

  const concurrency = Math.min(getEnvInt("ATOMIC_LOGIN_CONCURRENCY", 30), 60);
  const iterations = getEnvInt("ATOMIC_LOGIN_ITER", 120);

  test("many concurrent logins with the same token always return 200 (no 409)", async () => {
    test.setTimeout(120_000);

    const token = `atomic-login-race-${Date.now().toString(36)}`.slice(0, 100);

    const tasks = Array.from({ length: iterations }, (_, i) => async () => {
      const res = await fetch(`${API_BASE_URL}/api/v1/auth/login?i=${i}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "Accept-Language": i % 2 ? "uk" : "en",
          "User-Agent": `atomic-login-race/${i}`,
        },
        body: JSON.stringify({ token }),
      });

      assertNo5xx(res.status, `login#${i}`);
      const text = await res.text().catch(() => "");
      return { status: res.status, text };
    });

    const results = await concurrentAll(tasks, Math.min(concurrency, 50));
    const statuses = results.map((r) => r.status);
    expect(statuses.length).toBe(iterations);

    // This endpoint should be idempotent; under concurrency it must not devolve into 409.
    const non200 = statuses.filter((s) => s !== 200);
    if (non200.length) {
      const sample = results.find((r) => r.status !== 200);
      throw new Error(
        `Expected all 200, got non-200 statuses=${JSON.stringify(non200.slice(0, 20))}; sample=${sample?.status} ${String(sample?.text || "").slice(0, 200)}`,
      );
    }
  });
});

