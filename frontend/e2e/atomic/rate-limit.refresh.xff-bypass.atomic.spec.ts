import { test, expect } from "@playwright/test";
import { assertNo5xx } from "./atomic-helpers";

const API_BASE_URL = process.env.PLAYWRIGHT_API_URL || "http://localhost:8000";

test.describe("Atomic rate limit hardening (break-it; no spoof bypass; no 5xx)", () => {
  test.skip(
    process.env.ATOMIC_RATE_LIMIT !== "1",
    "Enable with ATOMIC_RATE_LIMIT=1 and run with PLAYWRIGHT_E2E_FAST_AI=0 (middleware rate limiting enabled).",
  );

  test("X-Forwarded-For spoofing must NOT bypass refresh rate limit when TRUSTED_PROXIES is unset", async ({
    request,
  }) => {
    const ips = ["203.0.113.10", "203.0.113.11", "203.0.113.12", "203.0.113.13"];

    const results = [];
    for (const ip of ips) {
      // eslint-disable-next-line no-await-in-loop
      const res = await request.post(`${API_BASE_URL}/api/v1/auth/refresh`, {
        headers: {
          "X-Forwarded-For": ip,
          "X-Real-IP": ip,
        },
      });
      results.push({ ip, status: res.status(), retryAfter: res.headers()["retry-after"] });
    }

    // First three requests: refresh route can return 400/401 without cookies/body, but never 5xx.
    for (const r of results.slice(0, 3)) {
      assertNo5xx(r.status, `refresh (ip=${r.ip})`);
      expect(r.status, `unexpected 429 too early (ip=${r.ip})`).not.toBe(429);
    }

    // 4th request must hit the strict refresh limiter (3/min) and return 429 even if XFF changes.
    const fourth = results[3];
    expect(fourth.status, `expected 429 on 4th refresh attempt (ip=${fourth.ip})`).toBe(429);
    expect(fourth.retryAfter, "Retry-After header should be present on 429").toBeTruthy();
  });
});

